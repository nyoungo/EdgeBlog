/**
 * Server-side SEO for the SPA shell.
 *
 * There is no HTML renderer on the edge, so we take the static `index.html`
 * produced by Vite, strip its default <title>, and inject per-route meta tags
 * (+ JSON-LD). Search engines and social crawlers see real metadata; the client
 * bundle then takes over and updates `document.title` on navigation.
 */
import type { Env } from './env';
import type { PublicSettings } from '@shared/types';
import { renderFaviconSvg } from './favicon';
import { getPostSeoBySlug } from './posts-repo';
import { getColumnBySlug } from './columns-repo';
import { getSettings } from './settings';

/**
 * Icon href for the shell: an explicit `site.favicon` wins, otherwise the brand
 * icon (accent + site initial) is generated and inlined as a data URI — no extra
 * route, and it follows the current settings without any cache invalidation.
 */
function resolveFavicon(settings: PublicSettings): string {
  const configured = settings.site.favicon?.trim();
  if (configured) return configured;
  return `data:image/svg+xml,${encodeURIComponent(renderFaviconSvg(settings))}`;
}

export interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  image?: string | null;
  type: 'website' | 'article';
  siteName: string;
  locale: string;
  /** Absolute path or URL of the tab icon (`site.favicon`, else the generated one). */
  favicon: string;
  /** HTTP status the shell should be served with (404 for a missing article). */
  status: number;
  /** Emit `<meta name="robots" content="noindex">` (404s, preview hosts, search). */
  noindex: boolean;
  /** Absolute discovery URL for the feed, when RSS is enabled. */
  rssUrl?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  author?: string | null;
  jsonLd?: Record<string, unknown> | null;
}

/** Escape text for HTML text nodes / attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(value: string): string {
  return escapeHtml(value);
}

export function absoluteUrl(value: string | null | undefined, origin: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `${origin}${value.startsWith('/') ? '' : '/'}${value}`;
}

const TITLES: Record<string, string> = {
  '/posts': '文章',
  '/columns': '专栏',
  '/tags': '标签',
  '/archive': '归档',
  '/search': '搜索',
};

/** Static SPA routes that legitimately render the shell (not a 404). */
const STATIC_PATHS = new Set(['/', '/posts', '/columns', '/tags', '/archive', '/search', '/about', '/admin']);

/**
 * Resolve the metadata for a given request URL.
 *
 * `settingsOverride` lets the shell pass the settings it already fetched so a
 * single request does not read them twice (KV hit + parse each time).
 */
export async function buildSeo(
  env: Env,
  url: URL,
  settingsOverride?: PublicSettings,
): Promise<SeoMeta> {
  const settings = settingsOverride ?? (await getSettings(env));
  const siteName = settings.site.name;
  const origin = (env.SITE_URL || url.origin).replace(/\/+$/, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const canonical = `${origin}${path === '/' ? '/' : path}`;
  const locale = settings.site.locale || 'zh-CN';
  // A configured brand image doubles as the fallback share card.
  const fallbackImage = absoluteUrl(
    settings.site.logo.type === 'image' ? settings.site.logo.imageUrl : null,
    origin,
  );

  const base: SeoMeta = {
    title: siteName,
    description: settings.site.description,
    canonical,
    image: fallbackImage,
    type: 'website',
    siteName,
    locale,
    favicon: resolveFavicon(settings),
    status: 200,
    noindex: false,
    rssUrl: settings.features.rss ? `${origin}/rss.xml` : null,
  };

  const postMatch = path.match(/^\/posts\/([^/]+)$/);
  if (postMatch?.[1]) {
    let slug = postMatch[1];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      /* keep raw */
    }
    const post = await getPostSeoBySlug(env, slug);
    if (!post) {
      // Unknown/unpublished article: the shell is still rendered (the SPA shows
      // its own "not found" view) but with a real 404 status and noindex.
      return {
        ...base,
        status: 404,
        noindex: true,
        title: `文章不存在 · ${siteName}`,
        description: '这篇文章可能已被删除，或者从未发布。',
      };
    }
    const title = post.meta_title || post.title;
    const description = post.meta_description || post.excerpt || settings.site.description;
    const image = absoluteUrl(post.og_image || post.cover_url, origin) ?? fallbackImage;
    const updatedAt = post.updated_at || post.published_at;
    return {
      ...base,
      title: `${title} · ${siteName}`,
      description,
      image,
      type: 'article',
      publishedAt: post.published_at,
      updatedAt,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: title,
        description,
        ...(image ? { image } : {}),
        ...(post.published_at ? { datePublished: `${post.published_at.replace(' ', 'T')}Z` } : {}),
        ...(updatedAt ? { dateModified: `${updatedAt.replace(' ', 'T')}Z` } : {}),
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
        author: { '@type': 'Person', name: settings.site.name },
        publisher: { '@type': 'Organization', name: siteName },
        wordCount: post.word_count,
        ...(post.column_name ? { articleSection: post.column_name } : {}),
      },
    };
  }

  if (path === '/') {
    return {
      ...base,
      title: `${siteName} — ${settings.site.tagline}`.replace(/ — $/, ''),
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: siteName,
        url: `${origin}/`,
        description: settings.site.description,
      },
    };
  }

  if (path === '/about') {
    return { ...base, title: `${settings.pages.about.title} · ${siteName}` };
  }

  // 专栏详情页：标题与描述来自专栏自身，未知/隐藏专栏按 404 处理。
  const columnMatch = path.match(/^\/columns\/([^/]+)$/);
  if (columnMatch?.[1]) {
    let slug = columnMatch[1];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      /* keep raw */
    }
    const column = await getColumnBySlug(env, slug);
    if (!column) {
      return {
        ...base,
        status: 404,
        noindex: true,
        title: `专栏不存在 · ${siteName}`,
        description: '这个专栏可能已被删除，或者从未公开。',
      };
    }
    return {
      ...base,
      title: `${column.name} · ${siteName}`,
      description: column.description || settings.site.description,
      image: absoluteUrl(column.cover_url, origin) ?? fallbackImage,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: column.name,
        description: column.description || settings.site.description,
        url: canonical,
        isPartOf: { '@type': 'Blog', name: siteName, url: `${origin}/` },
      },
    };
  }

  // Search results are per-request and must never be indexed.
  if (path === '/search') {
    return { ...base, title: `${TITLES['/search']} · ${siteName}`, noindex: true };
  }

  const label = TITLES[path];
  if (label) return { ...base, title: `${label} · ${siteName}` };

  // Admin shell is never indexed, but it must not be reported as a 404.
  if (path === '/admin' || path.startsWith('/admin/')) {
    return { ...base, title: `管理后台 · ${siteName}`, noindex: true };
  }

  // Anything else is not a real page: return a genuine 404 instead of a 200
  // that only *looks* like "not found" to a human. Crawlers must see the
  // status, otherwise every mistyped URL becomes an indexable soft-404.
  if (!STATIC_PATHS.has(path)) {
    return {
      ...base,
      status: 404,
      noindex: true,
      title: `页面不存在 · ${siteName}`,
      description: '你访问的页面不存在,可能已被移动或删除。',
    };
  }

  return base;
}

function metaTag(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeHtml(content)}" />`;
}

function propertyTag(property: string, content: string): string {
  return `<meta property="${property}" content="${escapeHtml(content)}" />`;
}

/** Replace the title + `<!--seo-->` placeholder inside the app shell. */
export function injectSeo(html: string, seo: SeoMeta): string {
  const iconType =
    seo.favicon.startsWith('data:image/svg') || /\.svg(?:[?#]|$)/i.test(seo.favicon)
      ? ' type="image/svg+xml"'
      : '';
  const tags: string[] = [
    `<title>${escapeHtml(seo.title)}</title>`,
    `<link rel="icon" href="${escapeHtml(seo.favicon)}"${iconType} />`,
    metaTag('description', seo.description),
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}" />`,
    propertyTag('og:site_name', seo.siteName),
    propertyTag('og:type', seo.type),
    propertyTag('og:title', seo.title),
    propertyTag('og:description', seo.description),
    propertyTag('og:url', seo.canonical),
    propertyTag('og:locale', seo.locale.replace('-', '_')),
    metaTag('twitter:card', seo.image ? 'summary_large_image' : 'summary'),
    metaTag('twitter:title', seo.title),
    metaTag('twitter:description', seo.description),
  ];

  if (seo.image) {
    tags.push(propertyTag('og:image', seo.image), metaTag('twitter:image', seo.image));
  }
  if (seo.rssUrl) {
    tags.push(
      `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(seo.siteName)}" href="${escapeHtml(seo.rssUrl)}" />`,
    );
  }
  if (seo.noindex) {
    tags.push(metaTag('robots', 'noindex, nofollow'));
  }
  if (seo.type === 'article' && seo.publishedAt) {
    // Both timestamps come from the row, so a view-count bump can no longer
    // make an untouched article look freshly modified.
    tags.push(
      propertyTag('article:published_time', `${seo.publishedAt.replace(' ', 'T')}Z`),
    );
    if (seo.updatedAt) {
      tags.push(propertyTag('article:modified_time', `${seo.updatedAt.replace(' ', 'T')}Z`));
    }
  }
  if (seo.jsonLd) {
    tags.push(
      `<script type="application/ld+json">${JSON.stringify(seo.jsonLd).replace(/</g, '\\u003c')}</script>`,
    );
  }

  const block = tags.join('\n    ');
  // Drop the static defaults before injecting the resolved ones.
  const cleaned = html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<link\s+rel="icon"[^>]*>\s*/i, '')
    // index.html is authored with lang="zh-CN"; follow the configured locale.
    .replace(/(<html\b[^>]*\blang=")[^"]*(")/i, `$1${escapeHtml(seo.locale)}$2`);
  if (cleaned.includes('<!--seo-->')) {
    return cleaned.replace('<!--seo-->', block);
  }
  return cleaned.replace('</head>', `    ${block}\n  </head>`);
}

/** Id of the inline JSON payload the client hydrates from before first paint. */
export const BOOT_SETTINGS_ID = 'eb-boot-settings';

/**
 * Inline the resolved public settings as JSON so the client can render the real
 * site name/theme on its very first paint instead of flashing the defaults.
 * `<` is escaped so the payload can never close the surrounding `<script>`.
 */
export function injectBootSettings(html: string, settings: PublicSettings): string {
  const json = JSON.stringify(settings)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const tag = `<script id="${BOOT_SETTINGS_ID}" type="application/json">${json}</script>`;
  if (html.includes('<!--boot-->')) return html.replace('<!--boot-->', tag);
  return html.replace('</body>', `    ${tag}\n  </body>`);
}
