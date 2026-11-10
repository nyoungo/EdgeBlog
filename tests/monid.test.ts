import { describe, expect, it } from 'vitest';
import {
  MONID_SEARCH_ENDPOINT,
  MONID_SEARCH_PROVIDER,
  buildMonidSearchRequest,
  describeMonidError,
  parseMonidSearchOutput,
} from '../functions/lib/monid';

/** 结构取自 api.monid.ai 的 `POST /v1/run` 真实响应（已简化）。 */
const fixture = {
  runId: '01M727JZK123M0VRXT4MY8ABT8',
  provider: 'tinyfish',
  endpoint: '/free/search',
  status: 'COMPLETED',
  output: {
    query: '雷军 最新动态',
    results: [
      {
        position: 1,
        title: '雷军最新演讲！汽车安全是基础',
        url: 'https://finance.sina.com.cn/roll/2025-10-16/doc-infuauti2441566.shtml',
        snippet: '10月16日，雷军在2025世界智能网联汽车大会称……',
        site_name: 'finance.sina.com.cn',
      },
      {
        position: 2,
        title: '雷军最新内部演讲',
        url: 'https://www.cls.cn/detail/2032644',
        snippet: '雷军首次回应 SU7 事故。',
        site_name: 'www.cls.cn',
      },
    ],
    total_results: 2,
    page: 0,
  },
  price: { type: 'PER_CALL', amount: { value: 0, currency: 'USD' } },
};

describe('buildMonidSearchRequest', () => {
  it('targets the verified free TinyFish search endpoint', () => {
    const request = buildMonidSearchRequest('雷军 最新动态');
    expect(request.provider).toBe(MONID_SEARCH_PROVIDER);
    expect(request.provider).toBe('tinyfish');
    expect(request.endpoint).toBe(MONID_SEARCH_ENDPOINT);
    expect(request.input.queryParams.query).toBe('雷军 最新动态');
  });
});

describe('parseMonidSearchOutput', () => {
  it('maps the run envelope to title / url / snippet', () => {
    expect(parseMonidSearchOutput(fixture, 5)).toEqual([
      {
        title: '雷军最新演讲！汽车安全是基础',
        url: 'https://finance.sina.com.cn/roll/2025-10-16/doc-infuauti2441566.shtml',
        snippet: '10月16日，雷军在2025世界智能网联汽车大会称……',
      },
      {
        title: '雷军最新内部演讲',
        url: 'https://www.cls.cn/detail/2032644',
        snippet: '雷军首次回应 SU7 事故。',
      },
    ]);
  });

  it('reads a bare results array and alternative field names', () => {
    const payload = {
      results: [
        { name: '文档', link: 'https://example.com/docs', description: '说明' },
        { title: '博客', href: 'https://example.com/post', content: '正文' },
      ],
    };
    expect(parseMonidSearchOutput(payload)).toEqual([
      { title: '文档', url: 'https://example.com/docs', snippet: '说明' },
      { title: '博客', url: 'https://example.com/post', snippet: '正文' },
    ]);
  });

  it('skips non-http and duplicate urls', () => {
    const payload = {
      output: {
        results: [
          { title: '非法', url: 'javascript:alert(1)' },
          { title: '一', url: 'https://example.com/a', snippet: 'a' },
          { title: '重复', url: 'https://example.com/a', snippet: 'b' },
        ],
      },
    };
    expect(parseMonidSearchOutput(payload, 5)).toEqual([
      { title: '一', url: 'https://example.com/a', snippet: 'a' },
    ]);
  });

  it('falls back to the url as title and clamps the limit', () => {
    const payload = {
      output: {
        results: Array.from({ length: 12 }, (_, i) => ({ url: `https://example.com/${i}` })),
      },
    };
    const results = parseMonidSearchOutput(payload, 99);
    expect(results).toHaveLength(10);
    expect(results[0]).toEqual({ title: 'https://example.com/0', url: 'https://example.com/0', snippet: '' });
  });

  it('returns an empty list for an unknown payload', () => {
    expect(parseMonidSearchOutput(null)).toEqual([]);
    expect(parseMonidSearchOutput({ output: { results: 'nope' } })).toEqual([]);
  });
});

describe('describeMonidError', () => {
  it('explains auth and balance failures', () => {
    expect(describeMonidError({ message: 'invalid api key' }, 401)).toBe('API Key 无效或无权访问：invalid api key');
    expect(describeMonidError({ message: 'no funds' }, 402)).toBe('账户余额不足：no funds');
    expect(describeMonidError({ error: 'forbidden' }, 403)).toBe('API Key 无效或无权访问：forbidden');
  });

  it('keeps the server message for validation errors', () => {
    expect(describeMonidError({ message: 'query too short' }, 400)).toBe('HTTP 400：query too short');
  });

  it('falls back to the status code when the body is not JSON', () => {
    expect(describeMonidError(null, 500)).toBe('HTTP 500');
  });
});
