/**
 * 按 URL 转码：把「微信不能直接收」的图片交给图片代理去拉取并缩放。
 *
 * 为什么需要它：定时发文跑在 Worker 里，没有浏览器的 Canvas，免费版也跑不了
 * wasm；而上传式的远程压缩接口（compress.scdn.io 等）经常带 JS 反爬，Cloudflare
 * 出站请求会被拦成 `HTTP 456` + `<script src="/_guard/html.js?js=p456">`，于是每天
 * 定时推送都卡在同一张图，手动推送因为浏览器侧先转好了图反而看不出问题。
 *
 * 这里改用 GET：把原图公网地址拼在配置的模板末尾，由代理自己下载并缩放，Worker
 * 只搬运字节，不占 CPU。
 *
 * 限制：
 *   - 只对公网 http(s) 地址生效（站内 /media 需要先拼成绝对地址）；
 *   - 默认模板 wsrv.nl 按域名策略拒绝部分 TLD（实测 `.xyz` 被拒），此时只能退回到
 *     「用编辑器在浏览器侧压缩」；
 *   - 代理没有目标体积参数，输出仍要按微信限制重新校验，不达标就指名报错。
 */
import type { WechatSettings } from '@shared/types';
import { Deadline, withTimeout } from './deadline';
import { AppError } from './errors';
import { sniffImageMime } from './media-file';

/** 单张转码最多等多久；还会被推送总预算进一步收窄。 */
export const IMAGE_TRANSFORM_TIMEOUT_MS = 25_000;

/** 代理返回的最大字节数：超过这个值只能说明对方没有压缩，直接报错。 */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** 只接受微信能用的两种格式。 */
const OUTPUT_MIMES = new Set(['image/jpeg', 'image/png']);

export interface UrlTransformResult {
  bytes: Uint8Array;
  mime: string;
}

/** 只有公网 http(s) 地址才能交给外部代理去拉取。 */
export function isTransformableUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

/**
 * 用图片代理把 `sourceUrl` 转成微信能收的 jpeg/png。
 *
 * `template` 必须以 `?url=` / `&url=` 结尾（宽度、质量等参数由管理员自己拼），
 * 这里只追加编码后的原图地址——与 `imageCompressUrl` 一样，代码不写死参数。
 */
export async function transformImageByUrl(
  sourceUrl: string,
  label: string,
  settings: Pick<WechatSettings, 'imageTransformUrl'>,
  maxBytes: number,
  deadline: Deadline,
): Promise<UrlTransformResult> {
  const template = settings.imageTransformUrl.trim();
  if (!template) throw AppError.badRequest('未配置图片转码接口地址');
  let parsed: URL;
  try {
    parsed = new URL(template);
  } catch {
    throw AppError.badRequest('图片转码接口地址不是合法的 URL');
  }
  if (parsed.protocol !== 'https:') throw AppError.badRequest('图片转码接口必须使用 https');
  // 保留管理员写的原始字符串（URL 归一化会重排/重编码查询串）。
  const endpoint = `${template}${encodeURIComponent(sourceUrl.trim())}`;

  const timeout = deadline.take(
    IMAGE_TRANSFORM_TIMEOUT_MS,
    `${label} 图片转码前推送预算已用完`,
  );

  const response = await withTimeout(
    async (signal) => {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: { accept: 'image/jpeg,image/png' },
        signal,
      });
      if (!res.ok) {
        // 对方的说明常常有用（域名被策略拒绝、图片太大、源站 404），限长带上。
        const detail = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
        throw AppError.upstream(
          `${label} 图片转码失败（HTTP ${res.status}${detail ? `：${detail}` : ''}）`,
        );
      }
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? '',
      };
    },
    timeout,
    `${label} 图片转码超时（已等待 ${Math.round(timeout / 1000)} 秒）`,
  );

  const bytes = response.bytes;
  if (bytes.byteLength === 0) throw AppError.upstream(`${label} 图片转码返回了空内容`);
  if (bytes.byteLength > MAX_OUTPUT_BYTES) {
    throw AppError.payloadTooLarge(
      `${label} 图片转码后仍有 ${Math.round(bytes.byteLength / 1024)}KB，超过 10MB`,
    );
  }
  // 不信任 Content-Type：按文件头重新判定，防止对方把 JSON 错误页当图片返回。
  const mime = sniffImageMime(bytes);
  if (!mime || !OUTPUT_MIMES.has(mime)) {
    throw AppError.unsupportedMedia(
      `${label} 图片转码返回了 ${mime || '无法识别的格式'}（Content-Type: ${response.contentType || '空'}），微信只收 jpg/png`,
    );
  }
  if (bytes.byteLength > maxBytes) {
    throw AppError.payloadTooLarge(
      `${label} 图片转码后仍有 ${Math.round(bytes.byteLength / 1024)}KB，超过 ${Math.round(
        maxBytes / 1024,
      )}KB 上限（该接口没有目标体积参数）`,
    );
  }
  return { bytes, mime };
}
