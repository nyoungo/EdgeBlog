/** Append-only audit trail for privileged mutations. */
import { run } from './db';
import type { Env, SessionUser } from './env';

export interface AuditActor {
  id: number;
  username: string;
}

/**
 * Best-effort: an audit write must never break the mutation it describes, so
 * failures are logged and swallowed. `detail` is a small object; it is JSON
 * encoded and truncated so a giant payload cannot bloat the table.
 */
export async function recordAudit(
  env: Env,
  actor: SessionUser | AuditActor | null,
  action: string,
  targetType: string | null,
  targetId: number | string | null,
  detail?: Record<string, unknown> | null,
): Promise<void> {
  try {
    const numericId = typeof targetId === 'number' ? targetId : targetId == null ? null : Number(targetId);
    await run(
      env,
      `INSERT INTO audit_log (actor_id, actor_name, action, target_type, target_id, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      actor?.id ?? null,
      actor?.username ?? null,
      action,
      targetType,
      Number.isFinite(numericId as number) ? numericId : null,
      detail ? JSON.stringify(detail).slice(0, 2000) : null,
    );
  } catch (err) {
    console.error('[audit] write failed', action, err);
  }
}