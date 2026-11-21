/**
 * 推送公众号草稿前，在**浏览器里**把图片转成微信能直接接收的格式。
 *
 * 为什么不在 Worker 里做：Cloudflare Workers 免费版每个请求只有 10ms CPU，
 * 而 wasm 解码/编码一张图要 100ms 以上——请求会被边缘直接终止（Error 1102），
 * 前端只能看到「请求失败」。浏览器没有这个预算，先把封面/正文图转成 jpg 并
 * 落库，Worker 侧的推送就只剩「下载 + 上传」，CPU 可以忽略。
 *
 * 规则与微信接口一致：
 *   * 正文图 `media/uploadimg`：只收 jpg/png，单张 < 1MB；
 *   * 封面 `material/add_material`：收 jpg/png/gif/bmp，≤10MB。
 * 已经合规的图片原样保留，不重新上传（重复推送时不会越堆越多）。
 */
import { uploadMedia } from './api';

/** 正文图目标体积：给微信 1MB 上限留 100KB 余量。 */
const TEXT_TARGET_BYTES = 900_000;
/** 正文图硬上限（微信侧校验）。 */
const CONTENT_MAX_BYTES = 1024 * 1024;
/** 封面接口允许 10MB，超过才转换。 */
const COVER_MAX_BYTES = 10 * 1024 * 1024;
/** 公众号正文区约 677px，1440 在手机上仍然清晰。 */
const TARGET_WIDTH = 1440;
/** 编码重试次数上限：先降质量，再缩尺寸。 */
const MAX_ATTEMPTS = 8;

const CONTENT_MIMES = new Set(['image/jpeg', 'image/png']);
const COVER_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/bmp']);

/** `![alt](url "title")` / `![alt](<url>)`。 */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*(<[^>\s]*>|[^)\s]+)(?:\s+["'][^)]*["'])?\s*\)/g;

export interface WechatPrepareInput {
  contentMd: string;
  coverUrl: string;
}

export interface WechatPrepareResult {
  contentMd: string;
  coverUrl: string;
  /** 是否有图片被重新上传并改写了地址（调用方需要落库）。 */
  changed: boolean;
  /** 无法自动转换、仍交给服务端处理的图片说明。 */
  warnings: string[];
}

function normalizeMarkdownUrl(raw: string): string {
  const trimmed = raw.trim().replace(/^<|>$/g, '');
  return trimmed;
}

/** 只处理站内路径与 http(s) 外链；data: 等内联地址原样放过。 */
function isConvertibleUrl(url: string): boolean {
  return url.startsWith('/media/') || /^https?:\/\//i.test(url);
}

function sameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

interface FetchedImage {
  bytes: Uint8Array;
  mime: string;
}

/**
 * 取图片字节：站内直接读（同源，走 R2），外链走后端代理绕开 CORS。
 * 代理只搬运字节、不解码，符合免费版 CPU 预算。
 */
async function fetchImage(url: string): Promise<FetchedImage | null> {
  const target = sameOrigin(url) ? url : `/api/media/proxy?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(target, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime };
  } catch {
    return null;
  }
}

function jpegName(filename: string): string {
  const base = filename.replace(/\.[^./\\]+$/, '').replace(/[^\w.-]+/g, '-') || 'image';
  return `${base}.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * 用 Canvas 解码 → 等比缩到 ≤1440px → 编码成 jpeg，逐步降质量/缩尺寸直到 < `maxBytes`。
 *
 * Canvas 没有 EXIF 方向问题（`createImageBitmap` 默认按 `from-image` 处理），
 * 透明 PNG 会先铺白底再画，避免转 jpeg 后透明区变黑。
 */
async function convertToJpeg(
  image: FetchedImage,
  filename: string,
  maxBytes: number,
): Promise<File | null> {
  let bitmap: ImageBitmap;
  try {
    const buffer = image.bytes.buffer.slice(
      image.bytes.byteOffset,
      image.bytes.byteOffset + image.bytes.byteLength,
    ) as ArrayBuffer;
    bitmap = await createImageBitmap(
      new Blob([buffer], { type: image.mime || 'application/octet-stream' }),
    );
  } catch {
    return null;
  }

  let width = Math.min(TARGET_WIDTH, bitmap.width);
  let height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
  let quality = 0.85;

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size <= maxBytes) {
        return new File([blob], jpegName(filename), { type: 'image/jpeg' });
      }
      if (quality > 0.6) {
        quality = Math.max(0.6, quality - 0.1);
      } else {
        width = Math.max(1, Math.round(width * 0.8));
        height = Math.max(1, Math.round(height * 0.8));
      }
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/**
 * 把文章里需要转换的图片在浏览器侧转好并重新入库，返回改写后的正文/封面。
 *
 * 读取失败或转换失败的图片不会中断推送，只记一条 warning，由服务端给出
 * 「哪张图需要转换」的明确错误——不静默丢图。
 */
export async function prepareWechatAssets(
  input: WechatPrepareInput,
): Promise<WechatPrepareResult> {
  const cover = input.coverUrl.trim();
  const urls = new Set<string>();
  if (cover) urls.add(cover);
  for (const match of input.contentMd.matchAll(MARKDOWN_IMAGE)) {
    const url = normalizeMarkdownUrl(match[1] ?? '');
    if (isConvertibleUrl(url)) urls.add(url);
  }

  const replacements = new Map<string, string>();
  const warnings: string[] = [];

  for (const url of urls) {
    const isCover = url === cover;
    const fetched = await fetchImage(url);
    if (!fetched) {
      warnings.push(`${url} 读取失败，未能在浏览器侧转换`);
      continue;
    }

    const mimes = isCover ? COVER_MIMES : CONTENT_MIMES;
    const limit = isCover ? COVER_MAX_BYTES : CONTENT_MAX_BYTES;
    const outcome = await prepareOne(url, fetched, isCover, mimes, limit);
    if (outcome.kind === 'ok') continue;
    if (outcome.kind === 'failed') {
      warnings.push(`${url} 无法自动转换（浏览器不支持该格式或图片已损坏）`);
      continue;
    }
    try {
      const media = await uploadMedia(outcome.file);
      replacements.set(url, media.url);
    } catch (err) {
      warnings.push(`${url} 转换后上传失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  }

  let contentMd = input.contentMd;
  let coverUrl = cover;
  for (const [from, to] of replacements) {
    if (contentMd.includes(from)) contentMd = contentMd.split(from).join(to);
    if (coverUrl === from) coverUrl = to;
  }

  return { contentMd, coverUrl, changed: replacements.size > 0, warnings };
}

type PreparedImage =
  | { kind: 'ok' }
  | { kind: 'file'; file: File }
  | { kind: 'failed' };

/**
 * 合规就返回 `ok`（原样使用），需要转换则返回编码好的文件。
 *
 * 封面按微信封面接口的限制判断（10MB、收 gif/bmp），正文按 uploadimg 判断
 * （<1MB、只收 jpg/png），所以同一张图在两个位置可能有不同结论。
 */
async function prepareOne(
  url: string,
  image: FetchedImage,
  isCover: boolean,
  mimes: Set<string>,
  limit: number,
): Promise<PreparedImage> {
  if (mimes.has(image.mime) && image.bytes.byteLength <= limit) return { kind: 'ok' };
  const filename = url.split('/').pop()?.split('?')[0] ?? 'image';
  const target = isCover ? Math.min(limit, TEXT_TARGET_BYTES) : TEXT_TARGET_BYTES;
  const file = await convertToJpeg(image, filename, target);
  return file ? { kind: 'file', file } : { kind: 'failed' };
}
