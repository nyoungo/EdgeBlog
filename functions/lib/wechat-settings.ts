/**
 * 微信公众号（服务端接口）配置的读写。
 *
 * 与 `ai.ts` 的 AI 配置完全同构：配置存放在 `settings` 表的私有命名空间
 * `wechat` 中，绝不出现在 `/api/settings/public`，AppSecret 只由后台
 * `/api/wechat/settings` 以 `hasAppSecret` 掩码的形式回给管理员。
 */
import type { WechatSettings } from '@shared/types';
import { WECHAT_DEFAULTS, WECHAT_NAMESPACE } from '@shared/settings-defaults';
import type { Env } from './env';

interface StoredRow {
  value_json: string;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Coerce a stored/patched object into a complete WechatSettings record. */
function normalize(value: unknown): WechatSettings {
  const src = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    enabled: bool(src['enabled'], WECHAT_DEFAULTS.enabled),
    appId: str(src['appId'], WECHAT_DEFAULTS.appId).trim(),
    appSecret: str(src['appSecret'], WECHAT_DEFAULTS.appSecret).trim(),
    // 微信限制作者名 16 字，超出直接截断，避免 draft/add 报错。
    author: str(src['author'], WECHAT_DEFAULTS.author).trim().slice(0, 16),
    openComment: bool(src['openComment'], WECHAT_DEFAULTS.openComment),
    onlyFansCanComment: bool(src['onlyFansCanComment'], WECHAT_DEFAULTS.onlyFansCanComment),
    miniprogramEnabled: bool(src['miniprogramEnabled'], WECHAT_DEFAULTS.miniprogramEnabled),
    miniprogramAppId: str(src['miniprogramAppId'], WECHAT_DEFAULTS.miniprogramAppId).trim(),
    miniprogramPath: str(src['miniprogramPath'], WECHAT_DEFAULTS.miniprogramPath).trim(),
    miniprogramTitle: str(src['miniprogramTitle'], WECHAT_DEFAULTS.miniprogramTitle).trim(),
    miniprogramDesc: str(src['miniprogramDesc'], WECHAT_DEFAULTS.miniprogramDesc).trim(),
    miniprogramImage: str(src['miniprogramImage'], WECHAT_DEFAULTS.miniprogramImage).trim(),
    miniprogramButton: str(src['miniprogramButton'], WECHAT_DEFAULTS.miniprogramButton).trim(),
  };
}

export async function readWechatSettings(env: Env): Promise<WechatSettings> {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key = ?')
    .bind(WECHAT_NAMESPACE)
    .first<StoredRow>();
  if (!row) return structuredClone(WECHAT_DEFAULTS);
  try {
    return normalize(JSON.parse(row.value_json));
  } catch {
    return structuredClone(WECHAT_DEFAULTS);
  }
}

export async function writeWechatSettings(env: Env, patch: Partial<WechatSettings>): Promise<WechatSettings> {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key = ?')
    .bind(WECHAT_NAMESPACE)
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
    .bind(WECHAT_NAMESPACE, JSON.stringify(next))
    .run();
  return next;
}

/** 是否已配置到「可以调用接口」的程度（开关 + AppID + AppSecret）。 */
export function wechatConfigured(settings: WechatSettings): boolean {
  return settings.appId.trim().length > 0 && settings.appSecret.trim().length > 0;
}
