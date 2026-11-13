import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AiChatContext, AiChatMessage, AiSettings, AiSettingsView } from '@shared/types';
import { requireAdmin } from '../lib/auth';
import {
  aiBindingAvailable,
  aiProviderReady,
  chatComplete,
  listAiModels,
  readAiSettings,
  resolveCloudflareModel,
  writeAiSettings,
  type ChatMessage,
} from '../lib/ai';
import { runAiAgent } from '../lib/ai-agent';
import type { AppEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { hit } from '../lib/rate-limit';
import { ok } from '../lib/response';
import { parseJson } from '../lib/validate';

export const aiRoutes = new Hono<AppEnv>();

aiRoutes.use('*', requireAdmin);

/**
 * Throttle the routes that spend real money (upstream API calls / tokens).
 * Keyed per admin account so one runaway editor tab cannot drain the quota.
 */
async function limitUpstream(c: Context<AppEnv>, bucket: string, limit: number, windowSeconds: number): Promise<void> {
  const userId = c.get('user')?.id ?? 'anon';
  const result = await hit(c.env, `ai:${bucket}:${userId}`, limit, windowSeconds);
  if (!result.allowed) throw AppError.rateLimited('操作过于频繁，请稍后再试');
}

function view(env: AppEnv['Bindings'], settings: AiSettings): AiSettingsView {
  const { apiKey, monidApiKey, ...rest } = settings;
  return {
    ...rest,
    hasApiKey: apiKey.length > 0,
    hasMonidApiKey: monidApiKey.length > 0,
    bindingAvailable: aiBindingAvailable(env),
    ready: aiProviderReady(env, settings),
  };
}

/**
 * 早期版本把 Workers AI 目录里的 UUID 当模型名保存了下来。读取与保存时都换成
 * 可调用的名字，避免设置页显示一串看不懂的 id、调用时又必然失败。
 */
async function resolveStoredModel(env: AppEnv['Bindings'], settings: AiSettings): Promise<AiSettings> {
  if (settings.provider !== 'cloudflare' || !env.AI) return settings;
  const model = await resolveCloudflareModel(env.AI, settings.model);
  return model === settings.model ? settings : { ...settings, model };
}

const patchSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(['cloudflare', 'openai', 'deepseek', 'custom']),
    baseUrl: z.string().trim().max(300),
    apiKey: z.string().max(400),
    clearApiKey: z.boolean(),
    monidApiKey: z.string().max(400),
    clearMonidApiKey: z.boolean(),
    model: z.string().trim().max(120),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().min(64).max(32000),
    excerptPrompt: z.string().max(4000),
    contentPrompt: z.string().max(8000),
  })
  .deepPartial();

/** Admin: current AI config (API key replaced by a `hasApiKey` flag). */
aiRoutes.get('/settings', async (c) => {
  c.header('Cache-Control', 'no-store');
  const settings = await resolveStoredModel(c.env, await readAiSettings(c.env));
  return ok(c, view(c.env, settings));
});

/** Admin: patch the AI config. An empty `apiKey` keeps the stored one. */
aiRoutes.patch('/settings', async (c) => {
  const { clearApiKey, apiKey, clearMonidApiKey, monidApiKey, ...rest } = await parseJson(c, patchSchema);
  const patch: Partial<AiSettings> = { ...rest };
  if (clearApiKey) patch.apiKey = '';
  else if (apiKey !== undefined && apiKey.trim() !== '') patch.apiKey = apiKey.trim();
  if (clearMonidApiKey) patch.monidApiKey = '';
  else if (monidApiKey !== undefined && monidApiKey.trim() !== '') patch.monidApiKey = monidApiKey.trim();
  const saved = await writeAiSettings(c.env, patch);
  const resolved = await resolveStoredModel(c.env, saved);
  // 保存时纠正历史 UUID 值，避免坏数据一直留在设置里。
  if (resolved.model !== saved.model) await writeAiSettings(c.env, { model: resolved.model });
  return ok(c, view(c.env, resolved));
});

const modelsSchema = z.object({
  provider: z.enum(['cloudflare', 'openai', 'deepseek', 'custom']).optional(),
  baseUrl: z.string().trim().max(300).optional(),
});

/** Admin: list the models offered by the configured provider. */
aiRoutes.post('/models', async (c) => {
  await limitUpstream(c, 'models', 10, 60);
  const body = await parseJson(c, modelsSchema);
  return ok(c, { models: await listAiModels(c.env, body) });
});

const generateSchema = z.object({
  mode: z.enum(['excerpt', 'content']),
  title: z.string().trim().max(200).default(''),
  contentMd: z.string().max(200_000).default(''),
  hint: z.string().trim().max(2000).default(''),
});

const CONTENT_INPUT_LIMIT = 12_000;

/** Admin: generate an excerpt or a full article via the configured provider. */
aiRoutes.post('/generate', async (c) => {
  await limitUpstream(c, 'generate', 20, 300);
  const body = await parseJson(c, generateSchema);
  const settings = await readAiSettings(c.env);

  const source = body.contentMd.slice(0, CONTENT_INPUT_LIMIT);
  if (body.mode === 'excerpt' && !source.trim() && !body.title) {
    throw AppError.badRequest('请先填写标题或正文，再生成摘要');
  }
  if (body.mode === 'content' && !body.title && !body.hint) {
    throw AppError.badRequest('请先填写标题或写作要求，再生成正文');
  }

  const systemPrompt = body.mode === 'excerpt' ? settings.excerptPrompt : settings.contentPrompt;
  const parts: string[] = [];
  if (body.title) parts.push(`标题：${body.title}`);
  if (body.hint) parts.push(`要求：${body.hint}`);
  if (source.trim()) parts.push(`参考内容：\n${source}`);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n\n') },
  ];

  const text = await chatComplete(c.env, messages);
  return ok(c, { text, mode: body.mode });
});

/* ------------------------------------------------------------- chat agent */

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(8000),
      }),
    )
    .min(1)
    .max(30),
  context: z
    .object({
      path: z.string().trim().max(300).optional(),
      postId: z.coerce.number().int().positive().optional(),
      postSlug: z.string().trim().max(200).optional(),
    })
    .optional(),
});

/**
 * Admin: one turn of the floating assistant.
 * The agent may call tools (create/edit posts, media, comments) on the admin's
 * behalf, so this route shares the same admin-only guard as the rest of the file.
 */
aiRoutes.post('/chat', async (c) => {
  await limitUpstream(c, 'chat', 30, 300);
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();

  const body = await parseJson(c, chatSchema);
  const messages: AiChatMessage[] = body.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const context: AiChatContext | undefined = body.context;
  const result = await runAiAgent(c.env, user, messages, context);
  return ok(c, result);
});
