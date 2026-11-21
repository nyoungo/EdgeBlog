/**
 * 远程图片压缩/转码（可选）。
 *
 * 免费版 Worker 每个请求只有 10ms CPU，跑不完 wasm 图片解码；定时任务又跑在
 * Worker 里，没有浏览器的 Canvas。配置一个 HTTP 压缩接口后，这两条路径都能在
 * 不依赖 wasm 的前提下，把 webp/avif 之类转成微信接受的 jpeg。
 *
 * 约定：
 *   - POST multipart/form-data，字段名 `file`；
 *   - 输出格式、压缩等级等参数由管理员直接拼在配置的地址上
 *     （例如 `…/image/compress?format=jpeg&level=1`），代码不写死；
 *   - 成功直接返回图片二进制（`Content-Type: image/*`），失败返回 JSON。
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

/**
 * 调远程接口把一张图转成 jpeg/png。
 *
 * 失败一律抛 `AppError` 并带上图名与阶段，调用方会把它拼进「第 N 张正文图片」
 * 的报错里；不做重试（每次调用都计费，而且大图本来就可能超时）。
 */
export async function compressImageRemotely(
  image: RemoteCompressInput,
  label: string,
  settings: Pick<WechatSettings, 'imageCompressUrl' | 'imageCompressToken'>,
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

  const form = new FormData();
  form.append(
    'file',
    new Blob([toArrayBuffer(image.bytes)], { type: image.mime || 'application/octet-stream' }),
    image.filename || 'image',
  );

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

  if (response.bytes.byteLength === 0) {
    throw AppError.upstream(`${label} 远程压缩返回了空内容`);
  }
  if (response.bytes.byteLength > MAX_OUTPUT_BYTES) {
    throw AppError.payloadTooLarge(
      `${label} 远程压缩后仍有 ${Math.round(response.bytes.byteLength / 1024)}KB，超过 10MB`,
    );
  }

  // 不信任 Content-Type：按文件头重新判定，防止对方把 JSON 错误页当图片返回。
  const mime = sniffImageMime(response.bytes);
  if (!mime || !REMOTE_OUTPUT_MIMES.has(mime)) {
    throw AppError.unsupportedMedia(
      `${label} 远程压缩返回了 ${mime || '无法识别的格式'}（Content-Type: ${response.contentType || '空'}），微信只收 jpg/png`,
    );
  }

  return { bytes: response.bytes, mime };
}
