/**
 * 定时任务的排期计算（纯函数，无运行时依赖，可单测）。
 *
 * 设计约定：
 *   * 用户在界面上填写的排期字段一律按 **UTC+8（北京时间）** 语义理解；
 *     本模块负责把它换算成实际的 UTC 时刻（SQLite `YYYY-MM-DD HH:MM:SS`），
 *     存进 `automation_tasks.next_run_at`，Worker 的定时器只需比较这个时间。
 *   * 所有「下一次」结果都严格晚于传入的 `from`，避免任务刚保存就立刻触发。
 *     Worker 轮询则使用 `next_run_at <= now` 判定到期。
 *   * monthly 遇到当月没有该日（例如 31 号遇上 2 月）时，顺延到当月最后一天，
 *     保证「每月」任务不会整月跳过。
 */
import type { AutomationRecurrence } from './types';

/** 北京时间相对 UTC 的偏移毫秒数。 */
export const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 0=周日 … 6=周六，与 JS `Date.getUTCDay()` 一致。 */
export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export const RECURRENCE_LABELS: Record<AutomationRecurrence, string> = {
  once: '仅一次',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

export interface ScheduleInput {
  recurrence: AutomationRecurrence;
  /** 'HH:MM'（UTC+8）。 */
  timeOfDay: string;
  /** 0=周日 … 6=周六（weekly 有效）。 */
  weekday: number;
  /** 1–31（monthly 有效）。 */
  dayOfMonth: number;
  /** 'YYYY-MM-DD'（UTC+8）：首次可运行日期。 */
  startDate: string;
  /** 'YYYY-MM-DD'（UTC+8）：可空，含当天。 */
  endDate?: string | null;
}

interface LocalDate {
  y: number;
  m: number;
  d: number;
}

/** 'HH:MM' → { hours, minutes }；非法返回 null。 */
export function parseTimeOfDay(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/** 校验并解析 'YYYY-MM-DD'（按 UTC+8 本地日期理解），非法返回 null。 */
export function parseLocalDate(value: string): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** 解析 SQLite UTC 时间字符串为毫秒；非法返回 NaN。 */
function parseUtcMs(value: string): number {
  return Date.parse(`${value.trim().replace(' ', 'T')}Z`);
}

/** 毫秒 → SQLite UTC 字符串。 */
export function msToSqlUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** 从 UTC 毫秒取出「北京时间」的年月日时分。 */
function localParts(ms: number): LocalDate & { hh: number; mi: number } {
  const date = new Date(ms + UTC8_OFFSET_MS);
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    hh: date.getUTCHours(),
    mi: date.getUTCMinutes(),
  };
}

/** 北京时间的某一天 00:00 对应的 UTC 毫秒。 */
function localDayStartMs(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) - UTC8_OFFSET_MS;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 本地日期是否不晚于 `b`（只看年月日）。 */
function localDateLte(a: LocalDate, b: LocalDate): boolean {
  if (a.y !== b.y) return a.y < b.y;
  if (a.m !== b.m) return a.m < b.m;
  return a.d <= b.d;
}

/**
 * 计算下一次运行的 UTC 时间（SQLite 格式）。
 *
 * @param input 排期配置（UTC+8 语义）
 * @param from  「从现在开始往后找」的基准时刻（Date 或 SQLite/ISO 字符串）
 * @returns UTC 时间字符串；没有后续运行时返回 null
 */
export function computeNextRun(input: ScheduleInput, from: Date | string): string | null {
  const time = parseTimeOfDay(input.timeOfDay);
  const start = parseLocalDate(input.startDate);
  if (!time || !start) return null;

  const end = input.endDate ? parseLocalDate(input.endDate) : null;
  const fromMs = typeof from === 'string' ? parseUtcMs(from) : from.getTime();
  if (Number.isNaN(fromMs)) return null;

  const endDayMs = end ? localDayStartMs(end.y, end.m, end.d) : Number.POSITIVE_INFINITY;
  const timeOffset = time.hours * 60 * 60 * 1000 + time.minutes * 60 * 1000;

  if (input.recurrence === 'once') {
    const at = localDayStartMs(start.y, start.m, start.d) + timeOffset;
    return at > fromMs ? msToSqlUtc(at) : null;
  }

  const fromParts = localParts(fromMs);

  if (input.recurrence === 'monthly') {
    let y = fromParts.y;
    let m = fromParts.m;
    // 不早于起始月。
    if (y * 100 + m < start.y * 100 + start.m) {
      y = start.y;
      m = start.m;
    }
    for (let i = 0; i < 1200; i++) {
      const day = Math.min(Math.max(1, input.dayOfMonth), daysInMonth(y, m));
      const candidate: LocalDate = { y, m, d: day };
      const at = localDayStartMs(y, m, day) + timeOffset;
      if (at > fromMs) {
        if (end && !localDateLte(candidate, end)) return null;
        return msToSqlUtc(at);
      }
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      if (localDayStartMs(y, m, 1) > endDayMs) return null;
    }
    return null;
  }

  // once / daily / weekly：按天推进。
  const startDayMs = localDayStartMs(start.y, start.m, start.d);
  const fromDayMs = localDayStartMs(fromParts.y, fromParts.m, fromParts.d);
  const cursor = Math.max(startDayMs, fromDayMs);
  // 4 年足够覆盖任何日/周组合；cap 同时兜住 end_date 缺失时的异常。
  for (let i = 0; i < 1500; i++) {
    const dayMs = cursor + i * DAY_MS;
    if (dayMs > endDayMs) return null;
    if (input.recurrence === 'weekly') {
      const weekday = new Date(dayMs + UTC8_OFFSET_MS).getUTCDay();
      if (weekday !== input.weekday) continue;
    }
    const at = dayMs + timeOffset;
    if (at <= fromMs) continue;
    return msToSqlUtc(at);
  }
  return null;
}

/** 人类可读的排期描述，例如「每天 09:00」「每月 15 日 08:30」。 */
export function describeSchedule(input: ScheduleInput): string {
  const time = parseTimeOfDay(input.timeOfDay);
  const clock = time
    ? `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`
    : input.timeOfDay;
  const weekday = WEEKDAY_LABELS[Math.min(6, Math.max(0, input.weekday))] ?? '';
  switch (input.recurrence) {
    case 'once':
      return `${input.startDate} ${clock}`;
    case 'daily':
      return `每天 ${clock}`;
    case 'weekly':
      return `每${weekday} ${clock}`;
    case 'monthly':
      return `每月 ${input.dayOfMonth} 日 ${clock}`;
    default:
      return clock;
  }
}

/**
 * 校验排期配置，返回中文错误信息；通过则返回 null。
 * API 层与前端共用同一套规则，避免两边判断不一致。
 */
export function validateSchedule(input: ScheduleInput): string | null {
  if (!parseTimeOfDay(input.timeOfDay)) return '执行时间必须是 HH:MM 格式';
  const start = parseLocalDate(input.startDate);
  if (!start) return '起始日期不合法';
  if (input.endDate) {
    const end = parseLocalDate(input.endDate);
    if (!end) return '结束日期不合法';
    const startKey = start.y * 10000 + start.m * 100 + start.d;
    const endKey = end.y * 10000 + end.m * 100 + end.d;
    if (endKey < startKey) return '结束日期不能早于起始日期';
  }
  if (input.recurrence === 'weekly' && !(input.weekday >= 0 && input.weekday <= 6)) {
    return '星期取值不合法';
  }
  if (input.recurrence === 'monthly' && !(input.dayOfMonth >= 1 && input.dayOfMonth <= 31)) {
    return '每月日期取值不合法';
  }
  return null;
}
