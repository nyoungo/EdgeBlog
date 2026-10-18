import { useMemo } from 'react';
import { extractToc, renderMarkdownHighlighted } from '../../lib/markdown';

/** Renders trusted Markdown → sanitised, highlighted HTML. */
export function Prose({ markdown, className }: { markdown: string; className?: string }) {
  const html = useMemo(() => renderMarkdownHighlighted(markdown), [markdown]);
  return (
    <div
      className={className ? `prose-article ${className}` : 'prose-article'}
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
