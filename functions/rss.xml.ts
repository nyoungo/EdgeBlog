import type { EventContext } from '@cloudflare/workers-types';
import type { Env } from './lib/env';
import { listPosts } from './lib/posts-repo';
import { escapeXml } from './lib/seo';
import { getSettings } from './lib/settings';

type Ctx = EventContext<Env, string, Record<string, unknown>>;

function pubDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toUTCString();
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const env = context.env;
  const settings = await getSettings(env);
  if (!settings.features.rss) return new Response('Not Found', { status: 404 });

  const url = new URL(context.request.url);
  const origin = (env.SITE_URL || url.origin).replace(/\/+$/, '');
  const { items } = await listPosts(env, { page: 1, perPage: 20, sort: 'newest' });

  const entries = items
    .map((post) => {
      const link = `${origin}/posts/${post.slug}`;
      const date = pubDate(post.published_at);
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

  return new Response(context.request.method === 'HEAD' ? null : xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
