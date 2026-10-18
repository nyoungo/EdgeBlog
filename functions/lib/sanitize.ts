/** Pure text helpers: slug generation, excerpt/meta derivation, word counting. */

/** Escape a string for safe interpolation into HTML. Used for server-rendered meta. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;

/** Count "words": each CJK char counts as one, latin runs count as one each. */
export function countWords(markdown: string): number {
  const plain = stripMarkdown(markdown);
  const cjk = plain.match(CJK)?.length ?? 0;
  const latin = plain.replace(CJK, ' ').match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

/** Strip Markdown syntax down to plain text (for excerpts, meta descriptions). */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s{0,3}>+\s?/gm, '') // blockquotes
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1') // emphasis
    .replace(/^\s*[-*+]\s+/gm, '') // list markers
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, ' ') // tables
    .replace(/\s+/g, ' ')
    .trim();
}

/** Take the first N characters of a plain-text string, on a word/sentence boundary. */
export function truncate(input: string, max = 160): string {
  const text = input.trim();
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('，'), slice.lastIndexOf('。'));
  return `${(cut > max * 0.5 ? slice.slice(0, cut) : slice).trim()}…`;
}

/** Build an excerpt from the body when the author left it blank. */
export function deriveExcerpt(markdown: string, max = 160): string {
  return truncate(stripMarkdown(markdown), max);
}

/**
 * URL slug. Unicode-aware: keeps CJK letters/numbers, lowercases latin,
 * collapses whitespace to single dashes, strips everything else.
 */
export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `item-${Date.now().toString(36)}`;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** Very small profanity/abuse heuristic hook — extend as needed. */
export function looksLikeSpam(content: string): boolean {
  const links = content.match(/https?:\/\//g)?.length ?? 0;
  if (links >= 4) return true;
  if (/(viagra|casino|xxx|免费.*)?$/i.test(content) && links >= 2) return true;
  return false;
}
