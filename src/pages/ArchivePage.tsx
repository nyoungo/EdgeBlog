import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArchiveEntry } from '@shared/types';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { api } from '../lib/api';
import { formatDateShort } from '../lib/format';
import { useAsync, useDocumentTitle } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';
import { cn } from '../lib/utils';

export function ArchivePage() {
  const { settings } = useSettings();
  // The archive used to paginate `/posts`, so it silently dropped everything
  // past the first 50 articles. This endpoint returns every published post in
  // a few tiny columns.
  const { data, loading } = useAsync(
    () => api.get<ArchiveEntry[]>('/posts/archive').then((r) => r.data),
    [],
  );
  useDocumentTitle('归档', settings.site.name);

  const groups = useMemo(() => {
    const map = new Map<string, ArchiveEntry[]>();
    for (const post of data ?? []) {
      const year = (post.published_at ?? post.created_at ?? '').slice(0, 4) || '未知';
      const list = map.get(year) ?? [];
      list.push(post);
      map.set(year, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  // Lazy years: start with the newest year expanded and render the rest only
  // once the reader opens them. Keeps a ten-year archive from mounting
  // hundreds of rows up front.
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || groups.length === 0) return;
    initialized.current = true;
    setOpenYears(new Set([groups[0]?.[0] ?? '']));
  }, [groups]);

  const toggleYear = (year: string) => {
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  const allOpen = groups.length > 0 && groups.every(([year]) => openYears.has(year));
  const toggleAll = () => {
    setOpenYears(allOpen ? new Set() : new Set(groups.map(([year]) => year)));
  };

  const total = data?.length ?? 0;

  return (
    <PageWithSidebar>
      <header className="mb-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="eb-kicker">时间线</span>
          <h1 className="mt-3 font-heading text-3xl tracking-tight text-fg sm:text-4xl">归档</h1>
          <p className="mt-2 text-xs text-faint">
            {total > 0 ? `${total} 篇` : '按时间浏览全部文章'}
          </p>
        </div>
        {groups.length > 1 && (
          <button
            type="button"
            onClick={toggleAll}
            className="eb-kicker transition-colors hover:text-brand"
          >
            {allOpen ? '全部收起' : '全部展开'}
          </button>
        )}
      </header>

      {loading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon="calendar" title="还没有文章" />
      ) : (
        <div className="space-y-6">
          {groups.map(([year, posts]) => {
            const open = openYears.has(year);
            return (
              <section key={year} className="rounded-2xl bg-surface p-5 shadow-card">
                <button
                  type="button"
                  onClick={() => toggleYear(year)}
                  aria-expanded={open}
                  className="group flex w-full items-center gap-3 py-1 text-left"
                >
                  <Icon
                    name="chevronRight"
                    size={16}
                    className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')}
                  />
                  <span className="font-heading text-xl text-fg">{year}</span>
                  <span className="eb-index-num flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-2 px-1.5">
                    {posts.length}
                  </span>
                </button>
                {open && (
                  <ul className="mt-3 space-y-0.5">
                    {posts.map((post) => (
                      <li key={post.slug}>
                        <Link
                          to={`/posts/${encodeURIComponent(post.slug)}`}
                          className="eb-index-row group flex items-baseline gap-3 rounded-xl px-2 py-2 no-underline transition-colors hover:bg-surface-2"
                        >
                          <time className="shrink-0 text-xs tabular-nums text-faint">
                            {formatDateShort(post.published_at ?? post.created_at).slice(5)}
                          </time>
                          <span className="text-sm font-medium text-fg transition-colors group-hover:text-brand">
                            {post.title}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </PageWithSidebar>
  );
}