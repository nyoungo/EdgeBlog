/** Thin fetch wrapper implementing the API envelope + typed errors. */
import type { ApiMeta, ApiResponse } from '@shared/types';
import { captureVideoThumbnail } from './video-thumbnail';
import { isVideoUrl } from './hero-media';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: ApiMeta;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** 普通请求的超时上限（毫秒）。 */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 媒体上传（可能是几十 MB 的视频）的超时上限。 */
const UPLOAD_TIMEOUT_MS = 300_000;

/**
 * 按路径判定长耗时接口的超时上限。
 *
 * 这些接口在服务端要串行做多次外部调用（AI 生成、公众号推送、定时任务执行），
 * 30 秒必然不够；但也不能不设上限——请求挂死时界面会一直转圈。取值都比服务端
 * 自己的预算略大，让服务端先返回明确的错误，而不是前端先掐断。
 */
function timeoutForPath(path: string): number {
  // 公众号推送：服务端整条推送预算 100 秒（见 WECHAT_PUSH_BUDGET_MS）。
  if (path.startsWith('/wechat/posts/') && path.endsWith('/draft')) return 130_000;
  // AI 生成的单次请求上限由「AI 设置」控制（默认 5 分钟）。
  if (path === '/ai/generate' || path === '/ai/chat') return 330_000;
  // 手动执行定时任务：正文 6 分钟 + 封面 3 分钟 + 推送。
  if (/^\/automation\/\d+\/run$/.test(path)) return 660_000;
  return DEFAULT_TIMEOUT_MS;
}

/** 把超时归一成可读的 ApiError，避免界面一直转圈。 */
function timeoutError(ms: number): ApiError {
  const seconds = Math.round(ms / 1000);
  return new ApiError(0, 'TIMEOUT', `请求超时（已等待 ${seconds} 秒），请稍后重试`);
}

/**
 * Called when a request that needed a session came back 401 (expired cookie,
 * revoked session after a password change on another device, …). AuthProvider
 * registers this so the UI drops stale state instead of silently showing
 * "failed to load" everywhere.
 */
let unauthorizedHandler: ((error: ApiError) => void) | null = null;

export function setUnauthorizedHandler(handler: ((error: ApiError) => void) | null): void {
  unauthorizedHandler = handler;
}

/** Endpoints where a 401 is an expected answer, not a lost session. */
const AUTH_PROBES = new Set(['/auth/me', '/auth/login']);

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  timeoutMs = timeoutForPath(path),
): Promise<ApiResult<T>> {
  // 超时同时管住连接与读取响应体：只包 fetch 时，服务端迟迟不结束响应
  // 会让 `res.text()` 一直挂着。
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  let text: string;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    if (controller.signal.aborted) throw timeoutError(timeoutMs);
    throw err instanceof Error
      ? new ApiError(0, 'NETWORK_ERROR', err.message || '网络请求失败')
      : new ApiError(0, 'NETWORK_ERROR', '网络请求失败');
  } finally {
    window.clearTimeout(timer);
  }

  let json: ApiResponse<T> | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as ApiResponse<T>;
    } catch {
      json = null;
    }
  }

  if (!json || json.ok !== true) {
    const error =
      json && json.ok === false
        ? json.error
        : { code: `HTTP_${res.status}`, message: res.statusText || '请求失败' };
    const apiError = new ApiError(res.status, error.code, error.message, error.details);
    if (apiError.status === 401 && !AUTH_PROBES.has(path)) {
      unauthorizedHandler?.(apiError);
    }
    throw apiError;
  }
  return json.meta ? { data: json.data, meta: json.meta } : { data: json.data };
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Upload a file to the media library (multipart, bypasses the JSON wrapper). */
export async function uploadMedia(file: File): Promise<import('@shared/types').MediaItem> {
  const form = new FormData();
  form.append('file', file);
  // 视频上传时顺带抽首帧当封面：移动端英雄区与视频加载前都靠它兜底。
  // 抽帧失败（编码不支持/跨域/超时）不阻塞上传，只是没有封面。
  if (file.type.startsWith('video/') || isVideoUrl(file.name)) {
    const thumbnail = await captureVideoThumbnail(file);
    if (thumbnail) form.append('thumbnail', thumbnail);
  }
  // 视频文件可达数十 MB，给足时间，但不留「永远等下去」的可能。
  const ms = UPLOAD_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  let res: Response;
  let json: ApiResponse<import('@shared/types').MediaItem>;
  try {
    res = await fetch('/api/media/upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
      signal: controller.signal,
    });
    json = (await res.json()) as ApiResponse<import('@shared/types').MediaItem>;
  } catch (err) {
    if (controller.signal.aborted) throw timeoutError(ms);
    throw err instanceof Error
      ? new ApiError(0, 'NETWORK_ERROR', err.message || '上传失败')
      : new ApiError(0, 'NETWORK_ERROR', '上传失败');
  } finally {
    window.clearTimeout(timer);
  }
  if (!json.ok) throw new ApiError(res.status, json.error.code, json.error.message, json.error.details);
  return json.data;
}

/** Build a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}
