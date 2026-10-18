import type { EventContext } from '@cloudflare/workers-types';
import type { Env } from './lib/env';
import { listPosts } from './lib/posts-repo';
import { escapeXml } from './lib/seo';

type Ctx = EventContext<Env, string, Record<string, unknown>>;

const STATIC_PAGES = ['/', '/posts', '/tags', '/archive', '/about'];

export const onRequest = async (context: Ctx): Promise<Response> => {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const env = context.env;
  const url = new URL(context.request.url);
  const origin = (env.SITE_URL || url.origin).replace(/\/+$/, '');
  const { items } = await listPosts(env, { page: 1, perPage: 500, sort: 'newest' });

  const staticUrls = STATIC_PAGES.map(
    (path) =>
      `  <url><loc>${escapeXml(`${origin}${path}`)}</loc><changefreq>daily</changefreq></url>`,
  );

  const postUrls = items.map((post) => {
    const lastmod = (post.updated_at || post.created_at || '').slice(0, 10);
    const lastmodTag = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
    return `  <url><loc>${escapeXml(`${origin}/posts/${post.slug}`)}</loc>${lastmodTag}<changefreq>weekly</changefreq></url>`;
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
