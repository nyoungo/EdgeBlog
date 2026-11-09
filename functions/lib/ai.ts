/**
 * AI provider integration.
 *
 * Configuration lives in the `settings` table under an admin-only namespace so
 * the API key never appears in the public settings payload. All provider calls
 * happen server-side; the browser only ever sees generated text.
 *
 * Two transports are supported:
 *   * `cloudflare` — the Pages Functions `AI` binding (`env.AI.run`), no key.
 *   * everything else — any OpenAI-compatible `/chat/completions` endpoint.
 *
 * Both transports speak the same OpenAI-style message/tool schema, which keeps
 * the agent loop in `ai-agent.ts` provider-agnostic.
 */
import type { AiSettings } from '@shared/types';
import { AI_DEFAULTS, AI_NAMESPACE } from '@shared/settings-defaults';
import type { Env } from './env';
import { AppError } from './errors';

const PROVIDER_BASE: Record<AiSettings['provider'], string> = {
  cloudflare: '',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  custom: '',
};

const REQUEST_TIMEOUT_MS = 60_000;
const MODELS_TIMEOUT_MS = 20_000;

/** Shown when `env.AI.models()` is unavailable (older runtimes / offline). */
export const CLOUDFLARE_FALLBACK_MODELS = [
  '@cf/zai-org/glm-4.7-flash',
  '@cf/qwen/qwen3.8-27b',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/openai/gpt-oss-120b',
];

/** Loopback hosts tolerated over plain http so local providers keep working. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Validate an outbound provider URL before the stored API key is attached to a
 * request. Only http(s) is allowed: `new URL()` alone happily accepts
 * `javascript:`, `file:` or `data:` payloads.
 */
export function normalizeAiBaseUrl(env: Env, raw: string): string {
  const value = raw.trim();
  if (!value) return '';

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw AppError.badRequest('AI 接口地址不是合法的 URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw AppError.badRequest('AI 接口地址必须以 https:// 或 http:// 开头');
  }
  if (url.username || url.password) {
    throw AppError.badRequest('AI 接口地址不能包含用户名或密码');
  }
  const isDev = (env.ENVIRONMENT ?? 'production') === 'development';
  if (url.protocol === 'http:' && !isDev && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw AppError.badRequest('生产环境的 AI 接口地址必须使用 https://');
  }
  return value;
}

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
  return value === 'openai' || value === 'deepseek' || value === 'custom' || value === 'cloudflare'
    ? value
    : AI_DEFAULTS.provider;
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
  next.baseUrl = normalizeAiBaseUrl(env, next.baseUrl);
  await env.DB.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`,
  )
    .bind(AI_NAMESPACE, JSON.stringify(next))
    .run();
  return next;
}

/* --------------------------------------------------------------- readiness */

/** Whether this deployment exposes the Workers AI binding. */
export function aiBindingAvailable(env: Env): boolean {
  return Boolean(env.AI && typeof env.AI.run === 'function');
}

/** Feature enabled AND the selected transport is actually usable. */
export function aiProviderReady(env: Env, ai: AiSettings): boolean {
  if (!ai.enabled || !ai.model.trim()) return false;
  if (ai.provider === 'cloudflare') return aiBindingAvailable(env);
  return ai.apiKey.trim().length > 0;
}

/* ---------------------------------------------------------------- messages */

/** OpenAI-style tool call normalised across transports. */
export interface AiToolCall {
  id: string;
  name: string;
  /** Always a JSON string, as required by the OpenAI message format. */
  arguments: string;
}

/** Assistant-message tool call, in the shape both transports expect back. */
export interface AiMessageToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** OpenAI-style tool definition (also accepted by the Workers AI binding). */
export interface AiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool result name (Workers AI + OpenAI both accept it). */
  name?: string;
  /** OpenAI tool round-trip id. */
  tool_call_id?: string;
  /** Assistant tool calls (OpenAI-style nested shape). */
  tool_calls?: AiMessageToolCall[];
}

export interface AiCompletion {
  text: string;
  toolCalls: AiToolCall[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Extract generated text from the many shapes Workers AI models return.
 * Older models use `{ response }`; newer / OpenAI-compatible ones use
 * `{ choices: [{ message: { content } }] }`.
 */
export function extractAiText(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim();
  if (payload === null || payload === undefined) return '';

  const obj = asRecord(payload);
  const choice = asRecord(asArray(obj.choices)[0]);
  const message = asRecord(choice.message);
  const choiceText = message.content;
  if (typeof choiceText === 'string' && choiceText.trim()) return choiceText.trim();

  const response = obj.response;
  if (typeof response === 'string' && response.trim()) return response.trim();

  for (const key of ['text', 'output_text', 'generated_text']) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  // Some bindings wrap the payload in `result`.
  if (obj.result !== undefined && obj.result !== payload) return extractAiText(obj.result);
  return '';
}

/** Normalise flat (Workers AI) and OpenAI-style tool calls into one shape. */
export function extractToolCalls(payload: unknown): AiToolCall[] {
  const obj = asRecord(payload);
  const raw: unknown[] = [...asArray(obj.tool_calls)];

  const choice = asRecord(asArray(obj.choices)[0]);
  const message = asRecord(choice.message);
  raw.push(...asArray(message.tool_calls));
  if (message.function_call) raw.push({ function: message.function_call });

  const calls: AiToolCall[] = [];
  raw.forEach((entry, index) => {
    const rec = asRecord(entry);
    const fn = asRecord(rec.function);
    const name = typeof fn.name === 'string' ? fn.name : typeof rec.name === 'string' ? rec.name : '';
    if (!name) return;

    const args = fn.arguments !== undefined ? fn.arguments : rec.arguments;
    const serialised =
      typeof args === 'string'
        ? args
        : args === undefined || args === null
          ? '{}'
          : JSON.stringify(args);
    const id =
      typeof rec.id === 'string' && rec.id
        ? rec.id
        : `call_${Date.now().toString(36)}_${index}`;
    calls.push({ id, name, arguments: serialised });
  });
  return calls;
}

/* -------------------------------------------------------------- transport */

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(AppError.upstream(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: unknown[];
      function_call?: { name?: string; arguments?: string };
    };
  }>;
  response?: unknown;
  tool_calls?: unknown[];
  error?: { message?: string };
}

function extractError(payload: unknown, status: number): string {
  const detail = asRecord(asRecord(payload).error).message;
  return typeof detail === 'string' && detail
    ? `AI 服务返回错误：${detail}`
    : `AI 服务请求失败（HTTP ${status}）`;
}

/**
 * Run one chat completion, optionally with tools.
 * Returns the text and any tool calls; the caller decides whether to loop.
 */
export async function aiChatComplete(
  env: Env,
  messages: ChatMessage[],
  tools?: AiToolDefinition[],
): Promise<AiCompletion> {
  const ai = await readAiSettings(env);
  if (!ai.enabled) throw AppError.badRequest('AI 功能尚未启用，请先在「AI 设置」中开启');
  if (!ai.model) throw AppError.badRequest('尚未配置 AI 模型名称');

  if (ai.provider === 'cloudflare') {
    if (!aiBindingAvailable(env) || !env.AI) {
      throw AppError.badRequest('未检测到 Workers AI 绑定，请检查 wrangler.toml 或 Pages 控制台的 AI 绑定');
    }

    const inputs: Record<string, unknown> = {
      // The binding requires a string content (it rejects null).
      messages: messages.map((message) => ({ ...message, content: message.content ?? '' })),
      temperature: ai.temperature,
      max_tokens: ai.maxTokens,
    };
    if (tools && tools.length > 0) {
      inputs.tools = tools;
      inputs.tool_choice = 'auto';
    }

    let payload: unknown;
    try {
      payload = await withTimeout(
        env.AI.run(ai.model, inputs),
        REQUEST_TIMEOUT_MS,
        'Workers AI 请求超时，请稍后重试',
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.upstream(
        `Workers AI 请求失败：${err instanceof Error ? err.message : '未知错误'}`,
      );
    }

    const text = extractAiText(payload);
    const toolCalls = extractToolCalls(payload);
    if (!text && toolCalls.length === 0) {
      throw AppError.upstream('Workers AI 未返回内容，请稍后重试');
    }
    return { text, toolCalls };
  }

  if (!ai.apiKey) throw AppError.badRequest('尚未配置 AI API Key，请先在「AI 设置」中填写');

  const base = normalizeAiBaseUrl(env, ai.baseUrl || PROVIDER_BASE[ai.provider]);
  if (!base) throw AppError.badRequest('尚未配置 AI 接口地址（Base URL）');

  const body: Record<string, unknown> = {
    model: ai.model,
    messages,
    temperature: ai.temperature,
    max_tokens: ai.maxTokens,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

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
      body: JSON.stringify(body),
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

  const text = extractAiText(payload);
  const toolCalls = extractToolCalls(payload);
  if (!text && toolCalls.length === 0) {
    throw AppError.upstream('AI 服务未返回内容，请稍后重试');
  }
  return { text, toolCalls };
}

/** Send a chat completion to the configured provider and return the text. */
export async function chatComplete(env: Env, messages: ChatMessage[]): Promise<string> {
  const { text, toolCalls } = await aiChatComplete(env, messages);
  if (!text.trim()) {
    throw AppError.upstream(
      toolCalls.length > 0 ? 'AI 服务只返回了工具调用，未返回文本内容' : 'AI 服务未返回内容，请稍后重试',
    );
  }
  return text.trim();
}

/* ----------------------------------------------------------------- models */

interface ModelsResponse {
  data?: Array<{ id?: string }>;
  error?: { message?: string };
}

/** Fetch the provider's model catalogue. Workers AI uses the binding. */
export async function listAiModels(
  env: Env,
  override?: { provider?: AiSettings['provider']; baseUrl?: string },
): Promise<string[]> {
  const ai = await readAiSettings(env);
  const provider = override?.provider ?? ai.provider;

  if (provider === 'cloudflare') {
    if (!aiBindingAvailable(env) || !env.AI) {
      throw AppError.badRequest('未检测到 Workers AI 绑定，请检查 wrangler.toml 或 Pages 控制台的 AI 绑定');
    }
    try {
      const list = await withTimeout(
        env.AI.models({ task: 'Text Generation' }),
        MODELS_TIMEOUT_MS,
        '获取模型列表超时，请稍后重试',
      );
      const ids = Array.from(
        new Set(
          list
            .map((entry) => entry.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ).sort((a, b) => a.localeCompare(b));
      if (ids.length > 0) return ids;
    } catch {
      // Fall through to the curated list so the settings page stays usable.
    }
    return [...CLOUDFLARE_FALLBACK_MODELS];
  }

  if (!ai.apiKey) throw AppError.badRequest('请先填写并保存 API Key，再获取模型列表');

  const base = normalizeAiBaseUrl(
    env,
    (override?.baseUrl ?? '').trim() || ai.baseUrl || PROVIDER_BASE[provider],
  );
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
    const detail = asRecord(asRecord(payload).error).message;
    throw AppError.upstream(
      `获取模型列表失败：${typeof detail === 'string' && detail ? detail : `HTTP ${response.status}`}`,
    );
  }

  const ids = Array.from(
    new Set(
      asArray(asRecord(payload).data)
        .map((entry) => asRecord(entry).id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) throw AppError.upstream('AI 服务未返回任何可用模型');
  return ids;
}
