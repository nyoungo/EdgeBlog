import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { ApiMeta, Column, PostSummary } from '@shared/types';
import { ApiError, api, qs } from '../lib/api';
import { formatDateShort } from '../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { Pagination } from '../components/ui/Pagination';
import { PostCollection } from '../components/blog/PostListItem';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { useAsync, useDocumentTitle } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

/**
 * 专栏主页：只展示该栏文章，与博客列表完全隔离（后端按 column 过滤）。
 */
export function ColumnDetailPage() {
  const { slug = '' } = useParams();
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1) || 1;
  const perPage = settings.layout.postsPerPage;

  const column = useAsync(async () => {
    try {
      return await api.get<Column>(`/columns/${encodeURIComponent(slug)}`).then((r) => r.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }, [slug]);

  const posts = useAsync(async () => {
    if (!slug) return null;
    return api.get<PostSummary[]>(`/posts${qs({ page, perPage, column: slug })}`);
  }, [slug, page, perPage]);

  // useAsync 的 data 起始为 null，404 时也是 null，所以用 loading 区分「还在查」。
  const detail = column.data;
  useDocumentTitle(detail?.name ?? '专栏', settings.site.name);

  const items = posts.data?.data ?? [];
  const meta: ApiMeta = posts.data?.meta ?? {};
  const offset = ((meta.page ?? page) - 1) * perPage;

  if (column.error) {
    return (
      <div className="container-page py-24">
        <ErrorState className="mx-auto max-w-lg" description={column.error} onRetry={column.reload} />
      </div>
    );
  }

  if (column.loading) {
    return (
      <div className="container-page py-12">
        <Skeleton className="h-8 w-48" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-4 w-full max-w-lg" />
          <Skeleton className="h-4 w-2/3 max-w-sm" />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="container-page flex flex-col items-center py-32 text-center">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-faint">
          <Icon name="columns" size={26} />
        </span>
        <h1 className="text-2xl font-bold text-fg">专栏不存在</h1>
        <p className="mt-2 text-sm text-muted">这个专栏可能已被删除，或者没有公开。</p>
        <Link to="/columns" className="mt-6 text-sm font-medium text-brand hover:underline">
          查看全部专栏
        </Link>
      </div>
    );
  }

  const main = (
    <>
      <header className="mb-10">
        {detail.cover_url && (
          <div className="mb-6 aspect-[21/9] w-full overflow-hidden rounded-2xl bg-surface-2 shadow-card">
            <img
              src={detail.cover_url}
              alt=""
              fetchPriority="high"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>
        )}
        <nav className="mb-4 flex items-center gap-1.5 text-xs text-faint">
          <Link to="/columns" className="no-underline transition-colors hover:text-fg">
            专栏
          </Link>
          <Icon name="chevronRight" size={12} />
          <span className="truncate text-muted">{detail.name}</span>
        </nav>
        <span className="eb-kicker">专栏</span>
        <h1 className="mt-3 font-heading text-3xl tracking-tight text-fg sm:text-4xl">{detail.name}</h1>
        {detail.description && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{detail.description}</p>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
          <span>{meta.total != null ? `${meta.total} 篇` : '本栏文章'}</span>
          {detail.updated_at && <span>更新于 {formatDateShort(detail.updated_at)}</span>}
        </p>
      </header>

      {posts.error ? (
        <ErrorState description={posts.error} onRetry={posts.reload} />
      ) : posts.loading && !posts.data ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon="fileText" title="这个专栏还没有文章" description="稍后再来看看。" />
      ) : (
        <>
          <PostCollection posts={items} offset={offset} />
          <Pagination
            className="mt-12"
            page={meta.page ?? 1}
            totalPages={meta.totalPages ?? 1}
            onChange={(next) => {
              const query = new URLSearchParams(params);
              if (next <= 1) query.delete('page');
              else query.set('page', String(next));
              setParams(query, { replace: true });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </>
      )}
    </>
  );

  return <PageWithSidebar>{main}</PageWithSidebar>;
}
