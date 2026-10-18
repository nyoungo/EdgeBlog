/** Thin, typed wrappers around D1 prepared statements. */
import type { Env } from './env';

/** Values D1 accepts as bound parameters. Booleans must be converted to 0/1. */
export type SqlParam = string | number | null | ArrayBuffer;

export async function first<T>(env: Env, sql: string, ...binds: unknown[]): Promise<T | null> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<T>();
  return row ?? null;
}

export async function all<T>(env: Env, sql: string, ...binds: unknown[]): Promise<T[]> {
  const result = await env.DB.prepare(sql)
    .bind(...binds)
    .all<T>();
  return result.results ?? [];
}

export async function run(env: Env, sql: string, ...binds: unknown[]): Promise<D1Result> {
  return env.DB.prepare(sql)
    .bind(...binds)
    .run();
}

export async function batch(env: Env, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  return env.DB.batch(statements);
}

/** Build a `(?, ?, ?)` placeholder list for IN clauses (never interpolate values). */
export function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

/** True when a UNIQUE constraint violation occurred (D1 error text based). */
export function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(message);
}
