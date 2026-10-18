import { useEffect, useState } from 'react';
import type { TocEntry } from '../../lib/markdown';
import { cn } from '../../lib/utils';

export function TableOfContents({ entries, className }: { entries: TocEntry[]; className?: string }) {
  const [active, setActive] = useState<string>(entries[0]?.id ?? '');

  useEffect(() => {
    if (entries.length === 0) return;
    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((r) => r.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    entries.forEach((entry) => {
      const el = document.getElementById(entry.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [entries]);

  if (entries.length < 2) return null;

  return (
    <nav className={cn('text-sm', className)} aria-label="目录">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">目录</p>
      <ul className="space-y-1.5 border-l border-border">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                history.replaceState(null, '', `#${entry.id}`);
              }}
              className={cn(
                '-ml-px block border-l-2 py-0.5 pl-3 no-underline transition-colors',
                entry.depth === 3 && 'pl-6',
                active === entry.id
                  ? 'border-brand text-brand'
                  : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
