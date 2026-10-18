/**
 * AI provider integration.
 *
 * Configuration lives in the `settings` table under an admin-only namespace so
 * the API key never appears in the public settings payload. All provider calls
 * happen server-side; the browser only ever sees generated text.
 */
import type { AiSettings } from '@shared/types';
import { AI_DEFAULTS, AI_NAMESPACE } from '@shared/settings-defaults';
import type { Env } from './env';
import { AppError } from './errors';

const PROVIDER_BASE: Record<AiSettings['provider'], string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  custom: '',
};

const REQUEST_TIMEOUT_MS = 60_000;

interface StoredRow {
  value_json: string;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function provider(value: unknown): AiSettings['provider'] {
  return value === 'openai' || value === 'deepseek' || value === 'custom' ? value : AI_DEFAULTS.provider;
}

/** Coerce a stored/patched object into a complete AiSettings record. */
function normalize(value: unknown): AiSettings {
  const src = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    enabled: bool(src['enabled'], AI_DEFAULTS.enabled),
    provider: provider(src['provider']),
    baseUrl: str(src['baseUrl'], AI_DEFAULTS.baseUrl).trim(),
    apiKey: str(src['apiKey'], AI_DEFAULTS.apiKey).trim(),
    model: str(src['model'], AI_DEFAULTS.model).trim(),
    temperature: Math.min(2, Math.max(0, num(src['temperature'], AI_DEFAULTS.temperature))),
    maxTokens: Math.min(32_000, Math.max(64, Math.round(num(src['maxTokens'], AI_DEFAULTS.maxTokens)))),
    excerptPrompt: str(src['excerptPrompt'], AI_DEFAULTS.excerptPrompt),
    contentPrompt: str(src['contentPrompt'], AI_DEFAULTS.contentPrompt),
  };
}

export async function readAiSettings(env: Env): Promise<AiSettings> {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key = ?')
    .bind(AI_NAMESPACE)
    .first<StoredRow>();
  if (!row) return structuredClone(AI_DEFAULTS);
  try {
    return normalize(JSON.parse(row.value_json));
  } catch {
    return structuredClone(AI_DEFAULTS);
  }
}

export async function writeAiSettings(env: Env, patch: Partial<AiSettings>): Promise<AiSettings> {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key = ?')
    .bind(AI_NAMESPACE)
    .first<StoredRow>();
  let current: unknown = {};
  if (row) {
    try {
      current = JSON.parse(row.value_json);
    } catch {
      current = {};
    }
  }
  const next = normalize({ ...(typeof current === 'object' && current !== null ? current : {}), ...patch });
  await env.DB.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`,
  )
    .bind(AI_NAMESPACE, JSON.stringify(next))
    .run();
  return next;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

function extractError(payload: ChatResponse, status: number): string {
  const detail = payload.error?.message;
  return detail ? `AI 服务返回错误：${detail}` : `AI 服务请求失败（HTTP ${status}）`;
}

/** Send a chat completion to the configured provider and return the text. */
export async function chatComplete(env: Env, messages: ChatMessage[]): Promise<string> {
  const ai = await readAiSettings(env);
  if (!ai.enabled) throw AppError.badRequest('AI 功能尚未启用，请先在「AI 设置」中开启');
  if (!ai.apiKey) throw AppError.badRequest('尚未配置 AI API Key，请先在「AI 设置」中填写');

  const base = ai.baseUrl || PROVIDER_BASE[ai.provider];
  if (!base) throw AppError.badRequest('尚未配置 AI 接口地址（Base URL）');
  if (!ai.model) throw AppError.badRequest('尚未配置 AI 模型名称');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint(base), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
        messages,
        temperature: ai.temperature,
        max_tokens: ai.maxTokens,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw AppError.upstream(
      err instanceof Error && err.name === 'AbortError' ? 'AI 请求超时，请稍后重试' : '无法连接 AI 服务，请检查接口地址',
    );
  } finally {
    clearTimeout(timer);
  }

  let payload: ChatResponse;
  try {
    payload = (await response.json()) as ChatResponse;
  } catch {
    throw AppError.upstream(`AI 服务返回了无法解析的响应（HTTP ${response.status}）`);
  }

  if (!response.ok) throw AppError.upstream(extractError(payload, response.status));

  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw AppError.upstream('AI 服务未返回内容，请稍后重试');
  return text;
}

interface ModelsResponse {
  data?: Array<{ id?: string }>;
  error?: { message?: string };
}

/** Fetch the provider's model catalogue (always uses the stored API key). */
export async function listAiModels(
  env: Env,
  override?: { provider?: AiSettings['provider']; baseUrl?: string },
): Promise<string[]> {
  const ai = await readAiSettings(env);
  if (!ai.apiKey) throw AppError.badRequest('请先填写并保存 API Key，再获取模型列表');

  const provider = override?.provider ?? ai.provider;
  const base = (override?.baseUrl ?? '').trim() || ai.baseUrl || PROVIDER_BASE[provider];
  if (!base) throw AppError.badRequest('尚未配置接口地址（Base URL）');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/+$/, '')}/models`, {
      headers: { authorization: `Bearer ${ai.apiKey}` },
      signal: controller.signal,
    });
  } catch (err) {
    throw AppError.upstream(
      err instanceof Error && err.name === 'AbortError'
        ? '获取模型列表超时，请稍后重试'
        : '无法连接 AI 服务，请检查接口地址',
    );
  } finally {
    clearTimeout(timer);
  }

  let payload: ModelsResponse;
  try {
    payload = (await response.json()) as ModelsResponse;
  } catch {
    throw AppError.upstream(`AI 服务返回了无法解析的响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw AppError.upstream(`获取模型列表失败：${payload.error?.message ?? `HTTP ${response.status}`}`);
  }

  const ids = Array.from(
    new Set(
      (payload.data ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) throw AppError.upstream('AI 服务未返回任何可用模型');
  return ids;
}
