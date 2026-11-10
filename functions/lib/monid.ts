/**
 * Monid 搜索聚合网关（api.monid.ai）的请求构造与响应解析。
 *
 * Monid 把多家搜索 / 数据服务统一收敛到 `POST /v1/run`：调用方给出 provider
 * 与 endpoint，网关转发请求并把原始结果放进 `output`。这里固定使用已验证的
 * TinyFish 免费网页搜索（`/free/search`，GET + queryParams，不消耗钱包余额），
 * 它返回的 title / url / snippet 正好能映射成内部的 SearchResult。
 *
 * 本文件只做纯函数，网络请求留在 ai-agent.ts 里，便于单测。
 */
import type { SearchResult } from './serp';

/** Monid 网关地址。 */
export const MONID_API_BASE = 'https://api.monid.ai';

/** 默认使用的 Monid provider（TinyFish）。 */
export const MONID_SEARCH_PROVIDER = 'tinyfish';

/** TinyFish 的免费网页搜索 endpoint。 */
export const MONID_SEARCH_ENDPOINT = '/free/search';

export interface MonidSearchRequest {
  provider: string;
  endpoint: string;
  input: {
    queryParams: { query: string };
  };
}

/** 把 limit 收敛到 1–10，与其它搜索通道保持一致。 */
function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit) || 5, 1), 10);
}

/** 构造 `POST /v1/run` 的请求体。 */
export function buildMonidSearchRequest(query: string): MonidSearchRequest {
  return {
    provider: MONID_SEARCH_PROVIDER,
    endpoint: MONID_SEARCH_ENDPOINT,
    input: { queryParams: { query } },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 从网关响应里找出结果数组。
 *
 * 正常响应是 `{ output: { results: [...] } }`；不同 provider 或网关版本也
 * 可能把结果放在顶层 `results` / `items` 或 `data.results` 下，这里一并兼容。
 */
function readItems(payload: unknown): unknown[] {
  const root = asRecord(payload);
  const output = asRecord(root.output);
  const data = asRecord(root.data);
  const candidates = [output.results, root.results, output.items, root.items, data.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

/**
 * 把 Monid 的响应体映射成 `SearchResult[]`。
 *
 * 字段名做了兼容：不同搜索 provider 可能用 `link` / `href` 代替 `url`，
 * 用 `description` / `content` 代替 `snippet`。非法链接、重复链接会被跳过。
 */
export function parseMonidSearchOutput(payload: unknown, limit = 5): SearchResult[] {
  const max = clampLimit(limit);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const raw of readItems(payload)) {
    const item = asRecord(raw);
    const url = asText(item.url) || asText(item.link) || asText(item.href);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;

    const title = asText(item.title) || asText(item.name) || asText(item.site_name) || url;
    const snippet =
      asText(item.snippet) || asText(item.description) || asText(item.content) || asText(item.text);

    seen.add(url);
    results.push({ title, url, snippet });
    if (results.length >= max) break;
  }

  return results;
}

/** 把 Monid 的错误响应压成一句可读信息（不泄漏密钥）。 */
export function describeMonidError(payload: unknown, status: number): string {
  const root = asRecord(payload);
  const message = (asText(root.message) || asText(root.error)).slice(0, 200);
  if (status === 401 || status === 403) {
    return message ? `API Key 无效或无权访问：${message}` : 'API Key 无效或无权访问';
  }
  if (status === 402) {
    return message ? `账户余额不足：${message}` : '账户余额不足';
  }
  return message ? `HTTP ${status}：${message}` : `HTTP ${status}`;
}
