import type { EventContext } from '@cloudflare/workers-types';
import type { Env } from './lib/env';
import { listArchive } from './lib/posts-repo';
import { escapeXml } from './lib/seo';

type Ctx = EventContext<Env, string, Record<string, unknown>>;

const STATIC_PAGES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/posts', changefreq: 'daily', priority: '0.9' },
  { path: '/tags', changefreq: 'weekly', priority: '0.6' },
  { path: '/archive', changefreq: 'weekly', priority: '0.5' },
  { path: '/about', changefreq: 'monthly', priority: '0.4' },
];

export const onRequest = async (context: Ctx): Promise<Response> => {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const env = context.env;
  const url = new URL(context.request.url);
  const origin = (env.SITE_URL || url.origin).replace(/\/+$/, '');
  // `listArchive` is unbounded (up to 20k) — the old 500-row list page silently
  // dropped every older article from the sitemap.
  const posts = await listArchive(env);

  const staticUrls = STATIC_PAGES.map(
    ({ path, changefreq, priority }) =>
      `  <url><loc>${escapeXml(`${origin}${path}`)}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`,
  );

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
${[...staticUrls, ...postUrls].join('\n')}
</urlset>
`;

  return new Response(context.request.method === 'HEAD' ? null : xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800, s-maxage=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
