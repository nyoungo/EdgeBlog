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

/**
 * The shell has to stay usable with user-supplied `advanced.headHtml`, inline
 * theme boot script and CSS variables, so `'unsafe-inline'` is unavoidable for
 * script/style. Everything else is locked to same-origin, with `https:` allowed
 * for user-embedded images/media/players.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-src https:",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
};

/** Preview deployments (`<project>.pages.dev`) must never be indexed. */
function isPreviewHost(hostname: string): boolean {
  return /(?:^|\.)(?:pages|workers)\.dev$/i.test(hostname);
}

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

/** Short content hash used as the shell's ETag. */
async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
  let status = 200;
  let noindex = false;
  try {
    // One settings read for both the SEO block and the hydration payload.
    const settings = await getSettings(context.env);
    const seo = await buildSeo(context.env, url, settings);
    // Preview hosts are public but not the canonical site: keep them out of
    // the index without changing the page itself.
    const effective = isPreviewHost(url.hostname) ? { ...seo, noindex: true } : seo;
    status = effective.status;
    noindex = effective.noindex;
    body = injectSeo(html, effective);
    body = injectBootSettings(body, settings);
  } catch (err) {
    // SEO must never break page delivery.
    console.error('[seo] injection failed', err);
  }

  // Revalidation without re-downloading: the shell is rebuilt per route, so it
  // cannot be cached hard, but an ETag turns repeat navigations into 304s.
  const etag = `W/"${await shortHash(body)}"`;
  const revalidate = 'public, max-age=0, must-revalidate';
  if (context.request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': revalidate } });
  }

  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ETag: etag,
      'Cache-Control': revalidate,
      ...SECURITY_HEADERS,
      ...(noindex || status === 404 ? { 'X-Robots-Tag': 'noindex' } : {}),
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
