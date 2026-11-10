import { describe, expect, it } from 'vitest';
import {
  bingSearchRssUrl,
  bingSearchUrl,
  looksLikeBingChallenge,
  parseBingResults,
  parseBingRss,
  resultsLookRelevant,
  unwrapBingUrl,
} from '../functions/lib/serp';

/** 结构取自 bing.com/search 的真实结果块(已简化内部噪声)。 */
const fixture = `
<ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://example.com/docs" h="ID=SERP,1">Workers AI <strong>文档</strong></a></h2>
    <div class="b_caption"><p class="b_lineclamp4">在边缘运行 AI 模型的完整指南。</p></div>
  </li>
  <li class="b_algo">
    <h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9ibG9nLmV4YW1wbGUub3JnL3Bvc3Q&ntb=1">博客文章</a></h2>
    <div class="b_caption"><p>关于 Workers &amp; AI 的实践记录。</p></div>
  </li>
  <li class="b_algo">
    <h2><a href="https://example.com/docs">重复结果</a></h2>
    <div class="b_caption"><p>应被去重。</p></div>
  </li>
  <li class="b_algo">
    <h2><a href="javascript:void(0)">非法链接</a></h2>
    <div class="b_caption"><p>应被跳过。</p></div>
  </li>
</ol>`;

const rssFixture = `<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0"><channel>
  <title>必应:雷军</title>
  <item>
    <title>雷军_百度百科</title>
    <link>https://baike.baidu.com/item/%E9%9B%B7%E5%86%9B/1968</link>
    <description><![CDATA[<b>雷军</b>,小米科技创始人。]]></description>
  </item>
  <item>
    <title>雷军的微博_微博</title>
    <link>https://www.weibo.com/leijun</link>
    <description>小米创办人 &amp; CEO。</description>
  </item>
  <item>
    <title>非法链接</title>
    <link>javascript:alert(1)</link>
  </item>
</channel></rss>`;

describe('parseBingResults', () => {
  it('extracts title, url and snippet', () => {
    const results = parseBingResults(fixture);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Workers AI 文档',
      url: 'https://example.com/docs',
      snippet: '在边缘运行 AI 模型的完整指南。',
    });
  });

  it('unwraps bing redirect links and decodes entities', () => {
    const results = parseBingResults(fixture);
    expect(results[1].url).toBe('https://blog.example.org/post');
    expect(results[1].snippet).toBe('关于 Workers & AI 的实践记录。');
  });

  it('respects the limit', () => {
    expect(parseBingResults(fixture, 1)).toHaveLength(1);
  });

  it('returns an empty list when the layout changes', () => {
    expect(parseBingResults('<div>完全不同的页面</div>')).toEqual([]);
  });
});

describe('parseBingRss', () => {
  it('extracts items and strips CDATA / HTML from titles and snippets', () => {
    const results = parseBingRss(rssFixture);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: '雷军_百度百科',
      url: 'https://baike.baidu.com/item/%E9%9B%B7%E5%86%9B/1968',
      snippet: '雷军,小米科技创始人。',
    });
    expect(results[1].snippet).toBe('小米创办人 & CEO。');
  });

  it('skips non-http links', () => {
    const results = parseBingRss(rssFixture);
    expect(results.some((result) => result.title === '非法链接')).toBe(false);
  });

  it('respects the limit and handles empty input', () => {
    expect(parseBingRss(rssFixture, 1)).toHaveLength(1);
    expect(parseBingRss('')).toEqual([]);
  });
});

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

  it('treats empty result sets as irrelevant', () => {
    expect(resultsLookRelevant('雷军', [])).toBe(false);
  });

  it('does not block queries without significant tokens', () => {
    expect(resultsLookRelevant('!!', junk)).toBe(true);
  });
});

describe('unwrapBingUrl', () => {
  it('keeps normal http(s) links', () => {
    expect(unwrapBingUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(unwrapBingUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('drops bing internal and non-http links', () => {
    expect(unwrapBingUrl('javascript:alert(1)')).toBe('');
    expect(unwrapBingUrl('https://www.bing.com/images/search?q=x')).toBe('');
    expect(unwrapBingUrl('https://www.bing.com/ck/a?u=bad-payload')).toBe('');
  });
});

describe('bingSearchUrl', () => {
  it('encodes the query and clamps count', () => {
    const url = new URL(bingSearchUrl('中文 搜索', 99));
    expect(url.origin).toBe('https://www.bing.com');
    expect(url.searchParams.get('q')).toBe('中文 搜索');
    expect(url.searchParams.get('count')).toBe('10');
  });
});

describe('bingSearchRssUrl', () => {
  it('requests the RSS format with the same query and market', () => {
    const url = new URL(bingSearchRssUrl('雷军', 5));
    expect(url.searchParams.get('q')).toBe('雷军');
    expect(url.searchParams.get('format')).toBe('rss');
    expect(url.searchParams.get('count')).toBe('5');
    expect(url.searchParams.get('mkt')).toBe('zh-CN');
  });
});

describe('looksLikeBingChallenge', () => {
  it('detects captcha / human verification pages', () => {
    expect(looksLikeBingChallenge('<title>Verify you are human</title>')).toBe(true);
    expect(looksLikeBingChallenge('<div>请输入验证码</div>')).toBe(true);
    expect(looksLikeBingChallenge(fixture)).toBe(false);
  });
});