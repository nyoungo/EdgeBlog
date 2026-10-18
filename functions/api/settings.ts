import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../lib/auth';
import type { AppEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { DEFAULT_SETTINGS, SETTING_NAMESPACES, AI_NAMESPACE } from '@shared/settings-defaults';
import { getSettings, patchSettings, readSettingRows, resetSettings } from '../lib/settings';
import { ok } from '../lib/response';
import { parseJson } from '../lib/validate';
import { SETTINGS_SCHEMAS, isNamespace } from './settings-schemas';

export const settingRoutes = new Hono<AppEnv>();

/** Public: merged site configuration (cached, drives the whole theme). */
settingRoutes.get('/public', async (c) => {
  const settings = await getSettings(c.env);
  c.header('Cache-Control', 'public, max-age=0, s-maxage=60');
  return ok(c, settings);
});

/** Admin: raw rows + defaults so the Appearance panel can diff and restore. */
settingRoutes.get('/', requireAuth, async (c) => {
  c.header('Cache-Control', 'no-store');
  const rows = await readSettingRows(c.env);
  // The AI namespace holds a secret; it is served only by /api/ai/settings.
  delete rows[AI_NAMESPACE];
  return ok(c, { rows, defaults: DEFAULT_SETTINGS, namespaces: SETTING_NAMESPACES });
});

/** Admin: patch one namespace (deep-merged for objects, replaced for arrays). */
settingRoutes.patch('/:namespace', requireAuth, async (c) => {
  const ns = c.req.param('namespace');
  if (!isNamespace(ns)) throw AppError.notFound('未知的配置命名空间');

  const schema = SETTINGS_SCHEMAS[ns];
  const body = await parseJson(c, schema as z.ZodTypeAny);
  const next = await patchSettings(c.env, ns, body);
  return ok(c, next);
});

const resetSchema = z.object({
  namespace: z.enum(SETTING_NAMESPACES).optional(),
});

/** Admin: restore defaults for one namespace, or the whole site. */
settingRoutes.post('/reset', requireAuth, async (c) => {
  const body = await parseJson(c, resetSchema);
  await resetSettings(c.env, body.namespace);
  const settings = await getSettings(c.env, true);
  return ok(c, settings);
});
