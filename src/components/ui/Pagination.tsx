import { cn } from '../../lib/utils';
import { Icon } from './icons';

export function Pagination({
  page,
  totalPages,
  onChange,
  className,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  const pages: Array<number | '…'> = [];
  const push = (n: number | '…') => pages.push(n);
  const window = 1;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - window && i <= page + window)) {
      push(i);
    } else if (pages[pages.length - 1] !== '…') {
      push('…');
    }
  }

  const base = 'inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm transition-colors';

  return (
    <nav className={cn('flex items-center justify-center gap-1', className)} aria-label="分页">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className={cn(base, 'text-muted hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40')}
        aria-label="上一页"
      >
        <Icon name="chevronLeft" size={18} />
      </button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-faint">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(
              base,
              p === page ? 'bg-brand text-brand-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className={cn(base, 'text-muted hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40')}
        aria-label="下一页"
      >
        <Icon name="chevronRight" size={18} />
      </button>
    </nav>
  );
}
