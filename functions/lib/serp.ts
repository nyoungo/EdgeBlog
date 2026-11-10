/**
 * Bing 搜索结果页解析（无 Key 方案）。
 *
 * 官方 Bing Search API 已于 2025-08-11 下线，这里退而解析 bing.com/search 的
 * 服务端渲染结果（`li.b_algo`）。解析器只做结构化提取，页面结构变化时会返回
 * 空数组，由调用方决定是否走兜底通道。
 */
import { decodeHtmlEntities } from './html-to-text';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 内联文本：去标签、解实体、压空白。 */
function toPlainText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/[\t\f\v\u00a0 ]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/** 构造搜索结果页地址（count 上限 10，与 Bing 页面一致）。 */
export function bingSearchUrl(query: string, limit: number): string {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(Math.max(Math.trunc(limit) || 10, 1), 10)));
  url.searchParams.set('setlang', 'zh-Hans');
  url.searchParams.set('mkt', 'zh-CN');
  return url.toString();
}

/** Bing 的反爬页会带验证码/人机校验文案，命中后应当直接判为失败。 */
export function looksLikeBingChallenge(html: string): boolean {
  return /captcha|verify (?:that )?you are (?:a )?human|人机验证|验证码/i.test(html.slice(0, 20_000));
}

/**
 * Bing 会把外链包成 bing.com/ck/a?u=a1<base64url>，这里还原真实地址。
 * 无法还原时返回空串，调用方直接跳过该条。
 */
export function unwrapBingUrl(href: string): string {
  const cleaned = decodeHtmlEntities(href.trim()).replace(/&amp;/g, '&');
  if (!cleaned) return '';
  let url: URL;
  try {
    url = new URL(cleaned, 'https://www.bing.com');
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

  const host = url.hostname.toLowerCase();
  if ((host === 'www.bing.com' || host === 'bing.com') && url.pathname.startsWith('/ck/a')) {
    const raw = url.searchParams.get('u') ?? '';
    if (raw.startsWith('a1')) {
      const base64 = raw.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      try {
        const decoded = atob(padded);
        const target = new URL(decoded);
        if (target.protocol === 'http:' || target.protocol === 'https:') return target.toString();
      } catch {
        return '';
      }
    }
    return '';
  }

  // 跳过 Bing 自家的站内链接
  if (/^(?:www\.)?bing\.com$/i.test(host) && !/^\/search$/i.test(url.pathname)) return '';
  return url.toString();
}

/** 从 Bing 结果页 HTML 中提取标题、链接与摘要。 */
export function parseBingResults(html: string, limit = 10): SearchResult[] {
  const max = Math.min(Math.max(Math.trunc(limit) || 10, 1), 10);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link?.[1] || !link[2]) continue;

    const url = unwrapBingUrl(link[1]);
    const title = toPlainText(link[2]);
    if (!url || !title || seen.has(url)) continue;

    const snippetMatch =
      block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ??
      block.match(/<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) ??
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);

    seen.add(url);
    results.push({
      title,
      url,
      snippet: snippetMatch?.[1] ? toPlainText(snippetMatch[1]) : '',
    });
    if (results.length >= max) break;
  }

  return results;
}
