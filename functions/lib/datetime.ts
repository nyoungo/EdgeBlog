/**
 * Timestamp helpers.
 *
 * Everything stored in D1 uses SQLite's canonical `YYYY-MM-DD HH:MM:SS` UTC
 * format (the same format `datetime('now')` produces). Keeping one format is
 * essential: the public-visibility rule compares `published_at` against
 * `datetime('now')` as strings, so mixing ISO-8601 (`T`/`Z`) with the SQLite
 * format would silently break the `>`/`<` ordering.
 */
import { AppError } from './errors';

/** Convert any date-ish input to the SQLite storage format (UTC). */
export function toSqlDateTime(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw AppError.badRequest('时间格式不正确');
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Current UTC time in the SQLite storage format. */
export function nowSql(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Convert a stored value to an ISO-8601 string for API consumers / feeds. */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  return `${value.replace(' ', 'T')}Z`;
}
