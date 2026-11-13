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
import { run } from './db';
import type { Env } from './env';
import { ingestRemoteImage } from './media-ingest';
import { EXT_BY_MIME, IMAGE_MAX_SIZE, sniffImageMime } from './media-file';
import { mediaObjectKey, mediaPublicUrl } from './media-store';

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
  const key = mediaObjectKey(filename, mime);
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
  });
  const url = mediaPublicUrl(env.MEDIA_PUBLIC_BASE, key);
  try {
    await run(
      env,
      'INSERT INTO media (key, url, filename, size, mime, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?)',
      key,
      url,
      filename,
      bytes.byteLength,
      mime,
      null,
    );
  } catch (err) {
    // 索引写失败就把对象删掉,避免 R2 里留下没有记录的孤儿文件。
    await env.MEDIA.delete(key).catch(() => undefined);
    throw err;
  }
  return url;
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
