/**
 * 微信公众号服务端接口客户端（草稿推送用）。
 *
 * 只覆盖文章同步到草稿箱所需的几个接口：
 *   * `stable_token`          —— 稳定版 access_token（KV 缓存，提前刷新）
 *   * `media/uploadimg`       —— 正文图片，返回可内嵌正文的 mmbiz URL
 *   * `material/add_material` —— 封面永久素材，返回永久 thumb_media_id
 *   * `draft/add`             —— 新增草稿
 *   * `draft/update`          —— 更新既有草稿（去重命中时）
 *   * `freepublish/submit`    —— 可选：把草稿真正发表
 *
 * 约束（已核对官方文档）：
 *   * uploadimg 仅收 jpg/png 且单张 < 1MB；
 *   * add_material 图片 ≤ 10MB，支持 bmp/png/jpeg/jpg/gif；
 *   * draft/add 的 content 必须 < 2 万字符、< 1M，正文图片 URL 必须来自 uploadimg。
 *
 * 所有出站错误统一包成 `AppError.upstream`，只回显微信的 errcode/errmsg，
 * 绝不把 AppSecret 带进错误信息或日志。
 */
import type { WechatSettings } from '@shared/types';
import type { Env } from './env';
import { AppError } from './errors';

export const WECHAT_API_BASE = 'https://api.weixin.qq.com';

/** access_token 提前刷新的安全窗口（秒），避免边界上刚好过期。 */
const TOKEN_REFRESH_MARGIN_SECONDS = 300;

/** 单次微信接口请求的最长等待时间。 */
const WECHAT_TIMEOUT_MS = 30_000;

/** 微信在 HTTP 200 里返回的 JSON 信封。 */
interface WechatEnvelope {
  errcode?: number;
  errmsg?: string;
  [key: string]: unknown;
}

/** 需要清缓存重试的 token 相关错误码。 */
const TOKEN_ERROR_CODES = new Set([40001, 42001, 40014]);

function tokenCacheKey(appId: string): string {
  return `wechat:token:${appId}`;
}

/** 带超时的 fetch，超时归一成 upstream 错误。 */
async function fetchWithTimeout(url: string, init: RequestInit, label: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WECHAT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw AppError.upstream(
      err instanceof Error && err.name === 'AbortError'
        ? `调用微信「${label}」接口超时，请稍后重试`
        : `无法连接微信接口（${label}），请检查网络`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 解析响应体 JSON，失败归一成 upstream 错误。 */
async function readEnvelope(response: Response, label: string): Promise<WechatEnvelope> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw AppError.upstream(`微信「${label}」接口返回了非 JSON 响应（HTTP ${response.status}）`);
  }
  const body = (typeof payload === 'object' && payload !== null ? payload : {}) as WechatEnvelope;
  // 微信几乎总是 HTTP 200，错误通过 errcode 表达；HTTP 非 2xx 时兜底判错。
  const code = typeof body.errcode === 'number' ? body.errcode : 0;
  if (code !== 0) {
    throw AppError.upstream(`微信「${label}」接口返回错误 ${code}：${body.errmsg ?? '未知错误'}`);
  }
  if (!response.ok) {
    throw AppError.upstream(`微信「${label}」接口请求失败（HTTP ${response.status}）`);
  }
  return body;
}

/** 从任意错误里取出微信 errcode（0 表示取不到）。 */
function errcodeOf(err: unknown): number {
  if (!(err instanceof AppError)) return 0;
  const match = /返回错误 (\d+)/.exec(err.message);
  return match?.[1] ? Number(match[1]) : 0;
}

/**
 * 取稳定版 access_token。
 *
 * 普通模式下微信在有效期内会返回同一个 token，因此 KV 缓存足够；
 * 遇到 token 失效类错误码时由 `withToken` 清缓存重试一次。
 */
async function fetchAccessToken(
  env: Env,
  settings: WechatSettings,
  forceRefresh = false,
): Promise<string> {
  const response = await fetchWithTimeout(
    `${WECHAT_API_BASE}/cgi-bin/stable_token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credential',
        appid: settings.appId,
        secret: settings.appSecret,
        force_refresh: forceRefresh,
      }),
    },
    'stable_token',
  );
  const body = await readEnvelope(response, 'stable_token');
  const token = typeof body.access_token === 'string' ? body.access_token : '';
  if (!token) throw AppError.upstream('微信未返回 access_token，请检查 AppID / AppSecret');
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 7200;
  const ttl = Math.max(60, expiresIn - TOKEN_REFRESH_MARGIN_SECONDS);
  try {
    await env.CACHE?.put(tokenCacheKey(settings.appId), token, { expirationTtl: ttl });
  } catch {
    // 缓存是尽力而为：写不进去也不影响本次调用。
  }
  return token;
}

/** 取（可缓存的）access_token。 */
async function getAccessToken(env: Env, settings: WechatSettings): Promise<string> {
  if (!env.CACHE) return fetchAccessToken(env, settings);
  const cached = await env.CACHE.get(tokenCacheKey(settings.appId)).catch(() => null);
  if (cached) return cached;
  return fetchAccessToken(env, settings);
}

async function clearAccessToken(env: Env, settings: WechatSettings): Promise<void> {
  try {
    await env.CACHE?.delete(tokenCacheKey(settings.appId));
  } catch {
    /* ignore */
  }
}

/**
 * 用 token 调一次微信接口；若因 token 失效报错，则清缓存重取并重试一次。
 * `call` 收到的是当前可用的 access_token。
 */
async function withToken<T>(
  env: Env,
  settings: WechatSettings,
  call: (token: string) => Promise<T>,
): Promise<T> {
  const token = await getAccessToken(env, settings);
  try {
    return await call(token);
  } catch (err) {
    // 40001/42001/40014：token 失效或被顶掉，清缓存后重试一次。
    if (!TOKEN_ERROR_CODES.has(errcodeOf(err))) throw err;
    await clearAccessToken(env, settings);
    const fresh = await fetchAccessToken(env, settings, true);
    return call(fresh);
  }
}

/** 组装 multipart/form-data 上传体（字段名固定为 `media`）。 */
function mediaForm(bytes: Uint8Array, mime: string, filename: string): FormData {
  const form = new FormData();
  form.append('media', new Blob([bytes], { type: mime }), filename);
  return form;
}

/**
 * 上传一张正文图片，返回可嵌入图文正文的 URL。
 *
 * 仅支持 jpg/png 且 < 1MB；类型不符由调用方在渲染阶段先行拦截（带图名报错），
 * 这里只兜底转发微信的 40005/40009。
 */
export async function uploadContentImage(
  env: Env,
  settings: WechatSettings,
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<string> {
  return withToken(env, settings, async (token) => {
    const response = await fetchWithTimeout(
      `${WECHAT_API_BASE}/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`,
      { method: 'POST', body: mediaForm(bytes, mime, filename) },
      'uploadimg',
    );
    const body = await readEnvelope(response, 'uploadimg');
    const url = typeof body.url === 'string' ? body.url : '';
    if (!url) throw AppError.upstream('微信未返回正文图片 URL');
    return url;
  });
}

/**
 * 上传封面为永久素材，返回永久 media_id（draft/add 的 thumb_media_id 必须是它）。
 */
export async function uploadCoverMaterial(
  env: Env,
  settings: WechatSettings,
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<string> {
  return withToken(env, settings, async (token) => {
    const response = await fetchWithTimeout(
      `${WECHAT_API_BASE}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`,
      { method: 'POST', body: mediaForm(bytes, mime, filename) },
      'add_material',
    );
    const body = await readEnvelope(response, 'add_material');
    const mediaId = typeof body.media_id === 'string' ? body.media_id : '';
    if (!mediaId) throw AppError.upstream('微信未返回封面素材 media_id');
    return mediaId;
  });
}

/** draft/add / draft/update 共用的一篇文章结构。 */
export interface WechatArticle {
  title: string;
  author: string;
  digest: string;
  content: string;
  contentSourceUrl: string;
  thumbMediaId: string;
  needOpenComment: 0 | 1;
  onlyFansCanComment: 0 | 1;
}

function articlePayload(article: WechatArticle): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    article_type: 'news',
    title: article.title,
    digest: article.digest,
    content: article.content,
    thumb_media_id: article.thumbMediaId,
    need_open_comment: article.needOpenComment,
    only_fans_can_comment: article.onlyFansCanComment,
  };
  if (article.author) payload.author = article.author;
  if (article.contentSourceUrl) payload.content_source_url = article.contentSourceUrl;
  return payload;
}

/** 新增草稿，返回 media_id。 */
export async function addDraft(
  env: Env,
  settings: WechatSettings,
  article: WechatArticle,
): Promise<string> {
  return withToken(env, settings, async (token) => {
    const response = await fetchWithTimeout(
      `${WECHAT_API_BASE}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articles: [articlePayload(article)] }),
      },
      'draft/add',
    );
    const body = await readEnvelope(response, 'draft/add');
    const mediaId = typeof body.media_id === 'string' ? body.media_id : '';
    if (!mediaId) throw AppError.upstream('微信未返回草稿 media_id');
    return mediaId;
  });
}

/** 更新既有草稿（去重命中时用，避免草稿箱堆重复项）。 */
export async function updateDraft(
  env: Env,
  settings: WechatSettings,
  mediaId: string,
  article: WechatArticle,
): Promise<void> {
  await withToken(env, settings, async (token) => {
    const response = await fetchWithTimeout(
      `${WECHAT_API_BASE}/cgi-bin/draft/update?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId, index: 0, articles: articlePayload(article) }),
      },
      'draft/update',
    );
    await readEnvelope(response, 'draft/update');
    return undefined;
  });
}

/** 可选：把草稿真正提交发表（publish_mode=publish 时使用）。 */
export async function submitPublish(
  env: Env,
  settings: WechatSettings,
  mediaId: string,
): Promise<string> {
  return withToken(env, settings, async (token) => {
    const response = await fetchWithTimeout(
      `${WECHAT_API_BASE}/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId }),
      },
      'freepublish/submit',
    );
    const body = await readEnvelope(response, 'freepublish/submit');
    return typeof body.publish_id === 'string' ? body.publish_id : '';
  });
}

/**
 * 连通性自检：拉一次 access_token 并把结果写进 KV。
 * 只回显「成功 / errcode+errmsg」，不泄漏凭据。
 */
export async function testWechatConnection(env: Env, settings: WechatSettings): Promise<string> {
  await fetchAccessToken(env, settings);
  return `已成功获取 access_token（AppID ${settings.appId.slice(0, 6)}…）`;
}
