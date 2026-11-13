import { describe, expect, it } from 'vitest';
import type { AutomationTask } from '../shared/types';
import type { Env } from '../functions/lib/env';
import { AI_DEFAULTS } from '../shared/settings-defaults';
import {
  computeNextRun,
  describeSchedule,
  parseLocalDate,
  parseTimeOfDay,
  validateSchedule,
  type ScheduleInput,
} from '../shared/schedule';
import {
  generateArticle,
  splitTitleAndBody,
  parseTagsJson,
  buildCoverPrompt,
  resolveAutomationStatus,
} from '../functions/lib/automation';
import { isLocalCoverSource } from '../functions/lib/cover';

const BASE: ScheduleInput = {
  recurrence: 'daily',
  timeOfDay: '09:00',
  weekday: 1,
  dayOfMonth: 1,
  startDate: '2026-03-01',
  endDate: null,
};

describe('parseTimeOfDay', () => {
  it('parses valid clock strings', () => {
    expect(parseTimeOfDay('09:00')).toEqual({ hours: 9, minutes: 0 });
    expect(parseTimeOfDay('23:59')).toEqual({ hours: 23, minutes: 59 });
    expect(parseTimeOfDay('0:05')).toEqual({ hours: 0, minutes: 5 });
  });

  it('rejects out-of-range or malformed values', () => {
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('09:60')).toBeNull();
    expect(parseTimeOfDay('900')).toBeNull();
    expect(parseTimeOfDay('')).toBeNull();
  });
});

describe('parseLocalDate', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(parseLocalDate('2026-03-01')).toEqual({ y: 2026, m: 3, d: 1 });
    expect(parseLocalDate('2026-02-30')).toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
    expect(parseLocalDate('2026/03/01')).toBeNull();
  });
});

describe('computeNextRun', () => {
  it('converts a Beijing-time schedule to UTC', () => {
    // 基准 2026-03-01 00:00 UTC = 当天 08:00（UTC+8），首次运行仍是当天 09:00，
    // 即 2026-03-01 09:00（UTC+8）=== 2026-03-01 01:00 UTC。
    const from = new Date('2026-03-01T00:00:00Z');
    const next = computeNextRun(BASE, from);
    expect(next).toBe('2026-03-01 01:00:00');
  });

  it('strictly moves past the reference instant for daily tasks', () => {
    // 基准正好是当天 09:00（北京时间）之后，应排到第二天。
    const from = new Date('2026-03-02T02:00:00Z'); // 10:00 UTC+8
    expect(computeNextRun(BASE, from)).toBe('2026-03-03 01:00:00');
  });

  it('honours the start date for a once task', () => {
    const from = new Date('2026-02-01T00:00:00Z');
    expect(computeNextRun({ ...BASE, recurrence: 'once' }, from)).toBe('2026-03-01 01:00:00');
    // 起始时间已过 -> 不再有后续运行。
    expect(computeNextRun({ ...BASE, recurrence: 'once' }, new Date('2026-04-01T00:00:00Z'))).toBeNull();
  });

  it('picks the requested weekday for weekly tasks', () => {
    // 基础 startDate 是 2026-03-01（周日）。取周一 by 9:00 已过的基准，
    // 应排到下一个周一：2026-03-09 09:00（UTC+8）= 2026-03-09 01:00 UTC。
    const from = new Date('2026-03-02T02:00:00Z'); // 周一 10:00 UTC+8
    expect(computeNextRun({ ...BASE, recurrence: 'weekly', weekday: 1 }, from)).toBe('2026-03-09 01:00:00');
  });

  it('clamps monthly runs to the last day of short months', () => {
    // 每月 31 号，从 2 月 1 日算起 -> 2 月只有 28 天，落在 28 号。
    const from = new Date('2026-02-01T00:00:00Z');
    const next = computeNextRun(
      { ...BASE, recurrence: 'monthly', dayOfMonth: 31, startDate: '2026-02-01' },
      from,
    );
    expect(next).toBe('2026-02-28 01:00:00');
  });

  it('stops when the end date is passed', () => {
    const from = new Date('2026-03-10T00:00:00Z');
    const next = computeNextRun({ ...BASE, endDate: '2026-03-05' }, from);
    expect(next).toBeNull();
  });

  it('returns null for an unparseable schedule', () => {
    expect(computeNextRun({ ...BASE, startDate: 'nope' }, new Date())).toBeNull();
    expect(computeNextRun({ ...BASE, timeOfDay: '99:99' }, new Date())).toBeNull();
  });
});

describe('describeSchedule', () => {
  it('renders a human readable summary', () => {
    expect(describeSchedule({ ...BASE, recurrence: 'daily' })).toBe('每天 09:00');
    expect(describeSchedule({ ...BASE, recurrence: 'weekly', weekday: 3 })).toBe('每周三 09:00');
    expect(describeSchedule({ ...BASE, recurrence: 'monthly', dayOfMonth: 15 })).toBe('每月 15 日 09:00');
    expect(describeSchedule({ ...BASE, recurrence: 'once' })).toBe('2026-03-01 09:00');
  });
});

describe('validateSchedule', () => {
  it('accepts a well-formed schedule', () => {
    expect(validateSchedule(BASE)).toBeNull();
  });

  it('rejects an end date earlier than the start', () => {
    expect(validateSchedule({ ...BASE, endDate: '2026-02-01' })).toContain('结束日期');
  });

  it('rejects malformed time and dates', () => {
    expect(validateSchedule({ ...BASE, timeOfDay: '25:00' })).toContain('HH:MM');
    expect(validateSchedule({ ...BASE, startDate: '2026-02-30' })).toContain('起始日期');
  });
});

describe('splitTitleAndBody', () => {
  it('lifts a leading H1 out as the title', () => {
    const result = splitTitleAndBody('# 你好世界\n\n正文第一段。', '兜底');
    expect(result.title).toBe('你好世界');
    expect(result.contentMd).toBe('正文第一段。');
  });

  it('strips markdown code fences around the whole answer', () => {
    const result = splitTitleAndBody('```markdown\n# 标题\n\n内容\n```', '兜底');
    expect(result.title).toBe('标题');
    expect(result.contentMd).toBe('内容');
  });

  it('falls back to the first short line when there is no heading', () => {
    const result = splitTitleAndBody('一个短标题\n\n然后是正文内容。', '兜底');
    expect(result.title).toBe('一个短标题');
    expect(result.contentMd).toBe('然后是正文内容。');
  });

  it('keeps the whole body and uses the fallback title for prose', () => {
    const body = '这是一段直接开始的正文，没有任何标题行，而且这句话很长很长。';
    const result = splitTitleAndBody(body, '兜底标题');
    expect(result.title).toBe('兜底标题');
    expect(result.contentMd).toBe(body);
  });

  it('uses the fallback for empty output', () => {
    expect(splitTitleAndBody('   ', '兜底标题')).toEqual({ title: '兜底标题', contentMd: '' });
  });
});

describe('parseTagsJson', () => {
  it('parses a JSON string array, trimming entries', () => {
    expect(parseTagsJson('["a", " b "]')).toEqual(['a', 'b']);
  });

  it('returns an empty array for malformed or non-array data', () => {
    expect(parseTagsJson(null)).toEqual([]);
    expect(parseTagsJson('not json')).toEqual([]);
    expect(parseTagsJson('{"a":1}')).toEqual([]);
    expect(parseTagsJson('["a", 2, ""]')).toEqual(['a']);
  });
});

describe('buildCoverPrompt', () => {
  it('prefers the task cover prompt over the title', () => {
    const withHint = buildCoverPrompt(
      { cover_prompt: '蓝色渐变' } as never,
      '文章标题',
    );
    expect(withHint).toContain('蓝色渐变');
    expect(withHint).not.toContain('文章标题');
  });

  it('falls back to the article title', () => {
    expect(buildCoverPrompt({ cover_prompt: '' } as never, '文章标题')).toContain('文章标题');
  });
});

describe('resolveAutomationStatus', () => {
  it('publishes directly when the task says so', () => {
    expect(resolveAutomationStatus('publish')).toEqual({ status: 'published', publish: true });
  });

  it('saves a draft by default', () => {
    expect(resolveAutomationStatus('draft')).toEqual({ status: 'draft', publish: false });
  });
});

describe('isLocalCoverSource', () => {
  it('treats site-relative media paths as local', () => {
    expect(isLocalCoverSource('/media/2026/01/cover.jpg')).toBe(true);
    expect(isLocalCoverSource('  /media/x.png  ')).toBe(true);
  });

  it('treats external and protocol-relative URLs as remote', () => {
    expect(isLocalCoverSource('https://example.com/a.jpg')).toBe(false);
    expect(isLocalCoverSource('http://example.com/a.jpg')).toBe(false);
    expect(isLocalCoverSource('//cdn.example.com/a.jpg')).toBe(false);
    expect(isLocalCoverSource('')).toBe(false);
  });
});

/** 把若干文本分片包装成 Workers AI 的 SSE 流式响应。 */
function articleSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payloads = chunks.map(
    (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
  );
  payloads.push('data: [DONE]\n\n');
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= payloads.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(payloads[index]));
      index += 1;
    },
  });
}

describe('generateArticle 流式成文', () => {
  it('取数轮写出的正文被丢弃,成文轮收回工具并走流式', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              value_json: JSON.stringify({ ...AI_DEFAULTS, enabled: true, provider: 'cloudflare' }),
            }),
          }),
        }),
      },
      AI: {
        run: async (_model: string, inputs: Record<string, unknown>) => {
          calls.push(inputs);
          // 第 1 轮没去读链接就"写"了正文:这段必须被丢弃,否则就是凭记忆编的。
          if (calls.length === 1) {
            return { choices: [{ message: { content: '# 凭记忆编的\n\n旧正文' } }] };
          }
          return articleSseStream(['# 真实标题\n\n', '真实正文']);
        },
      },
    } as unknown as Env;

    const task = { id: 1, name: '每日早报', prompt: '写一篇早报' } as AutomationTask;
    const article = await generateArticle(env, task);

    expect(article.title).toBe('真实标题');
    expect(article.contentMd).toContain('真实正文');
    // 成文轮必须是非流式之外的另一种请求:stream:true 且不再下发工具
    expect(calls[0].stream).toBeUndefined();
    expect(calls[1].stream).toBe(true);
    expect(calls[1].tools).toBeUndefined();
    // 并明确告知资料已取完、立即成文
    const messages = calls[1].messages as Array<{ role: string; content?: string }>;
    expect(messages[messages.length - 1]?.content).toContain('立即');
  });
});
