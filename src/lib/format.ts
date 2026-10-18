/**
 * NOTE: timestamps are stored in D1 as SQLite `YYYY-MM-DD HH:MM:SS` (UTC).
 * `new Date('2026-01-01 00:00:00')` is parsed inconsistently across engines, so
 * we normalise to an ISO-8601 instant before constructing the Date.
 */
export function parseSqlDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null | undefined, locale = 'zh-CN'): string {
  const date = parseSqlDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
}

export function formatDateShort(value: string | null | undefined): string {
  const date = parseSqlDate(value);
  if (!date) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function formatDateTime(value: string | null | undefined, locale = 'zh-CN'): string {
  const date = parseSqlDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 1000 * 60 * 60 * 24 * 365],
  ['month', 1000 * 60 * 60 * 24 * 30],
  ['day', 1000 * 60 * 60 * 24],
  ['hour', 1000 * 60 * 60],
  ['minute', 1000 * 60],
  ['second', 1000],
];

export function relativeTime(value: string | null | undefined, locale = 'zh-CN'): string {
  const date = parseSqlDate(value);
  if (!date) return '';
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = date.getTime() - Date.now();
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms || unit === 'second') {
      return formatter.format(Math.round(diff / ms), unit);
    }
  }
  return '';
}

export function formatNumber(value: number | null | undefined): string {
  const n = value ?? 0;
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Strip a relative media URL down to its storage key (`uploads/...`). */
export function mediaKeyFromUrl(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/media\//, '');
}
