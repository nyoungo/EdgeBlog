/**
 * Edge Blog Worker 入口。
 *
 * 原来是一个 Cloudflare Pages Functions 入口（`functions/[[path]].ts`）；改成
 * Worker 之后同一套 `fetch` 逻辑保留，并新增 `scheduled` 定时器来执行
 * 「定时自动写文」任务——Pages 不支持 Cron Trigger，这是迁移的根本原因。
 *
 * 分发顺序：
 *   1. /api/*                            -> Hono app（functions/api）
 *   2. /media/*                          -> 从 R2 流式返回对象（带 Range）
 *   3. /rss.xml /sitemap.xml /robots.txt -> feed 处理器
 *   4. HTML 导航                         -> 注入 SEO meta 的应用外壳
 *   5. 其余                              -> 静态资源（assets binding）
 *
 * `wrangler.toml` 里通过 `[assets] run_worker_first = true` 让所有请求先经过
 * 本 Worker，因此上面的顺序就是最终顺序。
 */
import { api } from './api';
import type { Env } from './lib/env';
import { runDueAutomationTasks } from './lib/automation';
import { robotsResponse, rssResponse, sitemapResponse } from './lib/feeds';
import { buildSeo, injectBootSettings, injectSeo } from './lib/seo';
import { getSettings } from './lib/settings';
import { parseByteRange } from './lib/media-file';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * 外壳必须兼容用户自定义的 `advanced.headHtml`、内联主题启动脚本与 CSS 变量，
 * 所以 `'unsafe-inline'` 无法避免；其余一律锁到同源，只在图片/媒体/播放器上
 * 放行 https:。
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

/** 预览部署（`<project>.pages.dev` / `<worker>.workers.dev`）不得被收录。 */
function isPreviewHost(hostname: string): boolean {
  return /(?:^|\.)(?:pages|workers)\.dev$/i.test(hostname);
}

/** GET/HEAD /media/* — 从 R2 流式返回，支持视频拖动所需的 Range。 */
async function serveMedia(env: Env, request: Request, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice('/media/'.length));
  } catch {
    return new Response('Not Found', { status: 404 });
  }
  if (!key || key.includes('..')) {
    return new Response('Not Found', { status: 404 });
  }

  // `head` 先拿到总长度，这样校验 Range 时不必把对象下载两次。
  const meta = await env.MEDIA.head(key);
  if (!meta) return new Response('Not Found', { status: 404 });

  const rangeHeader = request.headers.get('range');
  const range = parseByteRange(rangeHeader, meta.size);
  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${meta.size}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const object = range ? await env.MEDIA.get(key, { range }) : await env.MEDIA.get(key);
  if (!object) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', IMMUTABLE);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Accept-Ranges', 'bytes');
  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`);
    headers.set('Content-Length', String(range.length));
  } else {
    headers.set('Content-Length', String(meta.size));
  }
  return new Response(request.method === 'HEAD' ? null : object.body, {
    status: range ? 206 : 200,
    headers,
  });
}

/** 外壳 ETag 用的短内容哈希。 */
async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 顶层文档请求（SPA 路由）为 true，资源请求为 false。 */
function wantsHtmlNavigation(request: Request, url: URL): boolean {
  if (request.method !== 'GET') return false;
  const accept = request.headers.get('accept') ?? '';
  if (!accept.includes('text/html')) return false;
  const lastSegment = url.pathname.split('/').pop() ?? '';
  return !lastSegment.includes('.');
}

/**
 * 给静态资源响应补上安全头与缓存策略。
 *
 * 这些规则原本写在 `public/_headers` 里，但 `run_worker_first` 生效后该文件
 * 不再作用于经过 Worker 的响应，所以统一在这里施加，保持唯一来源。
 */
function decorateAsset(url: URL, response: Response): Response {
  // 304 / 无需改写的响应也要带上安全头。
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (url.pathname.startsWith('/assets/')) {
    // 带哈希的资源是内容寻址的，可以长期强缓存。
    headers.set('Cache-Control', IMMUTABLE);
  } else if (url.pathname === '/favicon.svg') {
    headers.set('Cache-Control', 'public, max-age=86400');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 返回注入了当前路由 SEO meta 的 SPA 外壳。
 * 外壳从 assets 取（绝不向自身发请求，避免循环），只改写 <head>。
 */
async function serveShell(env: Env, request: Request, url: URL): Promise<Response | null> {
  const index = await env.ASSETS.fetch(new URL('/index.html', url.origin));
  if (!index.ok) return null;

  const html = await index.text();
  let body = html;
  let status = 200;
  let noindex = false;
  try {
    // 一次读取设置，供 SEO 块与 hydration payload 共用。
    const settings = await getSettings(env);
    const seo = await buildSeo(env, url, settings);
    // 预览域名公开但不属于正式站点：保持页面不变，只是不收录。
    const effective = isPreviewHost(url.hostname) ? { ...seo, noindex: true } : seo;
    status = effective.status;
    noindex = effective.noindex;
    body = injectSeo(html, effective);
    body = injectBootSettings(body, settings);
  } catch (err) {
    // SEO 绝不能影响页面送达。
    console.error('[seo] injection failed', err);
  }

  // 外壳按路由重建，无法硬缓存；但 ETag 能让重复导航变成 304 而不重传。
  const etag = `W/"${await shortHash(body)}"`;
  const revalidate = 'public, max-age=0, must-revalidate';
  if (request.headers.get('if-none-match') === etag) {
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

async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api' || path.startsWith('/api/')) {
    return api.fetch(request, env, ctx);
  }

  if (path.startsWith('/media/')) {
    return serveMedia(env, request, url);
  }

  if (path === '/rss.xml') return rssResponse(env, request, url);
  if (path === '/sitemap.xml') return sitemapResponse(env, request, url);
  if (path === '/robots.txt') return robotsResponse(env, url);

  if (wantsHtmlNavigation(request, url)) {
    const shell = await serveShell(env, request, url);
    if (shell) return shell;
  }

  // 静态资源：hashed JS/CSS、图片、manifest 等，交给 assets binding。
  // assets 响应不走 _headers 规则，这里统一补安全头与缓存策略。
  return decorateAsset(url, await env.ASSETS.fetch(request));
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },

  /**
   * Cron Trigger 入口（见 wrangler.toml 的 [triggers]）。
   * 采用「高频轮询 + 到期执行」：把到期的自动化任务跑掉即可。
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runDueAutomationTasks(env)
        .then((result) => {
          if (result.picked > 0) {
            console.log(
              `[automation] due tasks: picked=${result.picked} ok=${result.succeeded} failed=${result.failed}`,
            );
          }
        })
        .catch((err) => console.error('[automation] scheduled run failed', err)),
    );
  },
} satisfies ExportedHandler<Env>;
