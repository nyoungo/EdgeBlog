/**
 * Settings persistence + caching.
 *
 * Reads are merged over DEFAULT_SETTINGS so a missing row never yields a
 * broken site. The merged public payload is cached in KV for 60s; every write
 * invalidates that key so changes are visible on the next request.
 */
import type { PublicSettings } from '@shared/types';
import {
  DEFAULT_SETTINGS,
  SETTING_NAMESPACES,
  type SettingNamespace,
  defaultFor,
} from '@shared/settings-defaults';
import type { Env } from './env';

const CACHE_KEY = 'settings:public:v1';
const CACHE_TTL_SECONDS = 60;

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively merge `patch` into `base` (arrays and scalars replace). */
function deepMerge(base: JsonObject, patch: JsonObject): JsonObject {
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return out;
}

export async function readSettingRows(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare('SELECT key, value_json FROM settings').all<{
    key: string;
    value_json: string;
  }>();
  const rows: Record<string, unknown> = {};
  for (const row of results ?? []) {
    try {
      rows[row.key] = JSON.parse(row.value_json);
    } catch {
      // Ignore malformed rows rather than taking the whole site down.
    }
  }
  return rows;
}

/** Merge raw rows over defaults into a fully-populated settings object. */
export function mergeSettings(rows: Record<string, unknown>): PublicSettings {
  const pick = <K extends SettingNamespace>(ns: K): PublicSettings[K] => {
    const value = rows[ns];
    const fallback = DEFAULT_SETTINGS[ns];
    if (Array.isArray(fallback)) {
      return (Array.isArray(value) ? value : fallback) as PublicSettings[K];
    }
    if (isPlainObject(fallback)) {
      return (isPlainObject(value) ? deepMerge(fallback as JsonObject, value) : fallback) as PublicSettings[K];
    }
    return fallback;
  };

  return {
    site: pick('site'),
    theme: pick('theme'),
    layout: pick('layout'),
    navigation: pick('navigation'),
    social: pick('social'),
    features: pick('features'),
    advanced: pick('advanced'),
    comments: pick('comments'),
    pages: pick('pages'),
    music: pick('music'),
  };
}

export async function getSettings(env: Env, bypassCache = false): Promise<PublicSettings> {
  if (!bypassCache && env.CACHE) {
    const cached = await env.CACHE.get<PublicSettings>(CACHE_KEY, 'json');
    if (cached) return cached;
  }
  const merged = mergeSettings(await readSettingRows(env));
  if (env.CACHE) {
    try {
      await env.CACHE.put(CACHE_KEY, JSON.stringify(merged), { expirationTtl: CACHE_TTL_SECONDS });
    } catch {
      /* cache is best-effort */
    }
  }
  return merged;
}

async function invalidate(env: Env): Promise<void> {
  if (!env.CACHE) return;
  try {
    await env.CACHE.delete(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

async function writeNamespace(env: Env, ns: SettingNamespace, value: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`,
  )
    .bind(ns, JSON.stringify(value))
    .run();
}

/** Merge a patch into one namespace (arrays replace wholesale). */
export async function patchSettings(
  env: Env,
  ns: SettingNamespace,
  patch: unknown,
): Promise<unknown> {
  const rows = await readSettingRows(env);
  const current = rows[ns];
  const next =
    isPlainObject(patch) && isPlainObject(current) ? deepMerge(current, patch) : patch;
  await writeNamespace(env, ns, next);
  await invalidate(env);
  return next;
}

/** Restore defaults for a single namespace, or the entire site. */
export async function resetSettings(env: Env, ns?: SettingNamespace): Promise<void> {
  if (ns) {
    await writeNamespace(env, ns, defaultFor(ns));
  } else {
    for (const namespace of SETTING_NAMESPACES) {
      await writeNamespace(env, namespace, defaultFor(namespace));
    }
  }
  await invalidate(env);
}
