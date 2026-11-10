/**
 * 极简 HTML → 纯文本转换，供 AI 助手读取网页正文使用。
 *
 * 不做完整的 HTML 解析（Workers 运行时里没必要引入解析器）：
 * 去掉脚本/样式等不可见节点，优先取 <article>/<main> 的正文容器，
 * 把块级标签换算成换行，再解码常见实体并归一化空白。
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  times: '×',
  divide: '÷',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  sect: '§',
  para: '¶',
};

/** 解码常见的 HTML 实体（命名实体 + 十进制/十六进制数字实体）。 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (raw, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return raw;
      try {
        return String.fromCodePoint(code);
      } catch {
        return raw;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? raw;
  });
}

/**
 * 合并多余空白，去掉空行。
 *
 * HTML 源码里的缩进换行和块级标签追加的换行会叠在一起，保留空行反而让正文
 * 里到处是空行；块级结束标签已经保证每个段落各占一行，这里直接丢弃空行。
 */
function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v\u00a0 ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** 挑出正文容器：语义化标签优先，其次 <body>。 */
function pickContentContainer(html: string): string | null {
  for (const tag of ['article', 'main']) {
    const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    const inner = match?.[1];
    if (inner && inner.replace(/<[^>]+>/g, '').trim().length > 200) return inner;
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return body?.[1] ?? null;
}

export interface HtmlToTextResult {
  title: string;
  text: string;
  truncated: boolean;
}

/** 把 HTML 转成适合喂给模型的纯文本，并按 maxChars 截断。 */
export function htmlToText(html: string, options: { maxChars?: number } = {}): HtmlToTextResult {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]
    ? normalizeWhitespace(decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, ''))).replace(/\n+/g, ' ')
    : '';

  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|select|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  const container = pickContentContainer(stripped) ?? stripped;

  const withBreaks = container
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n')
    // 只给块级结束标签补换行；开始标签也补会在段落之间多出空行
    .replace(/<\/(p|div|section|article|main|header|footer|aside|nav|li|tr|h[1-6]|blockquote|pre|figure|figcaption|table|thead|tbody|dd|dt)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = normalizeWhitespace(decodeHtmlEntities(withBreaks));

  const max = Math.max(200, options.maxChars ?? 6000);
  const truncated = text.length > max;
  return { title, text: truncated ? text.slice(0, max) : text, truncated };
}
