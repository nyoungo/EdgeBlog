/**
 * AI provider integration.
 *
 * Configuration lives in the `settings` table under an admin-only namespace so
 * the API key never appears in the public settings payload. All provider calls
 * happen server-side; the browser only ever sees generated text.
 *
 * Two transports are supported:
 *   * `cloudflare` — the Workers AI binding (`env.AI.run`), no key.
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

/** 推理模型的 reasoning 也计入 max_tokens；预算耗尽时按此区间重试一次。 */
const REASONING_RETRY_MIN_TOKENS = 1024;
const REASONING_RETRY_MAX_TOKENS = 8192;

/**
 * Shown when `env.AI.models()` is unavailable (older runtimes / offline).
 * 首项是非推理的快速模型：推理模型会把预算花在 reasoning 上，正文更容易被截断。
 */
export const CLOUDFLARE_FALLBACK_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/zai-org/glm-4.7-flash',
  '@cf/qwen/qwen3.8-27b',
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
    monidApiKey: str(src['monidApiKey'], AI_DEFAULTS.monidApiKey).trim(),
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
 * 把模型返回的 content 归一化成纯文本。
 *
 * 除了字符串，真实响应里还有几种形态必须兼容，否则会被误判成「未返回内容」：
 *   * `null` —— 推理模型（如 glm-4.7-flash）把正文前的思考放进了 reasoning 字段；
 *   * 数组分片 —— 部分模型/兼容层返回 `[{ type: 'text', text: '...' }]`；
 *   * 对象 —— `{ text: '...' }`。
 */
function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        const rec = asRecord(part);
        return typeof rec.text === 'string' ? rec.text : '';
      })
      .join('')
      .trim();
  }
  const rec = asRecord(value);
  return typeof rec.text === 'string' ? rec.text.trim() : '';
}

/** 读取 finish_reason（OpenAI 兼容层在 choices[0]，个别实现放顶层）。 */
function finishReasonOf(payload: unknown): string | undefined {
  const obj = asRecord(payload);
  const choice = asRecord(asArray(obj.choices)[0]);
  const reason = choice.finish_reason ?? obj.finish_reason;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * Extract generated text from the many shapes Workers AI models return.
 * Older models use `{ response }`; newer / OpenAI-compatible ones use
 * `{ choices: [{ message: { content } }] }`.
 */
export function extractAiText(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim();
  if (payload === null || payload === undefined) return '';

  // 个别模型直接返回分片数组，先拼成字符串再判断。
  if (Array.isArray(payload)) return textFromContent(payload);

  const obj = asRecord(payload);
  const choice = asRecord(asArray(obj.choices)[0]);
  const message = asRecord(choice.message);

  for (const candidate of [
    message.content,
    choice.text,
    obj.response,
    obj.text,
    obj.output_text,
    obj.generated_text,
  ]) {
    const text = textFromContent(candidate);
    if (text) return text;
  }

  // Some bindings wrap the payload in `result`.
  if (obj.result !== undefined && obj.result !== payload) return extractAiText(obj.result);
  return '';
}

/**
 * 推理模型（glm-4.7-flash、gpt-oss 等）会把思维链放在 reasoning 字段里，
 * 而不是 content。单独取出这段文本，用于重试判断与兜底。
 */
export function extractReasoning(payload: unknown): string {
  if (payload === null || payload === undefined || Array.isArray(payload)) return '';

  const obj = asRecord(payload);
  const choice = asRecord(asArray(obj.choices)[0]);
  const message = asRecord(choice.message);

  for (const candidate of [
    message.reasoning_content,
    message.reasoning,
    obj.reasoning_content,
    obj.reasoning,
  ]) {
    const text = textFromContent(candidate);
    if (text) return text;
  }

  if (obj.result !== undefined && obj.result !== payload) return extractReasoning(obj.result);
  return '';
}

/** Normalise flat (Workers AI) and OpenAI-style tool calls into one shape. */
export function extractToolCalls(payload: unknown): AiToolCall[] {
  const obj = asRecord(payload);
  const choice = asRecord(asArray(obj.choices)[0]);
  const message = asRecord(choice.message);

  // Workers AI 与 OpenAI 兼容层可能同时给出扁平 tool_calls 与
  // choices[].message.tool_calls,内容一致;只取其中一份,避免合并成重复调用。
  const flat = asArray(obj.tool_calls);
  const nested = asArray(message.tool_calls);
  const raw: unknown[] =
    flat.length > 0
      ? flat
      : nested.length > 0
        ? nested
        : message.function_call
          ? [{ function: message.function_call }]
          : [];

  const calls: AiToolCall[] = [];
  const seen = new Set<string>();
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
    const key = `${name}\u0000${serialised}`;
    if (seen.has(key)) return;
    seen.add(key);
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
 * 空正文的报错要能自解释：带上模型、结束原因和 token 用量，
 * 否则用户只能看到「未返回内容」，不知道是截断、模型不可用还是配置问题。
 */
function emptyCompletionMessage(model: string, payload: unknown): string {
  const reason = finishReasonOf(payload);
  const usage = asRecord(asRecord(payload).usage);
  const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
  const completion = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined;
  const details = [
    reason ? `结束原因：${reason}` : '',
    prompt !== undefined || completion !== undefined
      ? `tokens：输入 ${prompt ?? '?'} / 输出 ${completion ?? '?'}`
      : '',
  ]
    .filter(Boolean)
    .join('，');
  const hint =
    reason === 'length'
      ? '模型把 token 预算耗在了推理内容上，请调大「最大 token」，或改用非推理模型（如 @cf/meta/llama-3.3-70b-instruct-fp8-fast）'
      : '请确认该模型支持文本生成，或改用其他模型';
  return `Workers AI（${model}）未返回正文${details ? `（${details}）` : ''}。${hint}`;
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

    const aiBinding = env.AI;
    // 兼容早期版本误存进设置的 UUID 模型名。
    const model = await resolveCloudflareModel(aiBinding, ai.model);

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

    const run = async (maxTokens: number): Promise<unknown> => {
      try {
        return await withTimeout(
          aiBinding.run(model, { ...inputs, max_tokens: maxTokens }),
          REQUEST_TIMEOUT_MS,
          'Workers AI 请求超时，请稍后重试',
        );
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw AppError.upstream(
          `Workers AI 请求失败：${err instanceof Error ? err.message : '未知错误'}`,
        );
      }
    };

    let payload = await run(ai.maxTokens);
    let text = extractAiText(payload);
    let toolCalls = extractToolCalls(payload);

    // 推理模型的 reasoning_content 与正文共享 max_tokens。预算被推理耗尽时
    // content 为 null 且 finish_reason 为 'length'，看起来就是「未返回内容」；
    // 这里扩大预算重试一次，而不是直接把失败抛给用户。
    if (!text && toolCalls.length === 0 && finishReasonOf(payload) === 'length') {
      const retryTokens = Math.min(
        REASONING_RETRY_MAX_TOKENS,
        Math.max(REASONING_RETRY_MIN_TOKENS, ai.maxTokens * 2),
      );
      if (retryTokens > ai.maxTokens) {
        payload = await run(retryTokens);
        text = extractAiText(payload);
        toolCalls = extractToolCalls(payload);
      }
    }

    if (!text && toolCalls.length === 0) {
      // 极少数推理模型只留下 reasoning。'length' 表示这段内容已被截断，
      // 不能冒充正文返回；其余结束原因说明思考已完整，可以兜底。
      if (finishReasonOf(payload) !== 'length') {
        const reasoning = extractReasoning(payload);
        if (reasoning) return { text: reasoning, toolCalls };
      }
      throw AppError.upstream(emptyCompletionMessage(model, payload));
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

/** A pickable model: `id` is the callable value, `label` is what users see. */
export interface AiModelOption {
  id: string;
  label: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Workers AI 模型目录里 `id` 是内部 UUID（`fd81c856-07a9-…`），真正可调用的名字是
 * `name`（`@cf/meta/llama-3.3-…`）。误把 UUID 当模型名保存下来，调用时必然失败，
 * 所以这里统一取可调用的名字：`id` 是 UUID 时用 `name`，否则优先用 `id`。
 */
export function cloudflareModelId(entry: { id?: unknown; name?: unknown }): string {
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (UUID_RE.test(id)) return name || id;
  return id || name;
}

/**
 * 早期版本把目录里的 UUID 存进了 `settings.ai.model`，这类值无法直接调用。
 * 保存的模型名是 UUID 时，回查目录换成可调用的名字；查不到就原样返回，
 * 让后续调用按原值报错，而不是悄悄换成别的模型。
 */
export async function resolveCloudflareModel(ai: Ai, model: string): Promise<string> {
  const value = model.trim();
  if (!UUID_RE.test(value)) return value;
  try {
    const list = await withTimeout(
      ai.models({ task: 'Text Generation' }),
      MODELS_TIMEOUT_MS,
      '获取模型列表超时，请稍后重试',
    );
    for (const entry of list) {
      if (typeof entry.id === 'string' && entry.id === value) return cloudflareModelId(entry);
    }
  } catch {
    // 目录不可用时保留原值，让调用侧给出真实报错。
  }
  return value;
}

/**
 * 模型的可读名称。
 *
 * 传进来的 `id` 已经过 `cloudflareModelId()` 归一化为可调用的模型名；
 * `name` 若已是短名就直接展示，否则从 id 去掉 `@cf/` 前缀。
 */
export function modelLabel(id: string, name?: string): string {
  const short = name?.trim();
  if (short && !short.startsWith('@') && short !== id) return short;
  return id.replace(/^@cf\//, '');
}

/** Fetch the provider's model catalogue. Workers AI uses the binding. */
export async function listAiModels(
  env: Env,
  override?: { provider?: AiSettings['provider']; baseUrl?: string },
): Promise<AiModelOption[]> {
  const ai = await readAiSettings(env);
  const provider = override?.provider ?? ai.provider;

  if (provider === 'cloudflare') {
    if (!aiBindingAvailable(env) || !env.AI) {
      throw AppError.badRequest('未检测到 Workers AI 绑定,请检查 wrangler.toml 或 Pages 控制台的 AI 绑定');
    }
    try {
      const list = await withTimeout(
        env.AI.models({ task: 'Text Generation' }),
        MODELS_TIMEOUT_MS,
        '获取模型列表超时,请稍后重试',
      );
      const byId = new Map<string, AiModelOption>();
      for (const entry of list) {
        // 目录里的 id 是内部 UUID，可调用的模型名在 name 上。
        const id = cloudflareModelId(entry);
        if (!id || byId.has(id)) continue;
        byId.set(id, { id, label: modelLabel(id, entry.name) });
      }
      const options = [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
      if (options.length > 0) return options;
    } catch {
      // Fall through to the curated list so the settings page stays usable.
    }
    return CLOUDFLARE_FALLBACK_MODELS.map((id) => ({ id, label: modelLabel(id) }));
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
  // OpenAI 兼容接口只给出 id,直接用 id 作为展示名。
  return ids.map((id) => ({ id, label: id }));
}
