/**
 * Pure Markdown editing primitives for the admin editor.
 *
 * Every function takes the current value + selection and returns the next value
 * + next selection, so all editing behaviour is testable without a DOM. The
 * React component only wires these to a `<textarea>`.
 */

export interface EditResult {
  /** Next textarea value. */
  value: string;
  /** Next `selectionStart`. */
  start: number;
  /** Next `selectionEnd`. */
  end: number;
}

export type LinePrefixKind = 'bullet' | 'ordered' | 'task' | 'quote';

const TASK_RE = /^\s*[-*+]\s+\[[ xX]\]\s+/;
const BULLET_RE = /^\s*[-*+]\s+(?!\[[ xX]\])/;
const ORDERED_RE = /^\s*\d+\.\s+/;
const QUOTE_RE = /^\s*>\s?/;
const FENCE_RE = /^\s*```/;

const PATTERNS: Record<LinePrefixKind, RegExp> = {
  bullet: BULLET_RE,
  ordered: ORDERED_RE,
  task: TASK_RE,
  quote: QUOTE_RE,
};

function lineStartOf(value: string, pos: number): number {
  const idx = value.lastIndexOf('\n', Math.max(0, pos - 1));
  return idx === -1 ? 0 : idx + 1;
}

function lineEndOf(value: string, pos: number): number {
  const idx = value.indexOf('\n', pos);
  return idx === -1 ? value.length : idx;
}

/** Strip any block marker (list, task, quote, heading) from a line. */
function stripMarker(line: string): string {
  return line
    .replace(TASK_RE, '')
    .replace(BULLET_RE, '')
    .replace(ORDERED_RE, '')
    .replace(QUOTE_RE, '')
    .replace(/^\s*#{1,6}\s+/, '');
}

const INDENT = '  ';

/** Toggle `before`/`after` around the selection (bold, italic, code, …). */
export function toggleWrap(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string = before,
  placeholder = '',
): EditResult {
  const from = Math.max(0, start - before.length);
  const outer =
    value.slice(from, start) === before && value.slice(end, end + after.length) === after;
  if (outer) {
    const inner = value.slice(start, end);
    return {
      value: value.slice(0, from) + inner + value.slice(end + after.length),
      start: from,
      end: from + inner.length,
    };
  }

  const selected = value.slice(start, end);
  if (
    selected.length >= before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after)
  ) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }

  const text = selected || placeholder;
  const next = `${value.slice(0, start)}${before}${text}${after}${value.slice(end)}`;
  const innerStart = start + before.length;
  return { value: next, start: innerStart, end: innerStart + text.length };
}

/** Toggle a block marker on every line touched by the selection. */
export function toggleLinePrefix(
  value: string,
  start: number,
  end: number,
  kind: LinePrefixKind,
): EditResult {
  const from = lineStartOf(value, start);
  const to = lineEndOf(value, end);
  const lines = value.slice(from, to).split('\n');
  const hasContent = lines.some((line) => line.trim() !== '');
  const allMarked = lines.every((line) => line.trim() === '' || PATTERNS[kind].test(line));
  const remove = hasContent && allMarked;

  let counter = 0;
  const next = lines.map((line) => {
    // Blank lines never gain a marker, and lose theirs when toggling off.
    if (line.trim() === '') return line;
    const bare = stripMarker(line);
    if (remove) return bare;
    if (kind === 'ordered') {
      counter += 1;
      return `${counter}. ${bare}`;
    }
    if (kind === 'task') return `- [ ] ${bare}`;
    if (kind === 'bullet') return `- ${bare}`;
    return `> ${bare}`;
  });

  const block = next.join('\n');
  return { value: value.slice(0, from) + block + value.slice(to), start: from, end: from + block.length };
}

/** Set (or clear, with `level = 0`) the heading level of the touched lines. */
export function setHeading(value: string, start: number, end: number, level: number): EditResult {
  const from = lineStartOf(value, start);
  const to = lineEndOf(value, end);
  const lines = value.slice(from, to).split('\n');
  const detect = (line: string) => {
    const match = /^\s*(#{1,6})\s+/.exec(line);
    return match?.[1]?.length ?? 0;
  };
  const clear = level === 0 || lines.every((line) => line.trim() === '' || detect(line) === level);

  const block = lines
    .map((line) => {
      if (line.trim() === '') return line;
      const bare = line.replace(/^\s*#{1,6}\s+/, '');
      return clear ? bare : `${'#'.repeat(level)} ${bare}`;
    })
    .join('\n');

  return { value: value.slice(0, from) + block + value.slice(to), start: from, end: from + block.length };
}

/** Replace the selection with `text`, leaving the caret at the end. */
export function insertText(value: string, start: number, end: number, text: string): EditResult {
  const at = start + text.length;
  return { value: value.slice(0, start) + text + value.slice(end), start: at, end: at };
}

/**
 * Blank-line padding so an inserted block never merges with its neighbours
 * (a `---` glued under a paragraph would turn it into a setext heading).
 */
function blockSpan(value: string, start: number, end: number): { lead: string; tail: string } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return { lead, tail };
}

/** Insert a block-level snippet (table, code fence, rule) on its own lines. */
export function insertBlock(
  value: string,
  start: number,
  end: number,
  snippet: string,
  selectSnippet = true,
): EditResult {
  const { lead, tail } = blockSpan(value, start, end);
  const at = start + lead.length;
  const next = `${value.slice(0, start)}${lead}${snippet}${tail}${value.slice(end)}`;
  return selectSnippet
    ? { value: next, start: at, end: at + snippet.length }
    : { value: next, start: at + snippet.length, end: at + snippet.length };
}

/** `[text](https://)` with the URL pre-selected. */
export function insertLink(value: string, start: number, end: number): EditResult {
  const text = value.slice(start, end) || '链接文字';
  const url = 'https://';
  const snippet = `[${text}](${url})`;
  const next = value.slice(0, start) + snippet + value.slice(end);
  const urlStart = start + 1 + text.length + 2;
  return { value: next, start: urlStart, end: urlStart + url.length };
}

/** `![alt](url)` on its own block. */
export function insertImage(value: string, start: number, end: number, url: string, alt = '图片'): EditResult {
  const { lead, tail } = blockSpan(value, start, end);
  const snippet = `![${alt}](${url})`;
  const next = `${value.slice(0, start)}${lead}${snippet}${tail}${value.slice(end)}`;
  const at = start + lead.length + snippet.length;
  return { value: next, start: at, end: at };
}

/** `link` reference-style image markdown for an existing media item. */
export function imageMarkdown(url: string, name?: string | null): string {
  const alt = (name ?? '').replace(/\.[^./\\]+$/, '').trim() || '图片';
  return `![${alt}](${url})`;
}

/** GitHub-flavoured Markdown table. */
export function insertTable(value: string, start: number, end: number, cols = 3, rows = 3): EditResult {
  const header = `| ${Array.from({ length: cols }, (_, i) => `表头${i + 1}`).join(' | ')} |`;
  const divider = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
  const body = Array.from({ length: Math.max(1, rows) }, () =>
    `| ${Array.from({ length: cols }, () => '   ').join(' | ')} |`,
  );
  const snippet = [header, divider, ...body].join('\n');
  return insertBlock(value, start, end, snippet, true);
}

/** Fenced code block; the placeholder body is selected so typing replaces it. */
export function insertCodeBlock(value: string, start: number, end: number, lang = ''): EditResult {
  const selected = value.slice(start, end);
  const body = selected || 'code';
  const snippet = ['```' + lang, body, '```'].join('\n');
  const result = insertBlock(value, start, end, snippet, true);
  if (selected) return { ...result, start: result.end, end: result.end };
  const bodyStart = result.start + lang.length + 4;
  return { ...result, start: bodyStart, end: bodyStart + body.length };
}

/** Horizontal rule. */
export function insertRule(value: string, start: number, end: number): EditResult {
  return insertBlock(value, start, end, '---', false);
}

/**
 * Continue lists/quotes on Enter. Returns `null` when the default newline
 * should be kept (plain paragraph, empty item that should exit the list is
 * handled here too).
 */
export function smartEnter(value: string, start: number, end: number): EditResult | null {
  if (start !== end) return null;
  const from = lineStartOf(value, start);
  const line = value.slice(from, lineEndOf(value, start));

  const list = /^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
  if (list) {
    const [, indent = '', mark = '-', task] = list;
    const markerEnd = from + indent.length + mark.length + (task ? task.length + 1 : 1);
    if (value.slice(markerEnd, lineEndOf(value, start)).trim() === '') {
      return { value: value.slice(0, from) + value.slice(start), start: from, end: from };
    }
    const nextMark = /^\d+\.$/.test(mark) ? `${Number.parseInt(mark, 10) + 1}. ` : `${mark} `;
    const insert = `\n${indent}${nextMark}${task ?? ''}`;
    return insertText(value, start, end, insert);
  }

  const quote = /^(\s*>\s?)(.*)$/.exec(line);
  if (quote) {
    const marker = quote[1] ?? '> ';
    if ((quote[2] ?? '').trim() === '') {
      return { value: value.slice(0, from) + value.slice(start), start: from, end: from };
    }
    return insertText(value, start, end, `\n${marker}`);
  }

  return null;
}

/** Indent / outdent the touched lines (Tab / Shift+Tab). */
export function indentLines(value: string, start: number, end: number, outdent: boolean): EditResult {
  const from = lineStartOf(value, start);
  const to = lineEndOf(value, end);
  const lines = value.slice(from, to).split('\n');
  const block = lines
    .map((line) => {
      if (outdent) return line.replace(/^(?: {1,2}|\t)/, '');
      return line.trim() === '' ? line : `${INDENT}${line}`;
    })
    .join('\n');
  return { value: value.slice(0, from) + block + value.slice(to), start: from, end: from + block.length };
}

export interface LineContext {
  heading: number;
  list: LinePrefixKind | null;
  quote: boolean;
  fence: boolean;
}

/** Describe the block at `pos` so the toolbar can highlight active formats. */
export function lineContext(value: string, pos: number): LineContext {
  const line = value.slice(lineStartOf(value, pos), lineEndOf(value, pos));
  const heading = /^\s*(#{1,6})\s+/.exec(line)?.[1]?.length ?? 0;
  const list: LinePrefixKind | null = TASK_RE.test(line)
    ? 'task'
    : BULLET_RE.test(line)
      ? 'bullet'
      : ORDERED_RE.test(line)
        ? 'ordered'
        : null;
  return { heading, list, quote: QUOTE_RE.test(line), fence: FENCE_RE.test(line) };
}

/** True when the text around the caret is wrapped by `before`/`after`. */
export function isWrapped(value: string, start: number, end: number, before: string, after = before): boolean {
  const outer =
    value.slice(Math.max(0, start - before.length), start) === before &&
    value.slice(end, end + after.length) === after;
  if (outer) return true;
  const selected = value.slice(start, end);
  return (
    selected.length >= before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after)
  );
}

export interface EditorStats {
  chars: number;
  words: number;
  lines: number;
  minutes: number;
}

/** Character/word/line counts with a CJK-aware reading time estimate. */
export function editorStats(md: string): EditorStats {
  const text = (md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|]/g, ' ');

  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) ?? []).length;
  const words = cjk + latin;

  return {
    chars: (md ?? '').length,
    words,
    lines: md ? md.split('\n').length : 0,
    minutes: words === 0 ? 0 : Math.max(1, Math.round(cjk / 350 + latin / 220)),
  };
}
