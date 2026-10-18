import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import type { PostSummary } from '@shared/types';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { api, qs } from '../lib/api';
import { formatDateShort } from '../lib/format';
import { useAsync, useDocumentTitle } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

export function ArchivePage() {
  const { settings } = useSettings();
  const { data, loading } = useAsync(
    () => api.get<PostSummary[]>(`/posts${qs({ perPage: 50, sort: 'newest' })}`).then((r) => r.data),
    [],
  );
  useDocumentTitle('归档', settings.site.name);

  const groups = useMemo(() => {
    const map = new Map<string, PostSummary[]>();
    for (const post of data ?? []) {
      const year = (post.published_at ?? post.created_at ?? '').slice(0, 4) || '未知';
      const list = map.get(year) ?? [];
      list.push(post);
      map.set(year, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  const total = data?.length ?? 0;

  return (
    <PageWithSidebar>
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-fg">
          <Icon name="calendar" size={22} className="text-brand" />
          归档
        </h1>
        <p className="mt-1.5 text-sm text-muted">{total > 0 ? `共 ${total} 篇文章` : '按时间浏览全部文章'}</p>
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
        <div className="space-y-10">
          {groups.map(([year, posts]) => (
            <section key={year}>
              <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold text-fg">
                {year}
                <span className="text-sm font-normal text-faint">{posts.length} 篇</span>
                <span className="h-px flex-1 bg-border" />
              </h2>
              <ul className="space-y-1">
                {posts.map((post) => (
                  <li key={post.id}>
                    <Link
                      to={`/posts/${post.slug}`}
                      className="flex items-baseline gap-3 rounded-md px-2 py-2 no-underline transition-colors hover:bg-surface-2"
                    >
                      <time className="shrink-0 font-mono text-xs text-faint">
                        {formatDateShort(post.published_at ?? post.created_at).slice(5)}
                      </time>
                      <span className="text-sm font-medium text-fg hover:text-brand">{post.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PageWithSidebar>
  );
}
