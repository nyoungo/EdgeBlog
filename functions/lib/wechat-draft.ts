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
import { downloadRemote } from './media-ingest';
import { keyFromPublicUrl, sniffImageMime } from './media-file';
import { addDraft, submitPublish, updateDraft, uploadContentImage, uploadCoverMaterial } from './wechat';
import {
  renderWechatContent,
  substituteWechatImages,
  truncateChars,
  validateWechatContent,
  WECHAT_DIGEST_MAX,
  WECHAT_TITLE_MAX,
} from './wechat-render';

/** 正文图片：微信 uploadimg 仅收 jpg/png 且单张 < 1MB。 */
const CONTENT_IMAGE_MAX_BYTES = 1024 * 1024;
const CONTENT_IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);

/** 封面：add_material 收 bmp/png/jpeg/jpg/gif，≤10MB。 */
const COVER_MAX_BYTES = 10 * 1024 * 1024;
const COVER_MIMES = new Set(['image/jpeg', 'image/png', 'image/bmp', 'image/gif']);

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

/** 从本站 `/media/<key>` 读 R2 对象。 */
async function readLocalImage(
  env: Env,
  url: string,
  maxSize: number,
  maxSizeMessage: string,
): Promise<PushImageSource> {
  const key = keyFromPublicUrl(url, env.MEDIA_PUBLIC_BASE ?? '');
  if (!key) throw AppError.badRequest(`无法识别的站内图片地址：${url}`);
  const object = await env.MEDIA.get(key);
  if (!object) throw AppError.badRequest(`站内图片不存在（可能已被删除）：${url}`);
  if (object.size > maxSize) throw AppError.payloadTooLarge(maxSizeMessage);
  const bytes = new Uint8Array(await object.arrayBuffer());
  return {
    bytes,
    // 以文件魔数为准，不能信任 R2 metadata 或 URL 后缀。
    mime: sniffImageMime(bytes.slice(0, 32)) ?? '',
    filename: key.split('/').pop() ?? 'image',
  };
}

/** 取图片二进制：本站读 R2，外链走带 SSRF 防护与体积上限的下载。 */
async function loadImage(
  env: Env,
  url: string,
  maxSize: number,
  maxSizeMessage: string,
): Promise<PushImageSource> {
  const raw = url.trim();
  if (!raw) throw AppError.badRequest('图片地址为空');
  // 本站相对地址（/media/...）：直接读 R2，避免绕回自家域名再下载。
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return readLocalImage(env, raw, maxSize, maxSizeMessage);
  }
  const media = await downloadRemote(raw, {
    imageOnly: true,
    maxSize,
    maxSizeMessage,
  });
  return { bytes: media.bytes, mime: media.mime, filename: 'image' };
}

/**
 * 上传正文全部图片，返回与占位符一一对应的 mmbiz URL。
 * 遇到不支持的图片时按用户要求直接报错并指明是哪一张（不静默跳过）。
 */
async function uploadContentImages(
  env: Env,
  settings: WechatSettings,
  images: string[],
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const source = images[i] ?? '';
    const label = `第 ${i + 1} 张正文图片（${source}）`;
    const sizeMessage = `${label} 超过微信正文图 1MB 上限，请压缩后再推送`;
    let loaded: PushImageSource;
    try {
      loaded = await loadImage(env, source, CONTENT_IMAGE_MAX_BYTES - 1, sizeMessage);
    } catch (err) {
      if (err instanceof AppError && !err.message.includes(label)) {
        throw new AppError(err.code, `${label}：${err.message}`, err.details);
      }
      throw err;
    }
    validateWechatContentImage(loaded.mime, loaded.bytes.byteLength, label);
    urls.push(await uploadContentImage(env, settings, loaded.bytes, loaded.mime, loaded.filename));
  }
  return urls;
}

/** 上传封面为永久素材；格式不支持时报错指明。 */
async function uploadCover(env: Env, settings: WechatSettings, coverUrl: string): Promise<string> {
  const loaded = await loadImage(
    env,
    coverUrl,
    COVER_MAX_BYTES,
    '封面图超过微信封面 10MB 上限',
  );
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
  return uploadCoverMaterial(env, settings, loaded.bytes, loaded.mime, loaded.filename);
}

export interface PushDraftOptions {
  /** 站点公开地址，用于 content_source_url（阅读原文）；留空则不传。 */
  siteUrl?: string;
  /** 命中既有草稿时是否改为更新（默认 true）。 */
  updateExisting?: boolean;
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
 */
export async function pushPostToWechatDraft(
  env: Env,
  settings: WechatSettings,
  post: Post,
  options: PushDraftOptions = {},
): Promise<WechatPushResult> {
  const markdown = (post.content_md ?? '').trim();
  if (!markdown) throw AppError.badRequest('文章正文为空，无法推送');

  // 1. 渲染（图片先占位）。
  const rendered = renderWechatContent(markdown);
  if (!post.cover_url) {
    throw AppError.badRequest('推送草稿需要封面图：请先在文章中设置封面（微信 thumb_media_id 必填）');
  }

  // 2. 正文图片上传。
  const imageUrls = await uploadContentImages(env, settings, rendered.images);
  const content = substituteWechatImages(rendered.html, imageUrls);

  // 3. 体积校验（微信 < 2 万字符且 < 1M）。
  const sizeError = validateWechatContent(content);
  if (sizeError) throw AppError.badRequest(sizeError);

  // 4. 封面永久素材。
  const thumbMediaId = await uploadCover(env, settings, post.cover_url);

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

  // 5. 新建或更新草稿（去重）。
  const existing = options.updateExisting === false ? null : await getWechatDraft(env, post.id);
  let mediaId: string;
  let updated = false;
  if (existing) {
    await updateDraft(env, settings, existing.media_id, article);
    mediaId = existing.media_id;
    updated = true;
  } else {
    mediaId = await addDraft(env, settings, article);
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
  return submitPublish(env, settings, mediaId);
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
