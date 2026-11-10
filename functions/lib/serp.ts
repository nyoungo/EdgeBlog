/**
 * Bing 搜索结果解析(无 Key 方案)。
 *
 * 官方 Bing Search API 已于 2025-08-11 下线,这里退而解析 bing.com/search 的
 * 服务端渲染结果。优先使用 `format=rss` 的结构化输出,失败时再回退到
 * `li.b_algo` 的 HTML 解析。解析器只做结构化提取,页面结构变化时会返回
 * 空数组,由调用方决定是否走兜底通道。
 */
import { decodeHtmlEntities } from './html-to-text';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 内联文本:去标签、解实体、压空白。 */
function toPlainText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/[\t\f\v\u00a0 ]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    // 行内标签会被替换成空格,顺手把标点前的多余空格收紧
    .replace(/\s+([,.;:!?\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f])/g, '$1')
    .trim();
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit) || 10, 1), 10);
}

/** 构造搜索结果页地址(count 上限 10,与 Bing 页面一致)。 */
export function bingSearchUrl(query: string, limit: number): string {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(clampLimit(limit)));
  url.searchParams.set('setlang', 'zh-Hans');
  url.searchParams.set('mkt', 'zh-CN');
  return url.toString();
}

/**
 * 构造 Bing 的 RSS 搜索结果地址。
 *
 * HTML 结果页里混有广告、推荐和 A/B 模块,从数据中心 IP 访问时容易拿到与
 * 关键词无关的「热门」链接;RSS 输出只包含按关键词排序的条目,解析更稳定。
 */
export function bingSearchRssUrl(query: string, limit: number): string {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'rss');
  url.searchParams.set('count', String(clampLimit(limit)));
  url.searchParams.set('setlang', 'zh-Hans');
  url.searchParams.set('mkt', 'zh-CN');
  return url.toString();
}

/** Bing 的反爬页会带验证码/人机校验文案,命中后应当直接判为失败。 */
export function looksLikeBingChallenge(html: string): boolean {
  return /captcha|verify (?:that )?you are (?:a )?human|人机验证|验证码/i.test(html.slice(0, 20_000));
}

/**
 * Bing 会把外链包成 bing.com/ck/a?u=a1<base64url>,这里还原真实地址。
 * 无法还原时返回空串,调用方直接跳过该条。
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
  const max = clampLimit(limit);
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

/** 读取 RSS 中某个标签的原始内容(去掉 CDATA 包裹,保留实体待后续统一解码)。 */
function readRssTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match?.[1]) return '';
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** 解析 Bing 的 RSS 结果(format=rss),条目链接已是真实地址。 */
export function parseBingRss(xml: string, limit = 10): SearchResult[] {
  const max = clampLimit(limit);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  for (const item of items) {
    const rawLink = decodeHtmlEntities(readRssTag(item, 'link')).trim();
    if (!rawLink) continue;

    let url: URL;
    try {
      url = new URL(rawLink);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    const normalized = url.toString();
    if (seen.has(normalized)) continue;

    const title = toPlainText(readRssTag(item, 'title'));
    if (!title) continue;

    seen.add(normalized);
    results.push({
      title,
      url: normalized,
      snippet: toPlainText(readRssTag(item, 'description')),
    });
    if (results.length >= max) break;
  }

  return results;
}

/** 查询词里可用于判断结果相关性的「显著词」。 */
/** 太泛的词不能用来判断相关性,否则垃圾结果也能命中。 */
const GENERIC_TOKENS = new Set([
  '最新',
  '动态',
  '消息',
  '新闻',
  '相关',
  '推荐',
  '官网',
  '下载',
  '图片',
  '视频',
  '介绍',
  '资料',
  '情况',
  '最近',
  '今天',
  '今年',
  '目前',
  '现在',
  '如何',
  '什么',
  '怎么',
  '为什么',
  '多少',
  '一下',
  '关于',
  '查询',
  '搜索',
  '信息',
  '内容',
  '文章',
  '链接',
  '网站',
  '最新动态',
  '最新消息',
  '最新进展',
  '最新情况',
]);

function significantTokens(query: string): string[] {
  const tokens = new Set<string>();

  for (const run of query.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    // 全部是泛词的片段不能用来判断相关性,直接跳过
    if (GENERIC_TOKENS.has(run)) continue;
    tokens.add(run);
    if (run.length >= 3) {
      for (let i = 0; i + 2 <= run.length; i += 1) {
        const gram = run.slice(i, i + 2);
        if (!GENERIC_TOKENS.has(gram)) tokens.add(gram);
      }
    }
  }
  for (const run of query.match(/[a-z0-9]{3,}/gi) ?? []) {
    // 纯数字(年份、版本号)太容易误命中,不参与判断
    if (!/^\d+$/.test(run)) tokens.add(run.toLowerCase());
  }

  return [...tokens];
}

/**
 * 判断搜索结果是否与关键词沾边。
 *
 * Bing 从数据中心 IP 访问时,偶尔会把结果页换成与查询无关的「热门」内容,
 * 甚至把中文关键词截成首字后再搜(如「雷军」→「雷」)。这类结果标题/摘要/链接里
 * 都找不到关键词,应当判为失败并走兜底通道,而不是把垃圾结果交给模型。
 */
export function resultsLookRelevant(query: string, results: SearchResult[]): boolean {
  if (results.length === 0) return false;
  const tokens = significantTokens(query);
  if (tokens.length === 0) return true;

  const haystack = results
    .map((result) => `${result.title}\n${result.snippet}\n${result.url}`)
    .join('\n')
    .toLowerCase();
  return tokens.some((token) => haystack.includes(token.toLowerCase()));
}
