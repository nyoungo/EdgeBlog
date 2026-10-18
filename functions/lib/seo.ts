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
import { getPostBySlug } from './posts-repo';
import { getSettings } from './settings';

export interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  image?: string | null;
  type: 'website' | 'article';
  siteName: string;
  locale: string;
  publishedAt?: string | null;
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
  '/tags': '标签',
  '/archive': '归档',
  '/search': '搜索',
};

/** Resolve the metadata for a given request URL. */
export async function buildSeo(env: Env, url: URL): Promise<SeoMeta> {
  const settings = await getSettings(env);
  const siteName = settings.site.name;
  const origin = (env.SITE_URL || url.origin).replace(/\/+$/, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const canonical = `${origin}${path === '/' ? '/' : path}`;
  const locale = settings.site.locale || 'zh-CN';

  const base: SeoMeta = {
    title: siteName,
    description: settings.site.description,
    canonical,
    type: 'website',
    siteName,
    locale,
  };

  const postMatch = path.match(/^\/posts\/([^/]+)$/);
  if (postMatch?.[1]) {
    let slug = postMatch[1];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      /* keep raw */
    }
    const post = await getPostBySlug(env, slug);
    if (post) {
      const title = post.meta_title || post.title;
      const description = post.meta_description || post.excerpt || settings.site.description;
      const image = absoluteUrl(post.og_image || post.cover_url, origin);
      return {
        ...base,
        title: `${title} · ${siteName}`,
        description,
        image,
        type: 'article',
        publishedAt: post.published_at,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: title,
          description,
          ...(image ? { image } : {}),
          ...(post.published_at ? { datePublished: `${post.published_at.replace(' ', 'T')}Z` } : {}),
          dateModified: `${post.updated_at.replace(' ', 'T')}Z`,
          mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
          author: { '@type': 'Person', name: settings.site.name },
          publisher: { '@type': 'Organization', name: siteName },
          wordCount: post.word_count,
        },
      };
    }
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

  const label = TITLES[path];
  if (label) return { ...base, title: `${label} · ${siteName}` };

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
  const tags: string[] = [
    `<title>${escapeHtml(seo.title)}</title>`,
    metaTag('description', seo.description),
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}" />`,
    propertyTag('og:site_name', seo.siteName),
    propertyTag('og:type', seo.type),
    propertyTag('og:title', seo.title),
    propertyTag('og:description', seo.description),
    propertyTag('og:url', seo.canonical),
    metaTag('twitter:card', seo.image ? 'summary_large_image' : 'summary'),
    metaTag('twitter:title', seo.title),
    metaTag('twitter:description', seo.description),
  ];

  if (seo.image) {
    tags.push(propertyTag('og:image', seo.image), metaTag('twitter:image', seo.image));
  }
  if (seo.type === 'article' && seo.publishedAt) {
    tags.push(
      propertyTag('article:published_time', `${seo.publishedAt.replace(' ', 'T')}Z`),
      propertyTag('article:modified_time', new Date().toISOString()),
    );
  }
  if (seo.jsonLd) {
    tags.push(
      `<script type="application/ld+json">${JSON.stringify(seo.jsonLd).replace(/</g, '\\u003c')}</script>`,
    );
  }

  const block = tags.join('\n    ');
  const withoutTitle = html.replace(/<title>[\s\S]*?<\/title>/i, '');
  if (withoutTitle.includes('<!--seo-->')) {
    return withoutTitle.replace('<!--seo-->', block);
  }
  return withoutTitle.replace('</head>', `    ${block}\n  </head>`);
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
