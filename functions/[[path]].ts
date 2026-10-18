/**
 * Single Pages Functions entry point.
 *
 * Dispatch order:
 *   1. /api/*            -> Hono app (functions/api)
 *   2. /media/*          -> stream the R2 object (dev/default media host)
 *   3. HTML navigations  -> app shell with per-route SEO meta injected
 *   4. everything else   -> static asset (hashed JS/CSS, images, …)
 *
 * Keeping one entry avoids any ambiguity about `_redirects` swallowing /api
 * (the usual `/  * /index.html 200` footgun).
 */
import type { EventContext } from '@cloudflare/workers-types';
import { api } from './api';
import type { Env } from './lib/env';
import { buildSeo, injectBootSettings, injectSeo } from './lib/seo';
import { getSettings } from './lib/settings';

type Ctx = EventContext<Env, string, Record<string, unknown>>;

const IMMUTABLE = 'public, max-age=31536000, immutable';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

async function serveMedia(context: Ctx, url: URL): Promise<Response> {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const key = decodeURIComponent(url.pathname.slice('/media/'.length));
  if (!key || key.includes('..')) {
    return new Response('Not Found', { status: 404 });
  }
  const object = await context.env.MEDIA.get(key);
  if (!object) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', IMMUTABLE);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(context.request.method === 'HEAD' ? null : object.body, { headers });
}

/** True for top-level document requests (SPA routes), false for asset requests. */
function wantsHtmlNavigation(request: Request, url: URL): boolean {
  if (request.method !== 'GET') return false;
  const accept = request.headers.get('accept') ?? '';
  if (!accept.includes('text/html')) return false;
  const lastSegment = url.pathname.split('/').pop() ?? '';
  return !lastSegment.includes('.');
}

/**
 * Serve the SPA shell with meta tags resolved for the current route.
 * The shell is fetched from the asset store (never from ourselves, to avoid a
 * request loop) and only the <head> is rewritten.
 */
async function serveShell(context: Ctx, url: URL): Promise<Response | null> {
  const index = await context.env.ASSETS.fetch(new URL('/index.html', url.origin));
  if (!index.ok) return null;

  const html = await index.text();
  let body = html;
  try {
    body = injectSeo(html, await buildSeo(context.env, url));
    body = injectBootSettings(body, await getSettings(context.env));
  } catch (err) {
    // SEO must never break page delivery.
    console.error('[seo] injection failed', err);
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Allow shared caches to serve fresh-ish HTML while revalidating often.
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ...SECURITY_HEADERS,
    },
  });
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const url = new URL(context.request.url);

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return api.fetch(context.request, context.env, context as unknown as ExecutionContext);
  }

  if (url.pathname.startsWith('/media/')) {
    return serveMedia(context, url);
  }

  if (wantsHtmlNavigation(context.request, url)) {
    const shell = await serveShell(context, url);
    if (shell) return shell;
  }

  return context.next();
};
