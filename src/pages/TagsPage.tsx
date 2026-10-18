import { Link } from 'react-router-dom';
import type { Tag } from '@shared/types';
import { Badge } from '../components/ui/Badge';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { api } from '../lib/api';
import { useAsync, useDocumentTitle } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

export function TagsPage() {
  const { settings } = useSettings();
  const { data, loading } = useAsync(() => api.get<Tag[]>('/tags').then((r) => r.data), []);
  useDocumentTitle('标签', settings.site.name);

  return (
    <PageWithSidebar>
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-fg">
          <Icon name="tag" size={22} className="text-brand" />
          标签
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {data ? `共 ${data.length} 个标签` : '按主题浏览文章'}
        </p>
      </header>

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState icon="tag" title="还没有标签" description="为文章添加标签后，这里会显示标签云。" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((tag) => (
            <Link
              key={tag.id}
              to={`/posts?tag=${encodeURIComponent(tag.slug)}`}
              className="group flex items-center justify-between rounded-xl border border-border bg-surface p-5 no-underline transition-colors hover:border-brand"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Icon name="tag" size={17} />
                </span>
                <span className="truncate text-base font-medium text-fg group-hover:text-brand">{tag.name}</span>
              </div>
              <Badge tone="neutral">{tag.post_count} 篇</Badge>
            </Link>
          ))}
        </div>
      )}
    </PageWithSidebar>
  );
}
