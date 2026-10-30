import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AiSettings, AiSettingsView } from '@shared/types';
import { requireAdmin } from '../lib/auth';
import { chatComplete, listAiModels, readAiSettings, writeAiSettings, type ChatMessage } from '../lib/ai';
import type { AppEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { hit } from '../lib/rate-limit';
import { ok } from '../lib/response';
import { parseJson } from '../lib/validate';

export const aiRoutes = new Hono<AppEnv>();

aiRoutes.use('*', requireAdmin);

/**
 * Throttle the two routes that spend real money (upstream API calls / tokens).
 * Keyed per admin account so one runaway editor tab cannot drain the quota.
 */
async function limitUpstream(c: Context<AppEnv>, bucket: string, limit: number, windowSeconds: number): Promise<void> {
  const userId = c.get('user')?.id ?? 'anon';
  const result = await hit(c.env, `ai:${bucket}:${userId}`, limit, windowSeconds);
  if (!result.allowed) throw AppError.rateLimited('操作过于频繁，请稍后再试');
}

function view(settings: AiSettings): AiSettingsView {
  const { apiKey, ...rest } = settings;
  return { ...rest, hasApiKey: apiKey.length > 0 };
}

const patchSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(['openai', 'deepseek', 'custom']),
    baseUrl: z.string().trim().max(300),
    apiKey: z.string().max(400),
    clearApiKey: z.boolean(),
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
  return ok(c, view(await readAiSettings(c.env)));
});

/** Admin: patch the AI config. An empty `apiKey` keeps the stored one. */
aiRoutes.patch('/settings', async (c) => {
  const { clearApiKey, apiKey, ...rest } = await parseJson(c, patchSchema);
  const patch: Partial<AiSettings> = { ...rest };
  if (clearApiKey) patch.apiKey = '';
  else if (apiKey !== undefined && apiKey.trim() !== '') patch.apiKey = apiKey.trim();
  return ok(c, view(await writeAiSettings(c.env, patch)));
});

const modelsSchema = z.object({
  provider: z.enum(['openai', 'deepseek', 'custom']).optional(),
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
