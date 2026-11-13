/**
 * RSS / sitemap / robots 响应构造。
 *
 * 从原 Pages Functions 的三个独立路由文件抽出，改成接收 (env, request, url)
 * 的纯函数，供 Worker 入口按路径分发。行为保持不变，只把 `context.*` 换成
 * 显式参数。
 */
import type { Env } from './env';
import { listPosts } from './posts-repo';
import { listArchive } from './posts-repo';
import { listColumns } from './columns-repo';
import { escapeXml } from './seo';
import { getSettings } from './settings';

const STATIC_PAGES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/posts', changefreq: 'daily', priority: '0.9' },
  { path: '/columns', changefreq: 'weekly', priority: '0.8' },
  { path: '/tags', changefreq: 'weekly', priority: '0.6' },
  { path: '/archive', changefreq: 'weekly', priority: '0.5' },
  { path: '/about', changefreq: 'monthly', priority: '0.4' },
];

function methodNotAllowed(): Response {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
}

function rfc822(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toUTCString();
}

/** GET/HEAD /rss.xml — 博客文章订阅源（专栏文章不进主 feed）。 */
export async function rssResponse(env: Env, request: Request, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();

  const settings = await getSettings(env);
  if (!settings.features.rss) return new Response('Not Found', { status: 404 });

  const origin = (env.SITE_URL || url.origin).replace(/\/+$/, '');
  const { items } = await listPosts(env, { page: 1, perPage: 20, sort: 'newest', scope: 'blog' });

  const entries = items
    .map((post) => {
      // CJK slugs must be percent-encoded to form a usable feed link.
      const link = `${origin}/posts/${encodeURIComponent(post.slug)}`;
      const date = rfc822(post.published_at);
      const tags = post.tags.map((t) => `      <category>${escapeXml(t.name)}</category>`).join('\n');
      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        date ? `      <pubDate>${date}</pubDate>` : '',
        `      <description>${escapeXml(post.excerpt)}</description>`,
        tags,
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(settings.site.name)}</title>
    <link>${escapeXml(origin)}</link>
    <description>${escapeXml(settings.site.description)}</description>
    <language>${escapeXml(settings.site.locale || 'zh-cn')}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml" />
${entries}
  </channel>
</rss>
`;

  return new Response(request.method === 'HEAD' ? null : xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** GET/HEAD /sitemap.xml — 静态页 + 专栏页 + 全部文章。 */
export async function sitemapResponse(env: Env, request: Request, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();

  const origin = (env.SITE_URL || url.origin).replace(/\/+$/, '');
  // `listArchive` is unbounded (up to 20k) — the old 500-row list page silently
  // dropped every older article from the sitemap.
  // `all` 让专栏文章也进站点地图（它们有独立详情页），专栏详情页本身也要收录。
  const posts = await listArchive(env, 20_000, 'all');
  const columns = await listColumns(env);

  const staticUrls = STATIC_PAGES.map(
    ({ path, changefreq, priority }) =>
      `  <url><loc>${escapeXml(`${origin}${path}`)}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`,
  );

  const columnUrls = columns.map((column) => {
    const loc = `${origin}/columns/${encodeURIComponent(column.slug)}`;
    const lastmod = (column.last_published_at || column.updated_at || '').slice(0, 10);
    const lastmodTag = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
    return `  <url><loc>${escapeXml(loc)}</loc>${lastmodTag}<changefreq>weekly</changefreq><priority>0.7</priority></url>`;
  });

  const postUrls = posts.map((post) => {
    // Slugs may contain non-ASCII characters: percent-encode so the URL is a
    // valid sitemap entry (escaped XML afterwards).
    const loc = `${origin}/posts/${encodeURIComponent(post.slug)}`;
    const lastmod = (post.updated_at || post.created_at || '').slice(0, 10);
    const lastmodTag = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
    return `  <url><loc>${escapeXml(loc)}</loc>${lastmodTag}<changefreq>weekly</changefreq><priority>0.8</priority></url>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...columnUrls, ...postUrls].join('\n')}
</urlset>
`;

  return new Response(request.method === 'HEAD' ? null : xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800, s-maxage=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** GET /robots.txt — 屏蔽后台与 API，指向 sitemap。 */
export function robotsResponse(env: Env, url: URL): Response {
  const origin = (env.SITE_URL || url.origin).replace(/\/+$/, '');
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
