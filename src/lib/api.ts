/** Thin fetch wrapper implementing the API envelope + typed errors. */
import type { ApiMeta, ApiResponse } from '@shared/types';

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
    throw new ApiError(res.status, error.code, error.message, error.details);
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
