import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked, type Tokens } from 'marked';

/**
 * The ONE place where Markdown becomes HTML. Rendered output is always passed
 * through DOMPurify before it reaches `dangerouslySetInnerHTML`.
 *
 * Runs client-side only: Workers have no DOM, so the server never renders
 * article bodies (it only injects meta tags into the HTML shell — see
 * functions/lib/seo.ts).
 */

marked.setOptions({ gfm: true, breaks: false });

const ALLOWED_TAGS = [
  'a', 'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'span',
  'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'sup', 'sub', 'kbd', 'mark',
];

const ALLOWED_ATTR = ['href', 'title', 'alt', 'src', 'class', 'id', 'target', 'rel', 'colspan', 'rowspan', 'loading'];

function slugifyHeading(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

const renderer = {
  heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Heading): string {
    const text = this.parser.parseInline(token.tokens);
    const id = slugifyHeading(token.text);
    return `<h${token.depth} id="${id}">${text}</h${token.depth}>\n`;
  },
  link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link): string {
    const text = this.parser.parseInline(token.tokens);
    const external = /^https?:\/\//i.test(token.href);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer nofollow"' : '';
    const title = token.title ? ` title="${token.title}"` : '';
    return `<a href="${token.href}"${title}${attrs}>${text}</a>`;
  },
  image(token: Tokens.Image): string {
    const title = token.title ? ` title="${token.title}"` : '';
    return `<img src="${token.href}" alt="${token.text}"${title} loading="lazy" decoding="async" />`;
  },
};

marked.use({ renderer: renderer as never });

/** Render Markdown to sanitised HTML (safe for innerHTML). */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md ?? '', { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ['target', 'rel', 'loading'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  });
}

/** Render + syntax-highlight, returning final safe HTML. Call from a `useMemo`. */
export function renderMarkdownHighlighted(md: string): string {
  const html = renderMarkdown(md);
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll<HTMLElement>('pre code').forEach((block) => {
    try {
      hljs.highlightElement(block);
    } catch {
      /* unknown language — leave as-is */
    }
  });
  return container.innerHTML;
}

export interface TocEntry {
  id: string;
  text: string;
  depth: number;
}

/** Extract a table of contents from rendered HTML. */
export function extractToc(html: string): TocEntry[] {
  const container = document.createElement('div');
  container.innerHTML = html;
  return Array.from(container.querySelectorAll<HTMLElement>('h2[id], h3[id]')).map((el) => ({
    id: el.id,
    text: el.textContent ?? '',
    depth: el.tagName === 'H2' ? 2 : 3,
  }));
}

/** Plain-text excerpt derived from Markdown (fallback when no excerpt set). */
export function markdownToPlainText(md: string, max = 160): string {
  const text = (md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
