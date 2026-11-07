import { Link } from 'react-router-dom';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { fetchTags } from '../lib/resource';
import { useAsync, useDocumentTitle } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

export function TagsPage() {
  const { settings } = useSettings();
  const { data, loading } = useAsync(() => fetchTags(), []);
  useDocumentTitle('标签', settings.site.name);

  return (
    <PageWithSidebar>
      <header className="mb-10">
        <span className="eb-kicker">分类</span>
        <h1 className="mt-3 font-heading text-3xl tracking-tight text-fg sm:text-4xl">标签</h1>
        <p className="mt-2 text-xs text-faint">
          {data ? `${data.length} 个标签` : '按主题浏览文章'}
        </p>
      </header>

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState icon="tag" title="还没有标签" description="为文章添加标签后，这里会显示标签索引。" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((tag) => (
            <Link
              key={tag.id}
              to={`/posts?tag=${encodeURIComponent(tag.slug)}`}
              className="group flex items-center justify-between gap-4 rounded-2xl bg-surface px-5 py-4 no-underline shadow-card transition-shadow hover:shadow-lift"
            >
              <span className="font-medium text-fg transition-colors group-hover:text-brand">
                {tag.name}
              </span>
              <span className="eb-index-num rounded-full bg-surface-2 px-2.5 py-1">{tag.post_count}</span>
            </Link>
          ))}
        </div>
      )}
    </PageWithSidebar>
  );
}
