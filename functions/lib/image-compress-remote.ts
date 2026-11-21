/**
 * 远程图片压缩/转码（可选）。
 *
 * 免费版 Worker 每个请求只有 10ms CPU，跑不完 wasm 图片解码；定时任务又跑在
 * Worker 里，没有浏览器的 Canvas。配置一个 HTTP 压缩接口后，这两条路径都能在
 * 不依赖 wasm 的前提下，把 webp/avif 之类转成微信接受的 jpeg。
 *
 * 约定：
 *   - POST multipart/form-data；文件字段名可配置（uapis 为 `file`，scdn 为 `image`）；
 *   - 附加参数可配置为表单字段（`quality=70&outputFormat=jpeg&response=binary`），
 *     也可以由管理员直接拼在 URL 查询串上，代码不写死；
 *   - 成功可以返回图片二进制（`Content-Type: image/*`），也可以返回 JSON
 *     （`{ success, data: base64, format }`）。这里两种都识别。
 *
 * 实测限制：
 *   - 100KB 图约 2 秒；4MB 图约 37 秒；10MB 图对方直接 524；
 *   - 接口没有宽高/目标体积参数，输出可能仍大于微信正文图的 1MB。
 *
 * 因此这里只负责「转格式 + 中等压缩」，超时按 25 秒收窄，输出必须重新按
 * 微信限制校验——不达标就指名报错，不静默放行。
 */
import type { WechatSettings } from '@shared/types';
import { Deadline, withTimeout } from './deadline';
import { AppError } from './errors';
import { sniffImageMime } from './media-file';

/** 单张远程压缩最多等多久；还会被推送总预算进一步收窄。 */
export const REMOTE_COMPRESS_TIMEOUT_MS = 25_000;

/** 远程接口允许的输入上限（uapis 为 15MB，这里留余量）。 */
const MAX_INPUT_BYTES = 14 * 1024 * 1024;

/** 远程接口返回的最大字节数：超过这个值只能说明对方没有压缩，直接报错。 */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** JSON 响应里 base64 文本的长度上限（10MB 二进制约对应 13.4M 字符）。 */
const MAX_BASE64_CHARS = 20 * 1024 * 1024;

/** 只接受微信能用的两种格式。 */
const REMOTE_OUTPUT_MIMES = new Set(['image/jpeg', 'image/png']);

export interface RemoteCompressInput {
  bytes: Uint8Array;
  mime: string;
  filename: string;
}

export interface RemoteCompressResult {
  bytes: Uint8Array;
  mime: string;
}

/** 校验配置里的地址：必须是 https，查询参数由管理员自行拼在地址上。 */
function buildEndpoint(raw: string): string {
  const value = raw.trim();
  if (!value) throw AppError.badRequest('未配置图片压缩接口地址');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw AppError.badRequest('图片压缩接口地址不是合法的 URL');
  }
  if (url.protocol !== 'https:') {
    throw AppError.badRequest('图片压缩接口必须使用 https');
  }
  // 原样使用：输出格式 / 压缩等级等参数（如 format=jpeg&level=1）由配置方自己拼，
  // 不在代码里写死，方便切换到别的接口或调整参数。
  return url.toString();
}

/** 复制一份真正的 ArrayBuffer，避免把 wasm/共享内存视图交给 Blob。 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** 把配置里的表单参数（`a=1&b=2`）逐项追加；同名参数允许重复。 */
function appendParams(form: FormData, raw: string): void {
  const value = raw.trim().replace(/^\?/, '');
  if (!value) return;
  for (const [key, item] of new URLSearchParams(value)) {
    if (key) form.append(key, item);
  }
}

/** 响应看起来是不是 JSON 信封（Content-Type 或首个非空白字符为 `{`）。 */
function looksLikeJson(bytes: Uint8Array, contentType: string): boolean {
  if (/json/i.test(contentType)) return true;
  let i = 0;
  // 跳过 UTF-8 BOM 与前导空白。
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) {
    i += 1;
  }
  return bytes[i] === 0x7b; // '{'
}

/** 解 base64（兼容 `data:image/…;base64,` 前缀）。 */
function base64ToBytes(label: string, value: string): Uint8Array {
  if (value.length > MAX_BASE64_CHARS) {
    throw AppError.payloadTooLarge(`${label} 远程压缩返回的 base64 数据过大`);
  }
  const clean = value.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  let binary: string;
  try {
    binary = atob(clean);
  } catch {
    throw AppError.upstream(`${label} 远程压缩返回了无效的 base64 数据`);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

interface RemoteJsonEnvelope {
  success?: boolean;
  data?: string;
  format?: string;
  message?: string;
  error?: string;
}

/**
 * 兼容两种成功响应：图片二进制，或 `{ success, data(base64), format }` JSON。
 *
 * 后者是 compress.scdn.io 的默认形式（可用 `response=binary` 改成二进制）；
 * 无论哪种，最终都会再按文件头重新判定 MIME。
 */
function decodePayload(
  label: string,
  bytes: Uint8Array,
  contentType: string,
): Uint8Array {
  if (!looksLikeJson(bytes, contentType)) return bytes;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw AppError.upstream(`${label} 远程压缩返回了无法解析的 JSON`);
  }
  const envelope = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as RemoteJsonEnvelope;
  if (envelope.success === false) {
    throw AppError.upstream(
      `${label} 远程压缩失败：${envelope.message || envelope.error || '接口返回 success=false'}`,
    );
  }
  if (typeof envelope.data !== 'string' || envelope.data === '') {
    throw AppError.upstream(`${label} 远程压缩返回的 JSON 里没有 data 字段`);
  }
  return base64ToBytes(label, envelope.data);
}

/**
 * 调远程接口把一张图转成 jpeg/png。
 *
 * 失败一律抛 `AppError` 并带上图名与阶段，调用方会把它拼进「第 N 张正文图片」
 * 的报错里；不做重试（每次调用都计费，而且大图本来就可能超时）。
 */
export async function compressImageRemotely(
  image: RemoteCompressInput,
  label: string,
  settings: Pick<
    WechatSettings,
    | 'imageCompressUrl'
    | 'imageCompressToken'
    | 'imageCompressField'
    | 'imageCompressParams'
  >,
  deadline: Deadline,
): Promise<RemoteCompressResult> {
  if (image.bytes.byteLength > MAX_INPUT_BYTES) {
    throw AppError.payloadTooLarge(
      `${label} 体积 ${Math.round(image.bytes.byteLength / 1024)}KB，超过远程压缩接口 14MB 上限`,
    );
  }

  const endpoint = buildEndpoint(settings.imageCompressUrl);
  const timeout = deadline.take(
    REMOTE_COMPRESS_TIMEOUT_MS,
    `${label} 远程压缩前推送预算已用完`,
  );

  const field = (settings.imageCompressField || 'file').replace(/[^\w-]/g, '') || 'file';
  const form = new FormData();
  form.append(
    field,
    new Blob([toArrayBuffer(image.bytes)], { type: image.mime || 'application/octet-stream' }),
    image.filename || 'image',
  );
  appendParams(form, settings.imageCompressParams);

  const headers: Record<string, string> = {};
  const token = settings.imageCompressToken.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await withTimeout(
    async (signal) => {
      const res = await fetch(endpoint, { method: 'POST', body: form, headers, signal });
      if (!res.ok) {
        // 对方的错误说明经常是有用的（参数错、限额、源站超时），限长带上。
        const detail = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
        throw AppError.upstream(
          `${label} 远程压缩失败（HTTP ${res.status}${detail ? `：${detail}` : ''}）`,
        );
      }
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? '',
      };
    },
    timeout,
    `${label} 远程压缩超时（已等待 ${Math.round(timeout / 1000)} 秒）`,
  );

  const output = decodePayload(label, response.bytes, response.contentType);
  if (output.byteLength === 0) {
    throw AppError.upstream(`${label} 远程压缩返回了空内容`);
  }
  if (output.byteLength > MAX_OUTPUT_BYTES) {
    throw AppError.payloadTooLarge(
      `${label} 远程压缩后仍有 ${Math.round(output.byteLength / 1024)}KB，超过 10MB`,
    );
  }

  // 不信任 Content-Type：按文件头重新判定，防止对方把 JSON 错误页当图片返回。
  const mime = sniffImageMime(output);
  if (!mime || !REMOTE_OUTPUT_MIMES.has(mime)) {
    throw AppError.unsupportedMedia(
      `${label} 远程压缩返回了 ${mime || '无法识别的格式'}（Content-Type: ${response.contentType || '空'}），微信只收 jpg/png`,
    );
  }

  return { bytes: output, mime };
}
