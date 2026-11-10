/**
 * 搜索关键词的兜底修复。
 *
 * Workers AI 的工具调用参数偶发被上游截断,只保留中文关键词的第一个字
 * (例如「雷军」→「雷」)。把单字丢给搜索引擎只会得到完全无关的结果,
 * 因此关键词过短时回到用户的原始发言里找完整词组。
 */

const CJK = /[\u3400-\u9fff]/;

/** 常见中文指令前缀,只在兜底场景下剥离,避免误伤「查找算法」这类正常词。 */
const COMMAND_PREFIX =
  /^(?:帮我|帮忙|请|麻烦|给我|我想|我要|搜索一下|搜索|搜一下|搜下|搜|查询|查一下|查下|查找|查)\s*/;

const MAX_QUERY_CHARS = 100;
/** 以命中的字为锚点向左右扩展的最大字数。 */
const MAX_EXPAND_RIGHT = 12;
const MAX_EXPAND_LEFT = 6;

/**
 * 返回真正用于搜索的关键词。
 *
 * 长度 ≥ 2 时按原样使用;只有单个字时,从用户最近一条消息里取出包含该字的
 * 连续中文片段,并剥掉「帮我搜索」这类指令前缀。
 */
export function resolveSearchQuery(raw: string, lastUserMessage?: string): string {
  const query = raw.trim();
  if (query.length >= 2) return query.slice(0, MAX_QUERY_CHARS);
  if (!query) return '';

  const context = (lastUserMessage ?? '').trim();
  if (!context) return query;

  const index = context.indexOf(query);
  if (index < 0) return query;

  let start = index;
  while (start > 0 && index - start < MAX_EXPAND_LEFT && CJK.test(context[start - 1] ?? '')) start -= 1;

  let end = index + query.length;
  while (end < context.length && end - index < MAX_EXPAND_RIGHT && CJK.test(context[end] ?? '')) end += 1;

  // 反复剥离嵌套前缀(如「请帮我搜一下」),直到没有可剥离的指令词。
  let expanded = context.slice(start, end).trim();
  for (let i = 0; i < 4 && COMMAND_PREFIX.test(expanded); i += 1) {
    expanded = expanded.replace(COMMAND_PREFIX, '').trim();
  }

  return expanded.length >= 2 ? expanded.slice(0, MAX_QUERY_CHARS) : query;
}