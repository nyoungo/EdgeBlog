import { useMemo, type MouseEvent } from 'react';
import { COPY_BUTTON_SELECTOR, extractToc, renderMarkdownHighlighted } from '../../lib/markdown';

/**
 * Last-resort copy path: the async Clipboard API is unavailable in insecure
 * contexts and can be blocked by permissions, so fall back to a hidden textarea.
 */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Copy the code block that owns `button`, with inline feedback. */
async function copyCode(button: HTMLElement) {
  const code = button.parentElement?.querySelector('code')?.textContent ?? '';
  if (!code) return;

  let ok = false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(code);
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) ok = legacyCopy(code);

  button.textContent = ok ? '已复制' : '复制失败';
  window.setTimeout(() => {
    button.textContent = '复制';
  }, 1500);
}

/**
 * Renders trusted Markdown → sanitised, highlighted HTML.
 *
 * Pass `html` when the caller already rendered it (e.g. a page that also needs
 * the heading list for a TOC) so the document is not parsed twice.
 */
export function Prose({
  markdown,
  html: preRendered,
  className,
}: {
  markdown: string;
  html?: string;
  className?: string;
}) {
  const html = useMemo(() => preRendered ?? renderMarkdownHighlighted(markdown), [preRendered, markdown]);

  // Event delegation: the copy buttons live inside sanitised HTML, so they are
  // wired through one handler instead of React nodes.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>(COPY_BUTTON_SELECTOR);
    if (button && e.currentTarget.contains(button)) void copyCode(button);
  };

  return (
    <div
      className={className ? `prose-article ${className}` : 'prose-article'}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Extracts headings from Markdown for a table of contents / read-time cost. */
export function useMarkdownToc(markdown: string) {
  return useMemo(() => {
    const html = renderMarkdownHighlighted(markdown);
    return { html, toc: extractToc(html) };
  }, [markdown]);
}
