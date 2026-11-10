import { describe, expect, it } from 'vitest';
import {
  bingSearchUrl,
  looksLikeBingChallenge,
  parseBingResults,
  unwrapBingUrl,
} from '../functions/lib/serp';

/** 结构取自 bing.com/search 的真实结果块（已简化内部噪声）。 */
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

describe('looksLikeBingChallenge', () => {
  it('detects captcha / human verification pages', () => {
    expect(looksLikeBingChallenge('<title>Verify you are human</title>')).toBe(true);
    expect(looksLikeBingChallenge('<div>请输入验证码</div>')).toBe(true);
    expect(looksLikeBingChallenge(fixture)).toBe(false);
  });
});
