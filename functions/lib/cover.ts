/**
 * 封面生成与「指定图片」入库。
 *
 *   * `ai` 模式:用 Workers AI(`flux-1-schnell`)生成图片,落到 R2 并写
 *     `media` 表,与手动上传的图片同等对待。
 *   * `fallback`(指定图片)模式:任务里填的是本站媒体地址(`/media/...`)时
 *     直接引用;填的是公网外链时,执行时下载入库(失败则回退原始外链,不让
 *     整篇文章生成失败)。
 *
 * 封面是可选产物:任何一步失败都返回 null / 原地址,不影响正文落库。
 */
import type { AutomationTask } from '@shared/types';
import type { Env } from './env';
import { aiChatComplete, type ChatMessage } from './ai';
import { AppError } from './errors';
import { ingestRemoteImage, loadImageSource, storeImageInMedia } from './media-ingest';
import { EXT_BY_MIME, IMAGE_MAX_SIZE, isVideoMime, sniffImageMime } from './media-file';

const COVER_MODEL = '@cf/black-forest-labs/flux-1-schnell';

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 把生成的图片写入 R2 与 media 表,返回公开地址。 */
async function storeGeneratedImage(
  env: Env,
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<string> {
  const stored = await storeImageInMedia(env, bytes, mime, filename);
  return stored.url;
}

/**
 * 用 Workers AI 生成封面并入库。未配置 AI 绑定、生成失败或返回非法图片时
 * 返回 null(封面是可选产物,不应因此让整篇文章生成失败)。
 */
export async function generateCoverImage(env: Env, prompt: string): Promise<string | null> {
  if (!env.AI || typeof env.AI.run !== 'function') return null;
  const clean = prompt.trim().slice(0, 2048);
  if (!clean) return null;

  let imageBase64 = '';
  try {
    const result = await env.AI.run(COVER_MODEL, { prompt: clean, steps: 4 });
    imageBase64 = typeof result?.image === 'string' ? result.image : '';
  } catch (err) {
    console.error('[automation] cover generation failed', err);
    return null;
  }
  if (!imageBase64) return null;

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(imageBase64);
  } catch {
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_SIZE) return null;

  // 用魔数判定真实类型,不盲信模型声明的格式。
  const mime = sniffImageMime(bytes) ?? 'image/jpeg';
  const ext = EXT_BY_MIME[mime] ?? 'jpg';
  try {
    return await storeGeneratedImage(env, bytes, mime, `cover.${ext}`);
  } catch (err) {
    console.error('[automation] cover store failed', err);
    return null;
  }
}

/** 组装封面提示词:任务自定义提示优先,否则用文章标题兜底。 */
export function buildCoverPrompt(task: AutomationTask, title: string): string {
  const hint = task.cover_prompt.trim();
  const base = hint || title;
  return `${base},简约现代的博客封面插图,构图干净,适合作为文章头图`.slice(0, 2000);
}

/**
 * 是否是本站媒体/本地地址(相对路径 `/media/...`)。
 * 这类地址已经在媒体库里,不需要下载入库。
 */
export function isLocalCoverSource(value: string): boolean {
  const v = value.trim();
  return v.startsWith('/') && !v.startsWith('//');
}

/**
 * 解析「指定图片」封面:本站地址直接引用;公网外链下载入库后返回新地址。
 * 下载失败时保留原始外链(不抛错),保证文章仍能生成。
 */
export async function resolveFallbackCover(env: Env, coverUrl: string | null): Promise<string | null> {
  const raw = coverUrl?.trim();
  if (!raw) return null;
  if (isLocalCoverSource(raw)) return raw;

  try {
    const media = await ingestRemoteImage(env, raw, 'cover');
    return media.url;
  } catch (err) {
    console.error('[automation] 指定封面入库失败,回退原始地址', err);
    return raw;
  }
}

/* ------------------------------------------------------- 封面图描述(视觉) */

/**
 * 图片描述的体积上限。
 *
 * 免费版每个请求只有 10ms CPU，base64 编码是纯 JS；封面原图最大 8MB，
 * 全部转成 data URI 会明显拖慢甚至超限。4MB 覆盖了绝大多数封面，
 * 更大的图直接报错跳过描述（正文照常生成）。
 */
const VISION_IMAGE_MAX_SIZE = 4 * 1024 * 1024;

/** 单次读图请求的上限：视觉理解不该占用正文 6 分钟预算的大头。 */
const VISION_TIMEOUT_MS = 120_000;

const COVER_VISION_SYSTEM_PROMPT = [
  '你是 Edge Blog 定时发文流程里的读图助手。',
  '用户会给出一张将作为文章封面的图片，请用中文客观描述画面内容，作为写作素材。',
  '只描述你实际看到的内容：主体、场景、构图、风格、色彩、画面中可辨认的文字。',
  '不要猜测拍摄地点或人物身份，不要评价图片好坏，不要输出标题、列表或解释。',
  '只输出一段 120–200 字的描述。',
].join('\n');

/** Uint8Array → base64；分块拼接避免大图把调用栈打爆。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 用当前 AI 模型「看图」生成封面描述。
 *
 * 不额外校验模型是否支持视觉：选错模型时请求会失败，由调用方决定是否跳过。
 * 站内 `/media/...` 从 R2 读，外链走带 SSRF 防护的下载，统一转成 data URI，
 * 避免模型侧无法访问本站相对地址。
 */
export async function describeCoverImage(env: Env, imageUrl: string, topic: string): Promise<string> {
  const source = await loadImageSource(env, imageUrl, {
    maxSize: VISION_IMAGE_MAX_SIZE,
    maxSizeMessage: `封面图超过 ${VISION_IMAGE_MAX_SIZE / 1024 / 1024}MB，无法用于图片描述`,
  });
  const mime = sniffImageMime(source.bytes.slice(0, 32)) ?? source.mime;
  if (!mime || !(mime in EXT_BY_MIME) || isVideoMime(mime)) {
    throw AppError.unsupportedMedia('封面图格式无法用于图片描述，请改用 JPG / PNG / WebP');
  }

  const dataUrl = `data:${mime};base64,${bytesToBase64(source.bytes)}`;
  const context = topic.replace(/\s+/g, ' ').trim().slice(0, 300);
  const messages: ChatMessage[] = [
    { role: 'system', content: COVER_VISION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${context ? `文章主题：${context}\n` : ''}请描述这张封面图。`,
        },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];

  const { text } = await aiChatComplete(env, messages, undefined, VISION_TIMEOUT_MS);
  const description = text.trim();
  if (!description) throw AppError.upstream('视觉模型未返回图片描述');
  return description;
}
