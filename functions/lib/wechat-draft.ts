/**
 * 把一篇站内文章推送到微信公众号草稿箱的编排逻辑。
 *
 * 链路：
 *   1. 读文章（Markdown）→ 服务端渲染成内联样式 HTML（图片先占位）
 *   2. 逐张取正文图片（本站 /media/... 读 R2；外链先下载）→ uploadimg
 *   3. 封面（cover_url）→ add_material → 永久 thumb_media_id
 *   4. draft/add 新建草稿，或在命中既有草稿时 draft/update
 *
 * 图片约束按用户要求**不静默降级**：格式/体积不达标、或服务端处理开关关闭时
 * 需要转换的图片，都直接报错并指明是哪张。
 *
 * 注意：默认**不在服务端解码图片**。Cloudflare Workers 免费版每请求只有 10ms
 * CPU，wasm 解码/编码一张图要 100ms 以上，请求会被边缘终止（Error 1102），
 * 浏览器只能看到「请求失败」。需要转换的图片由文章编辑器在浏览器侧（Canvas）
 * 先转好再落库；只有付费版才建议打开 `serverImageProcessing`。
 */
import type { Post, WechatArticleType, WechatPushResult, WechatSettings } from '@shared/types';
import { AppError } from './errors';
import type { Env } from './env';
import { all, first, run } from './db';
import { Deadline } from './deadline';
import { loadImageSource } from './media-ingest';
import { EXT_BY_MIME, IMAGE_MAX_SIZE } from './media-file';
import { prepareImageForUpload } from './image-codec';
import { compressImageRemotely } from './image-compress-remote';
import { isTransformableUrl, transformImageByUrl } from './image-transform';
import { DECODABLE_IMAGE_MIMES } from './image-process';
import {
  addDraft,
  submitPublish,
  updateDraft,
  uploadContentImage,
  uploadCoverMaterial,
  WECHAT_TIMEOUT_MS,
} from './wechat';
import {
  renderWechatPlainText,
  substituteWechatImages,
  truncateChars,
  validateWechatContent,
  WECHAT_DIGEST_MAX,
  WECHAT_TITLE_MAX,
} from './wechat-render';
import {
  buildWechatBody,
  imageSourceKey,
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

/**
 * 推送前压缩的目标：给微信 1MB 上限留 100KB 余量。
 *
 * 封面也用同一个目标：它常常同时是正文封面图（`shareCoverSource`），
 * 压一次两边复用；add_material 虽然允许 10MB，但小图上传更快、草稿预览也够用。
 */
const PUSH_IMAGE_TARGET_BYTES = 900_000;

/** 推送前的目标宽度：公众号正文区约 677px，1440 在手机上仍然清晰。 */
const PUSH_IMAGE_MAX_WIDTH = 1440;

/** 预算耗尽时的统一报错：说清「总预算多少秒、卡在哪一步」。 */
function pushTimeout(stage: string, deadline: Deadline): AppError {
  return AppError.upstream(
    `推送超时：整条推送最多等 ${Math.round(deadline.totalMs / 1000)} 秒，卡在${stage}。请稍后重试；正文图片较多时可分批压缩后再推`,
  );
}

/**
 * 服务端不做图片处理时的统一提示。
 *
 * 免费版 Worker 只有 10ms CPU，wasm 解码/编码一张图要 100ms 以上，请求会被
 * 边缘终止（1102），浏览器只看到「请求失败」。所以默认不在服务端转图，改由
 * 编辑器在浏览器侧转换后落库；这里只负责把「哪张图需要转换」说清楚。
 */
const CLIENT_PREPARE_HINT =
  '请在文章编辑页点「推送到公众号草稿」，编辑器会先在浏览器里把图片转成微信能接收的格式；也可以先手动转成 jpg/png 再上传';

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
  article_type: WechatArticleType;
  /** newspic 已上传的永久素材缓存：`[{ url, mediaId }]`。 */
  images_json: string;
  pushed_at: string;
}

/** 图片消息已上传的永久素材；按去掉 fragment 的 URL 复用，避免重复占用素材额度。 */
interface CachedPushImage {
  url: string;
  mediaId: string;
}

/** 取某篇文章已推送过的草稿映射（用于去重/更新）。 */
export async function getWechatDraft(env: Env, postId: number): Promise<WechatDraftRecord | null> {
  return first<WechatDraftRecord>(
    env,
    `SELECT id, post_id, media_id, thumb_media_id, article_type, images_json, pushed_at
       FROM wechat_drafts WHERE post_id = ?`,
    postId,
  );
}

/** 解析 images_json；损坏或格式不符时按空缓存处理（下次重新上传即可）。 */
function parseCachedImages(raw: string | null | undefined): CachedPushImage[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const { url, mediaId } = item as Record<string, unknown>;
      return typeof url === 'string' && typeof mediaId === 'string' && url && mediaId
        ? [{ url, mediaId }]
        : [];
    });
  } catch {
    return [];
  }
}

/** 记录/更新草稿映射。 */
async function upsertWechatDraft(
  env: Env,
  postId: number,
  mediaId: string,
  thumbMediaId: string,
  articleType: WechatArticleType,
  images: CachedPushImage[],
): Promise<void> {
  await run(
    env,
    `INSERT INTO wechat_drafts (post_id, media_id, thumb_media_id, article_type, images_json, pushed_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(post_id) DO UPDATE SET
       media_id = excluded.media_id,
       thumb_media_id = excluded.thumb_media_id,
       article_type = excluded.article_type,
       images_json = excluded.images_json,
       pushed_at = datetime('now')`,
    postId,
    mediaId,
    thumbMediaId,
    articleType,
    JSON.stringify(images),
  );
}

export interface PushImageSource {
  bytes: Uint8Array;
  mime: string;
  filename: string;
}

/** 「不转格式也能直接上传」的判定结果。 */
interface ImageProblem {
  code: 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE';
  message: string;
}

function kb(size: number): string {
  return `${Math.round(size / 1024)}KB`;
}

/**
 * 只按文件头 MIME 与体积判断能不能交给微信正文接口（不解码、不占 CPU）。
 *
 * 微信 `media/uploadimg` 只收 jpg/png 且单张 < 1MB；webp/avif/gif/bmp 都需要
 * 先转换，这一步交给浏览器（编辑器推送前用 Canvas 转好），Worker 不再解码。
 */
function contentImageProblem(image: PushImageSource): ImageProblem | null {
  if (!CONTENT_IMAGE_MIMES.has(image.mime)) {
    return {
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: `是 ${image.mime || '未知格式'}，微信正文图只支持 jpg/png`,
    };
  }
  if (image.bytes.byteLength >= CONTENT_IMAGE_MAX_BYTES) {
    return {
      code: 'PAYLOAD_TOO_LARGE',
      message: `体积 ${kb(image.bytes.byteLength)}，超过微信正文图 1MB 上限`,
    };
  }
  return null;
}

/**
 * 封面可以直接上传的条件：jpg/png/gif/bmp 且 ≤10MB。
 *
 * 封面接口本身接受这些格式，所以不再为了「1440px」去重编码——免费版正是
 * 卡在这一步。只有真正不支持的格式（webp/avif）或超限才要求先转换。
 */
function coverImageProblem(image: PushImageSource): ImageProblem | null {
  if (!COVER_MIMES.has(image.mime)) {
    return {
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: `是 ${image.mime || '未知格式'}，微信封面只支持 jpg/png/gif/bmp`,
    };
  }
  if (image.bytes.byteLength > COVER_MAX_BYTES) {
    return {
      code: 'PAYLOAD_TOO_LARGE',
      message: `体积 ${kb(image.bytes.byteLength)}，超过微信封面 10MB 上限`,
    };
  }
  return null;
}

/** 取图片二进制：本站读 R2，外链走带 SSRF 防护与体积上限的下载。 */
function loadImage(  env: Env,
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

/** 压缩后格式可能变了（webp → jpeg），文件名后缀要跟着换，否则微信按后缀判类型。 */
function withMimeExtension(filename: string, mime: string): string {
  const ext = EXT_BY_MIME[mime];
  if (!ext) return filename;
  const base = filename.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${ext}`;
}

/**
 * 把一张「微信不能直接收」的图转成 jpg/png，返回可直接上传的结果。
 *
 * 优先级（与设置页一致）：
 *   1. `serverImageProcessing`（Workers 付费版）→ 本地 wasm 压缩；
 *   2. 配置了 `imageCompressUrl` → 上传式远程接口（Worker 只做 I/O）；
 *   3. 配置了 `imageTransformUrl` → 按 URL 转码的图片代理（GET，由对方下载原图并
 *      缩放），只对公网地址生效。
 *
 * 2 和 3 必须串起来：上传式接口经常带 JS 反爬，Worker 的出站请求会被拦成
 * `HTTP 456` + `_guard/html.js`，而手动推送因为浏览器先把图转好了，根本不会走到
 * 这里，于是表现为「手动能推、定时总失败」。两步都失败时指名报错，不静默丢图。
 *
 * 合规的图直接返回，不为「重推一次」白耗远程接口的额度和时间。
 */
async function preparePushImage(
  env: Env,
  settings: WechatSettings,
  loaded: PushImageSource,
  label: string,
  deadline: Deadline,
  kind: 'content' | 'cover',
  sourceUrl: string,
): Promise<PushImageSource> {
  if (settings.serverImageProcessing) {
    // 付费版沿用原来的行为：总是交给 wasm（内部对合规图有直通分支）。
    return compressForPush(loaded, label, deadline);
  }

  const problem = kind === 'cover' ? coverImageProblem(loaded) : contentImageProblem(loaded);
  if (!problem) return loaded;

  const maxBytes = kind === 'cover' ? Math.min(COVER_MAX_BYTES, PUSH_IMAGE_TARGET_BYTES) : PUSH_IMAGE_TARGET_BYTES;
  const failures: string[] = [];

  if (settings.imageCompressUrl.trim()) {
    try {
      const remote = await compressImageRemotely(loaded, label, settings, deadline);
      const prepared: PushImageSource = {
        bytes: remote.bytes,
        mime: remote.mime,
        filename: withMimeExtension(loaded.filename, remote.mime),
      };
      const still = kind === 'cover' ? coverImageProblem(prepared) : contentImageProblem(prepared);
      if (!still) return prepared;
      failures.push(`远程压缩后仍不达标（${still.message}）`);
    } catch (err) {
      failures.push(describeImageFailure(err, label));
    }
  }

  const absolute = absoluteImageUrl(env, sourceUrl);
  if (absolute && isTransformableUrl(absolute)) {
    try {
      const transformed = await transformImageByUrl(absolute, label, settings, maxBytes, deadline);
      const prepared: PushImageSource = {
        bytes: transformed.bytes,
        mime: transformed.mime,
        filename: withMimeExtension(loaded.filename, transformed.mime),
      };
      const still = kind === 'cover' ? coverImageProblem(prepared) : contentImageProblem(prepared);
      if (!still) return prepared;
      failures.push(`图片转码后仍不达标（${still.message}）`);
    } catch (err) {
      failures.push(describeImageFailure(err, label));
    }
  } else {
    failures.push('该图片不是公网地址，无法交给图片转码接口');
  }

  const reason = failures.length > 0 ? failures.join('；') : '没有可用的图片转码方式';
  throw new AppError(
    problem.code,
    `${label}${problem.message}；${reason}；${CLIENT_PREPARE_HINT}`,
  );
}

/** 报错文本里已经有图名时不再重复拼接，避免「封面图（封面图…）」。 */
function describeImageFailure(err: unknown, label: string): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(label) ? message : `${label}：${message}`;
}

/**
 * 把站内相对地址拼成公网绝对地址（图片代理只能拉公网 URL）。
 *
 * 优先 `MEDIA_PUBLIC_BASE`（R2 独立域名），其次 `SITE_URL`；两者都没配置时返回
 * null，由调用方给出明确原因，而不是拼出 localhost 或 127.0.0.1。
 */
function absoluteImageUrl(env: Env, url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  const base = (env.MEDIA_PUBLIC_BASE || env.SITE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}${raw}` : null;
}

/**
 * 推送前把图片压到微信能收的范围：超宽/超重的先缩到 1440px、900KB 以内。
 *
 * 合规的图（jpg/png、宽度 ≤1440、体积 ≤900KB）走 `prepareImageForUpload` 的
 * 直通分支，不会重新编码，也就不会碰 wasm。压缩失败时带上图名报错，
 * 不静默把原图推上去让微信拒。
 *
 * GIF / BMP 无法解码（jsquash 没有对应解码器）时原样返回：封面接口本身收这两种
 * 格式，正文接口不收，由 `validateWechatContentImage` 指名报错。
 */
async function compressForPush(
  loaded: PushImageSource,
  label: string,
  deadline: Deadline,
): Promise<PushImageSource> {
  ensureBudget(deadline, `压缩${label}`);
  if (!DECODABLE_IMAGE_MIMES.has(loaded.mime)) return loaded;
  try {
    const prepared = await prepareImageForUpload(loaded.bytes, loaded.mime, {
      maxBytes: PUSH_IMAGE_TARGET_BYTES,
      maxWidth: PUSH_IMAGE_MAX_WIDTH,
      quality: 82,
      format: 'auto',
    });
    return {
      bytes: prepared.bytes,
      mime: prepared.mime,
      filename: withMimeExtension(loaded.filename, prepared.mime),
    };
  } catch (err) {
    if (err instanceof AppError && !err.message.includes(label)) {
      throw new AppError(err.code, `${label}：${err.message}`, err.details);
    }
    throw err;
  }
}

/** 上传正文图片时需要额外携带已读取的字节(封面复用)。 */
interface ContentImage extends WechatBodyImage {
  source?: PushImageSource;
}

/**
 * 上传正文全部图片,返回与占位符一一对应的 mmbiz URL。
 *
 * 先压到微信能收的范围（jpg/png、<1MB、宽度 ≤1440）再上传；压缩后仍不达标
 * 或格式无法解码时按用户要求直接报错并指明是哪一张（不静默跳过）。
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
    // label 由 `buildWechatBody` 生成，已经写明「第 N 张正文图片(url)」「封面图」等
    // 定位信息，这里不再叠加一层，否则报错会变成
    //「第 1 张正文图片（第 1 张正文图片(...)）」。
    const position = label;
    ensureBudget(deadline, `取${position}`);
    let prepared: PushImageSource;
    try {
      // 原图上限放到 8MB：正文图经常超 1MB，先取回来再说。
      // 封面图在调用方已经处理并共享字节，这里既不重复读取，也不重复压缩。
      const shared = image.source !== undefined;
      prepared =
        image.source ??
        (await loadImage(env, source, IMAGE_MAX_SIZE, `${label} 超过 8MB，无法推送`, deadline));
      // 共享的封面字节在调用方已经处理过，这里不再重复转码 / 消耗远程额度。
      if (!shared) {
        prepared = await preparePushImage(env, settings, prepared, label, deadline, 'content', source);
      }
    } catch (err) {
      // 超时类错误已经写明卡在哪一步，不再套一层图名。
      if (err instanceof AppError && !err.message.includes(label) && !err.message.startsWith('推送超时')) {
        throw new AppError(err.code, `${label}：${err.message}`, err.details);
      }
      throw err;
    }
    validateWechatContentImage(prepared.mime, prepared.bytes.byteLength, label);
    try {
      urls.push(
        await uploadContentImage(env, settings, prepared.bytes, prepared.mime, prepared.filename, deadline),
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

/** 上传封面为永久素材；字节已在调用方处理过，这里只做微信侧的格式/体积兜底。 */
/**
 * 上传一张永久图片素材，返回 media_id。
 *
 * 图文消息的封面与图片消息的每一张图都走这个接口（`material/add_material?type=image`），
 * 它与正文图用的 `media/uploadimg` 不是一回事：后者只回一个 URL，拿不到 media_id。
 */
async function uploadPermanentImage(
  env: Env,
  settings: WechatSettings,
  prepared: PushImageSource,
  label: string,
  deadline: Deadline,
): Promise<string> {
  ensureBudget(deadline, `上传${label}`);
  if (prepared.bytes.byteLength > COVER_MAX_BYTES) {
    throw AppError.payloadTooLarge(
      `${label} 体积 ${Math.round(prepared.bytes.byteLength / 1024)}KB，超过微信图片素材 10MB 上限`,
    );
  }
  if (!COVER_MIMES.has(prepared.mime)) {
    throw AppError.unsupportedMedia(
      `${label} 是 ${prepared.mime || '未知格式'}，微信图片素材只支持 jpg/png/gif/bmp，请转换后再推送`,
    );
  }
  return uploadCoverMaterial(
    env,
    settings,
    prepared.bytes,
    prepared.mime,
    prepared.filename,
    deadline,
  );
}

export interface PushDraftOptions {
  /** 站点公开地址，用于 content_source_url（阅读原文）；留空则不传。 */
  siteUrl?: string;
  /** 命中既有草稿时是否改为更新（默认 true）。 */
  updateExisting?: boolean;
  /** 整条推送的时间预算（毫秒），默认 `WECHAT_PUSH_BUDGET_MS`。 */
  budgetMs?: number;
  /** 消息类型，默认 `news`（图文消息）；`newspic` 为图片消息（贴图）。 */
  articleType?: WechatArticleType;
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

  const deadline = new Deadline(options.budgetMs ?? WECHAT_PUSH_BUDGET_MS);
  // 去重映射只读一次：图文消息用它决定 add/update，图片消息还用它复用永久素材 id。
  const existing = options.updateExisting === false ? null : await getWechatDraft(env, post.id);

  if (options.articleType === 'newspic') {
    return pushNewspicDraft(env, settings, post, options, deadline, existing);
  }

  if (!post.cover_url) {
    throw AppError.badRequest('推送草稿需要封面图:请先在文章中设置封面(微信 thumb_media_id 必填)');
  }

  // 1. 装配正文:渲染、插入正文封面、追加小程序卡片。
  //    与编辑器预检共用同一份逻辑,保证字符数口径一致。
  const body = buildWechatBody({
    markdown,
    coverUrl: post.cover_url,
    bodyCoverPosition: settings.bodyCoverPosition,
    card: miniProgramCardFromSettings(settings),
  });

  // 2. 封面（以及正文里已出现的同一封面地址）只下载一次，两边复用同一份字节。
  //    默认不在服务端解码：免费版 10ms CPU 跑不完 wasm，会直接 1102；
  //    配了远程压缩接口时改由它转码，Worker 只做 I/O。
  //    封面同时插在正文里时按「正文图」的标准准备：微信正文图要求 < 1MB，
  //    只按封面 10MB 的宽松限制准备，最后会在上传正文图那一步被拒。
  const coverInBody = body.images.some((image) => image.shareCoverSource === true);
  ensureBudget(deadline, '取封面图');
  const coverSource = await preparePushImage(
    env,
    settings,
    await loadImage(
      env,
      post.cover_url,
      COVER_MAX_BYTES,
      '封面图超过微信封面 10MB 上限',
      deadline,
    ),
    '封面图',
    deadline,
    coverInBody ? 'content' : 'cover',
    post.cover_url,
  );
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

  // 5. 封面永久素材（复用上面压缩好的字节）。
  const thumbMediaId = await uploadPermanentImage(env, settings, coverSource, '封面图', deadline);

  const title = truncateChars(post.title.trim() || '未命名文章', WECHAT_TITLE_MAX);
  const digest = truncateChars(post.excerpt?.trim() ?? '', WECHAT_DIGEST_MAX);
  const sourceUrl = publicSourceUrl(options.siteUrl, post.slug);

  const article = {
    articleType: 'news' as const,
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
  let mediaId: string;
  let updated = false;
  if (existing) {
    await updateDraft(env, settings, existing.media_id, article, deadline);
    mediaId = existing.media_id;
    updated = true;
  } else {
    mediaId = await addDraft(env, settings, article, deadline);
  }
  await upsertWechatDraft(env, post.id, mediaId, thumbMediaId, 'news', []);

  return {
    mediaId,
    articleType: 'news',
    updated,
    imageCount: imageUrls.length,
    thumbMediaId,
    title,
  };
}

/** 图片消息最多 20 张（微信 `image_info.image_list` 的硬上限）。 */
const NEWSPIC_MAX_IMAGES = 20;

interface NewspicImage {
  url: string;
  /** 报错时的定位信息，如「封面图」「图片消息第 2 张图片(...)」。 */
  label: string;
}

/**
 * 图片消息（贴图）：正文是纯文本，图片全部作为永久素材放进 `image_info`。
 *
 * 与图文消息的差异（都已核对 `draft/add` 文档）：
 *   * `image_media_id` 必须是 `material/add_material?type=image` 的永久 media_id，
 *     不能用正文图的 `uploadimg` URL；
 *   * 最多 20 张，首张即封面；
 *   * `content` 只支持纯文本，HTML 标签会被过滤，所以走 `renderWechatPlainText`；
 *   * `thumb_media_id` 不需要传。
 *
 * 永久素材有总额度，重复推送同一篇时按 URL 复用 `wechat_drafts.images_json`
 * 里缓存的 media_id，既不重复上传，也不重复占用素材额度。
 */
async function pushNewspicDraft(
  env: Env,
  settings: WechatSettings,
  post: Post,
  options: PushDraftOptions,
  deadline: Deadline,
  existing: WechatDraftRecord | null,
): Promise<WechatPushResult> {
  const markdown = (post.content_md ?? '').trim();
  const rendered = renderWechatPlainText(markdown);

  // 顺序：封面优先（首张即封面），然后是正文里按出现顺序的图片；同一地址只保留一次。
  const images: NewspicImage[] = [];
  const seen = new Set<string>();
  const collect = (url: string) => {
    const value = url.trim();
    if (!value) return;
    const key = imageSourceKey(value);
    if (seen.has(key)) return;
    seen.add(key);
    images.push({ url: value, label: '' });
  };
  if (post.cover_url) collect(post.cover_url);
  for (const url of rendered.images) collect(url);

  if (images.length === 0) {
    throw AppError.badRequest(
      '图片消息至少需要一张图片：请先在文章中设置封面，或在正文中插入图片',
    );
  }
  if (images.length > NEWSPIC_MAX_IMAGES) {
    throw AppError.badRequest(
      `图片消息最多 ${NEWSPIC_MAX_IMAGES} 张图片，当前 ${images.length} 张，请删减后再推送`,
    );
  }
  images.forEach((image, index) => {
    image.label =
      post.cover_url && index === 0
        ? '封面图'
        : `图片消息第 ${index + 1} 张图片(${image.url})`;
  });

  // 只有旧草稿也是图片消息时才复用缓存，避免把图文消息的封面误当成图片列表。
  const cached = new Map<string, string>();
  if (existing?.article_type === 'newspic') {
    for (const item of parseCachedImages(existing.images_json)) {
      cached.set(imageSourceKey(item.url), item.mediaId);
    }
  }

  const mediaIds: string[] = [];
  const uploaded: CachedPushImage[] = [];
  for (const image of images) {
    const key = imageSourceKey(image.url);
    const reused = cached.get(key);
    if (reused) {
      mediaIds.push(reused);
      uploaded.push({ url: key, mediaId: reused });
      continue;
    }

    ensureBudget(deadline, `取${image.label}`);
    let prepared: PushImageSource;
    try {
      const loaded = await loadImage(
        env,
        image.url,
        COVER_MAX_BYTES,
        `${image.label} 超过微信图片素材 10MB 上限`,
        deadline,
      );
      // 永久素材接口的格式/体积比正文图宽松（≤10MB、jpg/png/gif/bmp），
      // 所以按 'cover' 口径准备；配置了服务端压缩时仍会统一缩到 1440px/900KB。
      prepared = await preparePushImage(
        env,
        settings,
        loaded,
        image.label,
        deadline,
        'cover',
        image.url,
      );
    } catch (err) {
      if (
        err instanceof AppError &&
        !err.message.includes(image.label) &&
        !err.message.startsWith('推送超时')
      ) {
        throw new AppError(err.code, `${image.label}：${err.message}`, err.details);
      }
      throw err;
    }
    mediaIds.push(await uploadPermanentImage(env, settings, prepared, image.label, deadline));
    uploaded.push({ url: key, mediaId: mediaIds[mediaIds.length - 1] as string });
  }

  // 正文只收纯文本；纯图片文章没有可见文字时用摘要/标题兜底（content 是必填字段）。
  const content = rendered.text || post.excerpt?.trim() || post.title;
  const sizeError = validateWechatContent(content, Array.from(markdown).length);
  if (sizeError) throw AppError.badRequest(sizeError.replace('公众号正文', '图片消息正文'));

  const title = truncateChars(post.title.trim() || '未命名文章', WECHAT_TITLE_MAX);
  const article = {
    articleType: 'newspic' as const,
    title,
    author: settings.author,
    digest: '',
    content,
    contentSourceUrl: publicSourceUrl(options.siteUrl, post.slug),
    thumbMediaId: null,
    needOpenComment: (settings.openComment ? 1 : 0) as 0 | 1,
    onlyFansCanComment: (settings.openComment && settings.onlyFansCanComment ? 1 : 0) as 0 | 1,
    imageMediaIds: mediaIds,
  };

  ensureBudget(deadline, '写入草稿');
  let mediaId: string;
  let updated = false;
  if (existing) {
    await updateDraft(env, settings, existing.media_id, article, deadline);
    mediaId = existing.media_id;
    updated = true;
  } else {
    mediaId = await addDraft(env, settings, article, deadline);
  }
  await upsertWechatDraft(env, post.id, mediaId, mediaIds[0] ?? '', 'newspic', uploaded);

  return {
    mediaId,
    articleType: 'newspic',
    updated,
    imageCount: mediaIds.length,
    thumbMediaId: mediaIds[0] ?? '',
    title,
  };
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
    `SELECT d.id, d.post_id, d.media_id, d.thumb_media_id, d.article_type, d.pushed_at,
            p.title, p.slug
       FROM wechat_drafts d JOIN posts p ON p.id = d.post_id
      ORDER BY d.pushed_at DESC LIMIT ?`,
    limit,
  );
}
