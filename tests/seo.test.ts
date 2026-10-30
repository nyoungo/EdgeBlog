import { describe, expect, it } from 'vitest';
import { escapeXml, injectSeo, type SeoMeta } from '../functions/lib/seo';

const base: SeoMeta = {
  title: '文章 <标题> & "引号"',
  description: '描述 <b>标签</b>',
  canonical: 'https://example.com/posts/hello',
  type: 'article',
  siteName: 'Edge Blog',
  locale: 'zh-CN',
  favicon: '/favicon.svg',
  status: 200,
  noindex: false,
  rssUrl: 'https://example.com/rss.xml',
  publishedAt: '2026-01-02 03:04:05',
  updatedAt: '2026-02-03 04:05:06',
};

const shell = `<!doctype html>
<html lang="zh-CN">
  <head>
    <title>Edge Blog</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <!--seo-->
  </head>
  <body><div id="root"></div></body>
</html>`;

describe('injectSeo', () => {
  it('replaces the shell title and removes the static icon', () => {
    const html = injectSeo(shell, base);
    expect(html).not.toContain('<title>Edge Blog</title>');
    expect(html).toContain('<title>文章 &lt;标题&gt; &amp; &quot;引号&quot;</title>');
    expect(html.match(/rel="icon"/g)).toHaveLength(1);
  });

  it('escapes metadata and emits canonical/OG/article tags', () => {
    const html = injectSeo(shell, base);
    expect(html).toContain('<link rel="canonical" href="https://example.com/posts/hello" />');
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain('property="article:published_time" content="2026-01-02T03:04:05Z"');
    expect(html).toContain('property="article:modified_time" content="2026-02-03T04:05:06Z"');
    expect(html).toContain('<meta name="description" content="描述 &lt;b&gt;标签&lt;/b&gt;" />');
  });

  it('adds the RSS discovery link and follows the configured locale', () => {
    const html = injectSeo(shell, base);
    expect(html).toContain('rel="alternate" type="application/rss+xml"');
    expect(html).toContain('href="https://example.com/rss.xml"');
    expect(html).toContain('<html lang="zh-CN">');
  });

  it('emits robots noindex and a JSON-LD block when asked', () => {
    const html = injectSeo(shell, {
      ...base,
      status: 404,
      noindex: true,
      publishedAt: null,
      updatedAt: null,
      jsonLd: { '@type': 'BlogPosting', headline: '</script>' },
    });
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain('\\u003c/script>');
    expect(html).not.toContain('article:modified_time');
  });

  it('still injects when the placeholder was stripped by the build', () => {
    const withoutPlaceholder = shell.replace('<!--seo-->', '');
    const html = injectSeo(withoutPlaceholder, { ...base, rssUrl: null });
    expect(html).toContain('<title>文章 &lt;标题&gt; &amp; &quot;引号&quot;</title>');
    expect(html).not.toContain('application/rss+xml');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
