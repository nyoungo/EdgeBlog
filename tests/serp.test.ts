import { describe, expect, it } from 'vitest';
import { resultsLookRelevant } from '../functions/lib/serp';

describe('resultsLookRelevant', () => {
  const relevant = [
    { title: '雷军_百度百科', url: 'https://baike.baidu.com/item/雷军', snippet: '小米创始人' },
  ];
  const junk = [
    { title: '冷冻干燥技术的原理', url: 'https://example.com/freeze', snippet: '食品保存' },
    { title: 'Windows 帮助文档', url: 'https://example.com/win', snippet: '系统设置' },
  ];

  it('accepts results containing the query term', () => {
    expect(resultsLookRelevant('雷军', relevant)).toBe(true);
    expect(resultsLookRelevant('雷军 最新动态', relevant)).toBe(true);
  });

  it('rejects unrelated results', () => {
    expect(resultsLookRelevant('雷军', junk)).toBe(false);
    expect(resultsLookRelevant('雷军 小米汽车 最新消息', junk)).toBe(false);
  });

  it('rejects prefix-only matches produced by query truncation', () => {
    const prefixJunk = [
      { title: '雷(汉语汉字)_百度百科', url: 'https://baike.baidu.com/item/雷', snippet: '雷电' },
      { title: '雷电模拟器官网_最新版下载', url: 'https://www.ldmnq.com/', snippet: '2026 最新版本' },
    ];
    expect(resultsLookRelevant('雷军', prefixJunk)).toBe(false);
    expect(resultsLookRelevant('雷军 最新动态 2026年11月', prefixJunk)).toBe(false);
  });

  it('accepts English keywords without requiring the whole phrase', () => {
    const english = [
      { title: 'Cloudflare Workers AI docs', url: 'https://developers.cloudflare.com/workers-ai/', snippet: 'Run models' },
    ];
    expect(resultsLookRelevant('Cloudflare Workers AI', english)).toBe(true);
    expect(resultsLookRelevant('Cloudflare Workers AI', junk)).toBe(false);
  });

  it('treats empty result sets as irrelevant', () => {
    expect(resultsLookRelevant('雷军', [])).toBe(false);
  });

  it('does not block queries without significant tokens', () => {
    expect(resultsLookRelevant('!!', junk)).toBe(true);
  });
});
