/**
 * 把一篇站内文章推送到微信公众号草稿箱的编排逻辑。
 *
 * 链路：
 *   1. 读文章（Markdown）→ 服务端渲染成内联样式 HTML（图片先占位）
 *   2. 逐张取正文图片（本站 /media/... 读 R2；外链先下载）→ uploadimg → 换成 mmbiz URL
 *   3. 封面（cover_url）→ add_material → 永久 thumb_media_id
 *   4. draft/add 新建草稿，或在命中既有草稿时 draft/update
 *
 * 图片约束按用户要求**不静默降级**：非 jpg/png 或 ≥1MB 时直接报错并指明是哪张图。
 */
import type { Post, WechatPushResult, WechatSettings } from '@shared/types';
import { AppError } from './errors';
import type { Env } from './env';
import { all, first, run } from './db';
import { Deadline } from './deadline';
import { loadImageSource } from './media-ingest';
import {
  addDraft,
  submitPublish,
  updateDraft,
  uploadContentImage,
  uploadCoverMaterial,
  WECHAT_TIMEOUT_MS,
} from './wechat';
import {
  substituteWechatImages,
  truncateChars,
  validateWechatContent,
  WECHAT_DIGEST_MAX,
  WECHAT_TITLE_MAX,
} from './wechat-render';
import {
  buildWechatBody,
  miniProgramCardFromSettings,
  type WechatBodyImage,
} from './wechat-length';

/**
 * 一次推送的整体预算（毫秒）。
 *
 * 推送要串行做「取图 → uploadimg → add_material → draft/add」，每一步各自
 * 只包自己的超时是拦不住整体的：几步各卡 30 秒就会顶穿 Cloudflare 边缘
 * 125 秒的 Proxy Read Timeout，用户只看到 524 或一直转圈。
 *
 * 取 100 秒，既给正常的 2～3 张图留足时间（实测单次微信接口 200～400ms），
 * 又能在边缘断开之前把「卡在哪一步」明确报出来。
 */
export const WECHAT_PUSH_BUDGET_MS = 100_000;

/** 单张图片的下载上限；实际值还会被剩余预算收窄。 */
const IMAGE_FETCH_TIMEOUT_MS = 30_000;

/** 正文图片：微信 uploadimg 仅收 jpg/png 且单张 < 1MB。 */
const CONTENT_IMAGE_MAX_BYTES = 1024 * 1024;
const CONTENT_IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);

/** 封面：add_material 收 bmp/png/jpeg/jpg/gif，≤10MB。 */
const COVER_MAX_BYTES = 10 * 1024 * 1024;
const COVER_MIMES = new Set(['image/jpeg', 'image/png', 'image/bmp', 'image/gif']);

/** 预算耗尽时的统一报错：说清「总预算多少秒、卡在哪一步」。 */
function pushTimeout(stage: string, deadline: Deadline): AppError {
  return AppError.upstream(
    `推送超时：整条推送最多等 ${Math.round(deadline.totalMs / 1000)} 秒，卡在${stage}。请稍后重试；正文图片较多时可分批压缩后再推`,
  );
}

/** 预算已经耗尽就立刻报错，不再发起下一步外部请求。 */
function ensureBudget(deadline: Deadline, stage: string): void {
  if (deadline.remainingMs() <= 0) throw pushTimeout(stage, deadline);
}

/** 对正文图执行微信接口的格式与体积校验，错误中保留图片定位信息。 */
export function validateWechatContentImage(mime: string, size: number, label: string): void {
  if (size >= CONTENT_IMAGE_MAX_BYTES) {
    throw AppError.payloadTooLarge(
      `${label} 体积 ${Math.round(size / 1024)}KB，超过微信正文图 1MB 上限，请压缩后再推送`,
    );
  }
  if (!CONTENT_IMAGE_MIMES.has(mime)) {
    throw AppError.unsupportedMedia(
      `${label} 是 ${mime || '未知格式'}，微信正文图只支持 jpg/png，请转换后再推送`,
    );
  }
}

export interface WechatDraftRecord {
  id: number;
  post_id: number;
  media_id: string;
  thumb_media_id: string | null;
  pushed_at: string;
}

/** 取某篇文章已推送过的草稿映射（用于去重/更新）。 */
export async function getWechatDraft(env: Env, postId: number): Promise<WechatDraftRecord | null> {
  return first<WechatDraftRecord>(
    env,
    'SELECT id, post_id, media_id, thumb_media_id, pushed_at FROM wechat_drafts WHERE post_id = ?',
    postId,
  );
}

/** 记录/更新草稿映射。 */
async function upsertWechatDraft(
  env: Env,
  postId: number,
  mediaId: string,
  thumbMediaId: string,
): Promise<void> {
  await run(
    env,
    `INSERT INTO wechat_drafts (post_id, media_id, thumb_media_id, pushed_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(post_id) DO UPDATE SET
       media_id = excluded.media_id,
       thumb_media_id = excluded.thumb_media_id,
       pushed_at = datetime('now')`,
    postId,
    mediaId,
    thumbMediaId,
  );
}

export interface PushImageSource {
  bytes: Uint8Array;
  mime: string;
  filename: string;
}

/** 取图片二进制：本站读 R2，外链走带 SSRF 防护与体积上限的下载。 */
function loadImage(
  env: Env,
  url: string,
  maxSize: number,
  maxSizeMessage: string,
  deadline: Deadline,
): Promise<PushImageSource> {
  return loadImageSource(env, url, {
    maxSize,
    maxSizeMessage,
    // 剩余预算比默认值更小时按剩余预算走，不再给单张图 30 秒。
    timeoutMs: Math.min(IMAGE_FETCH_TIMEOUT_MS, deadline.remainingMs() || 1),
  });
}

/** 上传正文图片时需要额外携带已读取的字节(封面复用)。 */
interface ContentImage extends WechatBodyImage {
  source?: PushImageSource;
}

/**
 * 上传正文全部图片,返回与占位符一一对应的 mmbiz URL。
 * 遇到不支持的图片时按用户要求直接报错并指明是哪一张(不静默跳过)。
 */
async function uploadContentImages(
  env: Env,
  settings: WechatSettings,
  images: ContentImage[],
  deadline: Deadline,
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    if (!image) continue;
    const source = image.url;
    const label = image.label;
    const position = `第 ${i + 1} 张正文图片（${label}）`;
    const sizeMessage = `${label} 超过微信正文图 1MB 上限，请压缩后再推送`;
    ensureBudget(deadline, `取${position}`);
    let loaded: PushImageSource;
    try {
      loaded = image.source ?? (await loadImage(env, source, CONTENT_IMAGE_MAX_BYTES - 1, sizeMessage, deadline));
      if (image.source && loaded.bytes.byteLength >= CONTENT_IMAGE_MAX_BYTES) {
        throw AppError.payloadTooLarge(sizeMessage);
      }
    } catch (err) {
      // 超时类错误已经写明卡在哪一步，不再套一层图名。
      if (err instanceof AppError && !err.message.includes(label) && !err.message.startsWith('推送超时')) {
        throw new AppError(err.code, `${label}：${err.message}`, err.details);
      }
      throw err;
    }
    validateWechatContentImage(loaded.mime, loaded.bytes.byteLength, label);
    try {
      urls.push(
        await uploadContentImage(env, settings, loaded.bytes, loaded.mime, loaded.filename, deadline),
      );
    } catch (err) {
      // 超时也要能定位到具体是哪一张，方便判断是图多还是图大。
      if (err instanceof AppError && /超时/.test(err.message) && !err.message.includes(position)) {
        throw new AppError(err.code, `${position}：${err.message}`, err.details);
      }
      throw err;
    }
  }
  return urls;
}

/** 上传封面为永久素材；格式不支持时报错指明。 */
async function uploadCover(
  env: Env,
  settings: WechatSettings,
  coverUrl: string,
  source: PushImageSource | undefined,
  deadline: Deadline,
): Promise<string> {
  ensureBudget(deadline, '取封面图');
  const loaded = source ?? (await loadImage(
    env,
    coverUrl,
    COVER_MAX_BYTES,
    '封面图超过微信封面 10MB 上限',
    deadline,
  ));
  if (loaded.bytes.byteLength > COVER_MAX_BYTES) {
    throw AppError.payloadTooLarge(
      `封面图体积 ${Math.round(loaded.bytes.byteLength / 1024)}KB，超过微信封面 10MB 上限`,
    );
  }
  if (!COVER_MIMES.has(loaded.mime)) {
    throw AppError.unsupportedMedia(
      `封面图是 ${loaded.mime || '未知格式'}，微信封面只支持 jpg/png/gif/bmp，请转换后再推送`,
    );
  }
  return uploadCoverMaterial(env, settings, loaded.bytes, loaded.mime, loaded.filename, deadline);
}

export interface PushDraftOptions {
  /** 站点公开地址，用于 content_source_url（阅读原文）；留空则不传。 */
  siteUrl?: string;
  /** 命中既有草稿时是否改为更新（默认 true）。 */
  updateExisting?: boolean;
  /** 整条推送的时间预算（毫秒），默认 `WECHAT_PUSH_BUDGET_MS`。 */
  budgetMs?: number;
}

/**
 * 组装「阅读原文」地址。微信只接受可公网访问的 http(s) 地址，本地开发
 * （localhost / 127.0.0.1 / 内网）会被拒并返回 41039。这里遇到明显的回环/内网
 * 地址就返回空字符串（不下发该字段），让本地联调能跑通；生产域名照常下发，
 * 配置写错时仍由微信报错，不静默降级。
 */
function publicSourceUrl(siteUrl: string | undefined, slug: string): string {
  const base = (siteUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) return '';
  let host = '';
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    /* 解析失败时不拦截，交给微信按真实错误反馈 */
  }
  const isLoopback =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local');
  if (isLoopback) return '';
  return `${base}/posts/${slug}`;
}

/**
 * 把一篇文章推送为微信公众号草稿。
 *
 * 幂等：同一篇文章第二次推送会更新既有草稿（`wechat_drafts` 去重），
 * 避免草稿箱堆重复项。
 *
 * 整条链路带总预算（默认 100 秒）：每步外部请求都按剩余预算收窄超时，
 * 预算耗尽立刻报错并指明卡在哪一步，不会无限等下去。
 */
export async function pushPostToWechatDraft(
  env: Env,
  settings: WechatSettings,
  post: Post,
  options: PushDraftOptions = {},
): Promise<WechatPushResult> {
  const markdown = (post.content_md ?? '').trim();
  if (!markdown) throw AppError.badRequest('文章正文为空,无法推送');
  if (!post.cover_url) {
    throw AppError.badRequest('推送草稿需要封面图:请先在文章中设置封面(微信 thumb_media_id 必填)');
  }

  const deadline = new Deadline(options.budgetMs ?? WECHAT_PUSH_BUDGET_MS);

  // 1. 装配正文:渲染、插入正文封面、追加小程序卡片。
  //    与编辑器预检共用同一份逻辑,保证字符数口径一致。
  const body = buildWechatBody({
    markdown,
    coverUrl: post.cover_url,
    bodyCoverPosition: settings.bodyCoverPosition,
    card: miniProgramCardFromSettings(settings),
  });

  // 2. 封面(以及正文里已出现的同一封面地址)只下载一次,复用同一份字节。
  ensureBudget(deadline, '取封面图');
  const coverSource = body.images.some((image) => image.shareCoverSource)
    ? await loadImage(env, post.cover_url, COVER_MAX_BYTES, '封面图超过微信封面 10MB 上限', deadline)
    : undefined;
  const images: ContentImage[] = body.images.map((image) => ({
    ...image,
    source: image.shareCoverSource ? coverSource : undefined,
  }));

  // 3. 正文图片上传。
  const imageUrls = await uploadContentImages(env, settings, images, deadline);
  const content = substituteWechatImages(body.html + body.cardHtml, imageUrls);

  // 4. 体积校验（微信 < 2 万字符且 < 1M）。
  const sizeError = validateWechatContent(content, Array.from(markdown).length);
  if (sizeError) throw AppError.badRequest(sizeError);

  // 5. 封面永久素材。
  const thumbMediaId = await uploadCover(env, settings, post.cover_url, coverSource, deadline);

  const title = truncateChars(post.title.trim() || '未命名文章', WECHAT_TITLE_MAX);
  const digest = truncateChars(post.excerpt?.trim() ?? '', WECHAT_DIGEST_MAX);
  const sourceUrl = publicSourceUrl(options.siteUrl, post.slug);

  const article = {
    title,
    author: settings.author,
    digest,
    content,
    contentSourceUrl: sourceUrl,
    thumbMediaId,
    needOpenComment: (settings.openComment ? 1 : 0) as 0 | 1,
    onlyFansCanComment: (settings.openComment && settings.onlyFansCanComment ? 1 : 0) as 0 | 1,
  };

  // 6. 新建或更新草稿（去重）。
  ensureBudget(deadline, '写入草稿');
  const existing = options.updateExisting === false ? null : await getWechatDraft(env, post.id);
  let mediaId: string;
  let updated = false;
  if (existing) {
    await updateDraft(env, settings, existing.media_id, article, deadline);
    mediaId = existing.media_id;
    updated = true;
  } else {
    mediaId = await addDraft(env, settings, article, deadline);
  }
  await upsertWechatDraft(env, post.id, mediaId, thumbMediaId);

  return { mediaId, updated, imageCount: imageUrls.length, thumbMediaId, title };
}

/** 把已推送的草稿真正发表（publish_mode=publish 时可选用）。 */
export async function publishWechatDraft(
  env: Env,
  settings: WechatSettings,
  mediaId: string,
): Promise<string> {
  return submitPublish(env, settings, mediaId, new Deadline(WECHAT_TIMEOUT_MS));
}

/** 列出已推送过草稿的文章（后台展示用）。 */
export async function listWechatDrafts(env: Env, limit = 50): Promise<Array<WechatDraftRecord & { title: string; slug: string }>> {
  return all(
    env,
    `SELECT d.id, d.post_id, d.media_id, d.thumb_media_id, d.pushed_at, p.title, p.slug
       FROM wechat_drafts d JOIN posts p ON p.id = d.post_id
      ORDER BY d.pushed_at DESC LIMIT ?`,
    limit,
  );
}
