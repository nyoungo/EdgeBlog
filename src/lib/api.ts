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

async function request<T>(method: Method, path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
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
  const res = await fetch('/api/media/upload', {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
  });
  const json = (await res.json()) as ApiResponse<import('@shared/types').MediaItem>;
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
