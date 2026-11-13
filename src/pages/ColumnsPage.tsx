import { Link } from 'react-router-dom';
import type { ColumnSummary } from '@shared/types';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { api } from '../lib/api';
import { formatDateShort } from '../lib/format';
import { useAsync, useDocumentTitle } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

/**
 * 专栏总览：每栏一张卡片，展示封面、简介与该栏最新 5 篇。
 * 首页正文不放专栏模块，这个页面是访客进入专栏内容的唯一入口（另加侧栏卡片）。
 */
export function ColumnsPage() {
  const { settings } = useSettings();
  const vt = settings.features.viewTransitions;
  useDocumentTitle('专栏', settings.site.name);

  const { data, error, loading, reload } = useAsync(
    () => api.get<ColumnSummary[]>('/columns').then((r) => r.data),
    [],
  );

  const columns = data ?? [];

  return (
    <PageWithSidebar>
      <header className="mb-10">
        <span className="eb-kicker">专题</span>
        <h1 className="mt-3 font-heading text-3xl tracking-tight text-fg sm:text-4xl">专栏</h1>
        <p className="mt-2 text-xs text-faint">
          {data ? `${columns.length} 个专栏` : '按主题长期更新的系列'}
        </p>
      </header>

      {error ? (
        <ErrorState description={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="grid gap-5 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : columns.length === 0 ? (
        <EmptyState
          icon="columns"
          title="还没有专栏"
          description="在后台「专栏管理」里创建专栏后，这里会显示每个专栏的入口。"
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {columns.map((column) => (
            <article
              key={column.id}
              className="group flex flex-col overflow-hidden rounded-2xl bg-surface shadow-card transition-shadow hover:shadow-lift"
            >
              <Link
                to={`/columns/${column.slug}`}
                viewTransition={vt}
                className="block no-underline"
                aria-label={`进入专栏「${column.name}」`}
              >
                {column.cover_url ? (
                  <img
                    src={column.cover_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-[16/9] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex aspect-[16/9] w-full items-center justify-center bg-gradient-to-br from-surface-2 to-surface text-faint">
                    <Icon name="columns" size={30} />
                  </div>
                )}
                <div className="px-5 pt-4">
                  <h2 className="font-heading text-xl leading-snug tracking-tight text-fg transition-colors group-hover:text-brand">
                    {column.name}
                  </h2>
                  {column.description && (
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">
                      {column.description}
                    </p>
                  )}
                </div>
              </Link>

              <div className="flex min-h-0 flex-1 flex-col px-5 pb-5">
                <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                  <span>{column.post_count} 篇</span>
                  {column.last_published_at && (
                    <span>更新于 {formatDateShort(column.last_published_at)}</span>
                  )}
                </p>

                {column.latest.length > 0 && (
                  <ol className="mt-3 space-y-1.5 border-t border-border pt-3">
                    {column.latest.map((post) => (
                      <li key={post.id} className="min-w-0">
                        <Link
                          to={`/posts/${post.slug}`}
                          viewTransition={vt}
                          className="block truncate text-sm text-muted no-underline transition-colors hover:text-brand"
                        >
                          {post.title}
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </PageWithSidebar>
  );
}
