/**
 * 微信公众号草稿推送接口（后台）。
 *
 *   GET    /api/wechat/settings          读取配置（AppSecret 以 hasAppSecret 掩码）
 *   PATCH  /api/wechat/settings          保存配置（空 appSecret 表示保持不变）
 *   POST   /api/wechat/test              连通性自检（拉一次 access_token）
 *   POST   /api/wechat/preflight        公众号正文长度预检(不调微信接口,纯本地计算)
 *   POST   /api/wechat/posts/:id/draft   把一篇文章推送到草稿箱
 *   GET    /api/wechat/drafts            已推送过草稿的文章列表
 *
 * 与 AI 设置一致：凭据存放于 `settings` 的私有命名空间，只有管理员可见。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { WechatSettings, WechatSettingsView } from '@shared/types';
import { requireAdmin } from '../lib/auth';
import { recordAudit } from '../lib/audit';
import type { AppEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { hit } from '../lib/rate-limit';
import { ok } from '../lib/response';
import { parseJson } from '../lib/validate';
import { getPostById } from '../lib/posts-repo';
import { readWechatSettings, wechatConfigured, writeWechatSettings } from '../lib/wechat-settings';
import { getWechatDraft, listWechatDrafts } from '../lib/wechat-draft';
import { pushPostToWechatWithRepair } from '../lib/wechat-repair';
import { buildWechatBody, measureWechatBody, miniProgramCardFromSettings } from '../lib/wechat-length';
import { testWechatConnection } from '../lib/wechat';

export const wechatRoutes = new Hono<AppEnv>();

wechatRoutes.use('*', requireAdmin);

/** 掩码后的配置视图：绝不把 AppSecret 交给前端。 */
function view(settings: WechatSettings): WechatSettingsView {
  const { appSecret, ...rest } = settings;
  return {
    ...rest,
    hasAppSecret: appSecret.trim().length > 0,
    configured: wechatConfigured(settings),
  };
}

/** 读取配置；未配置或开关关闭时抛错（推送前的前置校验）。 */
async function requireWechatReady(env: AppEnv['Bindings']): Promise<WechatSettings> {
  const settings = await readWechatSettings(env);
  if (!settings.enabled) throw AppError.badRequest('微信公众号推送尚未启用，请先在「公众号设置」中开启');
  if (!wechatConfigured(settings)) throw AppError.badRequest('请先在「公众号设置」中填写 AppID 与 AppSecret');
  return settings;
}

/** Admin: current WeChat config (AppSecret replaced by a flag). */
wechatRoutes.get('/settings', async (c) => {
  c.header('Cache-Control', 'no-store');
  return ok(c, view(await readWechatSettings(c.env)));
});

const patchSchema = z
  .object({
    enabled: z.boolean(),
    appId: z.string().trim().max(64),
    appSecret: z.string().max(128),
    clearAppSecret: z.boolean(),
    author: z.string().trim().max(16),
    openComment: z.boolean(),
    onlyFansCanComment: z.boolean(),
    bodyCoverPosition: z.enum(['none', 'top', 'middle', 'bottom']),
    repairPushFailures: z.boolean(),
    miniprogramEnabled: z.boolean(),
    miniprogramAppId: z.string().trim().max(64),
    miniprogramPath: z.string().trim().max(256),
    miniprogramTitle: z.string().trim().max(64),
    miniprogramDesc: z.string().trim().max(120),
    miniprogramImage: z.string().trim().max(1024),
    miniprogramButton: z.string().trim().max(16),
  })
  .deepPartial();

/** Admin: patch the config. An empty `appSecret` keeps the stored one. */
wechatRoutes.patch('/settings', async (c) => {
  const { clearAppSecret, appSecret, ...rest } = await parseJson(c, patchSchema);
  const patch: Partial<WechatSettings> = { ...rest };
  if (clearAppSecret) patch.appSecret = '';
  else if (appSecret !== undefined && appSecret.trim() !== '') patch.appSecret = appSecret.trim();
  const saved = await writeWechatSettings(c.env, patch);
  await recordAudit(c.env, c.get('user'), 'wechat.settings.update', 'setting', null, {
    enabled: saved.enabled,
    appId: saved.appId ? `${saved.appId.slice(0, 6)}…` : '',
  });
  return ok(c, view(saved));
});

/** Admin: connectivity self-check — fetch an access_token. */
wechatRoutes.post('/test', async (c) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  const limited = await hit(c.env, `wechat:test:${user.id}`, 10, 300);
  if (!limited.allowed) throw AppError.rateLimited('操作过于频繁，请稍后再试');
  const settings = await requireWechatReady(c.env);
  const message = await testWechatConnection(c.env, settings);
  return ok(c, { message });
});

const preflightSchema = z.object({
  contentMd: z.string().max(500_000).default(''),
  coverUrl: z.string().trim().max(2048).nullable().optional(),
});

/**
 * Admin:公众号正文长度预检。
 *
 * 微信 2 万字符限制统计的是渲染后的 HTML 字符串,所以这里不猜:直接用与推送
 * 同一套装配逻辑算一遍,把「渲染后字符数 / 上限」回给编辑器与 AI。
 * 不调用任何微信接口,纯本地计算。
 */
wechatRoutes.post('/preflight', async (c) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  // 编辑器输入时会反复调用,给一个宽松但有上限的频次。
  const limited = await hit(c.env, `wechat:preflight:${user.id}`, 120, 300);
  if (!limited.allowed) throw AppError.rateLimited('检查过于频繁,请稍后再试');
  const body = await parseJson(c, preflightSchema);
  const settings = await readWechatSettings(c.env);
  const built = buildWechatBody({
    markdown: body.contentMd,
    coverUrl: body.coverUrl ?? '',
    bodyCoverPosition: settings.bodyCoverPosition,
    card: miniProgramCardFromSettings(settings),
  });
  return ok(c, measureWechatBody(built, body.contentMd));
});

/** Admin: push one post to the official-account draft box. */
wechatRoutes.post('/posts/:id/draft', async (c) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('非法文章 ID');

  // 推送会真实调用微信接口并占用素材配额，按管理员账号限频。
  const limited = await hit(c.env, `wechat:push:${user.id}`, 30, 300);
  if (!limited.allowed) throw AppError.rateLimited('推送过于频繁，请稍后再试');

  const settings = await requireWechatReady(c.env);

  const post = await getPostById(c.env, id);
  if (!post) throw AppError.notFound('文章不存在');

  // 阅读原文指向部署站点；SITE_URL 未配置时不下发该字段。
  const siteUrl = (c.env.SITE_URL ?? '').trim() || undefined;

  const result = await pushPostToWechatWithRepair(c.env, settings, post, {
    siteUrl,
    actor: user,
  });
  await recordAudit(c.env, user, 'wechat.push', 'post', id, {
    mediaId: result.mediaId,
    updated: result.updated,
    imageCount: result.imageCount,
    title: result.title,
    repaired: result.repaired,
  });
  return ok(c, result);
});

/** Admin: posts already pushed as drafts (for the settings page list). */
wechatRoutes.get('/drafts', async (c) => {
  c.header('Cache-Control', 'no-store');
  const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') ?? '50', 10) || 50));
  return ok(c, await listWechatDrafts(c.env, limit));
});

/** Admin: whether a single post already has a draft (drives the button label). */
wechatRoutes.get('/posts/:id/draft', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('非法文章 ID');
  const draft = await getWechatDraft(c.env, id);
  return ok(c, {
    pushed: draft !== null,
    mediaId: draft?.media_id ?? null,
    pushedAt: draft?.pushed_at ?? null,
  });
});
