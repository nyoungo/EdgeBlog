/**
 * 搜索结果的相关性校验。
 *
 * 搜索通道（Monid / Cloudflare）把网页标题、摘要和链接拼成 SearchResult；
 * 这里用查询里的显著词判断结果是否真的与关键词有关，避免把「雷军 → 雷」这类
 * 被上游截断或替换成热门内容的垃圾结果交给模型。
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 太泛的词不能用来判断相关性，否则垃圾结果也能命中。 */
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

/** 查询词里可用于判断结果相关性的「显著词」。 */
function significantTokens(query: string): string[] {
  const tokens = new Set<string>();

  for (const run of query.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    // 全部是泛词的片段不能用来判断相关性，直接跳过
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
    // 纯数字（年份、版本号）太容易误命中，不参与判断
    if (!/^\d+$/.test(run)) tokens.add(run.toLowerCase());
  }

  return [...tokens];
}

/**
 * 判断搜索结果是否与关键词沾边。
 *
 * 搜索引擎从数据中心 IP 访问时，偶尔会把结果页换成与查询无关的「热门」内容，
 * 甚至把中文关键词截成首字后再搜（如「雷军」→「雷」）。这类结果标题/摘要/链接里
 * 都找不到关键词，应当判为失败并走下一级通道，而不是把垃圾结果交给模型。
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
