import type { EventContext } from '@cloudflare/workers-types';
import type { Env } from './lib/env';

type Ctx = EventContext<Env, string, Record<string, unknown>>;

export const onRequest = async (context: Ctx): Promise<Response> => {
  const url = new URL(context.request.url);
  const origin = (context.env.SITE_URL || url.origin).replace(/\/+$/, '');

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
};
