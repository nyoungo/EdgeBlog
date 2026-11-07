import { useSearchParams } from 'react-router-dom';
import type { ApiMeta, PostSummary } from '@shared/types';
import { Select } from '../components/ui/Field';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { Pagination } from '../components/ui/Pagination';
import { PostCollection } from '../components/blog/PostListItem';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { api, qs } from '../lib/api';
import { fetchTags } from '../lib/resource';
import { cn } from '../lib/utils';
import { useAsync, useDocumentTitle } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

const SORTS = [
  { value: 'newest', label: '最新优先' },
  { value: 'oldest', label: '最早优先' },
  { value: 'popular', label: '最多浏览' },
  { value: 'title', label: '按标题' },
] as const;

function ListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-4 rounded-2xl bg-surface p-4 shadow-card">
          <Skeleton className="mt-1 h-3 w-5 shrink-0" />
          <div className="w-full space-y-2.5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PostListPage() {
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1) || 1;
  const tag = params.get('tag') ?? '';
  const sort = (params.get('sort') ?? 'newest') as (typeof SORTS)[number]['value'];
  const perPage = settings.layout.postsPerPage;

  const tags = useAsync(() => fetchTags(), []);

  const result = useAsync(async () => {
    return api.get<PostSummary[]>(`/posts${qs({ page, perPage, tag: tag || undefined, sort })}`);
  }, [page, tag, sort, perPage]);

  const posts = result.data?.data ?? [];
  const meta: ApiMeta = result.data?.meta ?? {};
  const activeTag = tags.data?.find((t) => t.slug === tag);

  useDocumentTitle(activeTag ? `标签：${activeTag.name}` : '文章', settings.site.name);

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const offset = ((meta.page ?? page) - 1) * perPage;

  return (
    <PageWithSidebar>
      <header className="mb-10">
        <span className="eb-kicker">{activeTag ? '标签' : '索引'}</span>
        <h1 className="mt-3 font-heading text-3xl tracking-tight text-fg sm:text-4xl">
          {activeTag ? activeTag.name : '全部文章'}
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
          <span>{meta.total != null ? `${meta.total} 篇` : '探索全部内容'}</span>
          {activeTag && (
            <button
              type="button"
              onClick={() => update({ tag: undefined })}
              className="text-brand hover:underline"
            >
              清除筛选
            </button>
          )}
        </p>
      </header>

      {tags.data && tags.data.length > 0 && (
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => update({ tag: undefined })}
            aria-pressed={!tag}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
              !tag
                ? 'bg-brand text-brand-fg shadow-sm'
                : 'bg-surface text-muted shadow-card hover:text-fg',
            )}
          >
            全部
          </button>
          {tags.data.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => update({ tag: t.slug })}
              aria-pressed={tag === t.slug}
              className={cn(
                'inline-flex items-baseline gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                tag === t.slug
                  ? 'bg-brand text-brand-fg shadow-sm'
                  : 'bg-surface text-muted shadow-card hover:text-fg',
              )}
            >
              {t.name}
              <span className="eb-index-num">{t.post_count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-xs text-faint">
          {meta.page && meta.totalPages ? `第 ${meta.page} / ${meta.totalPages} 页` : '\u00a0'}
        </p>
        <Select
          aria-label="排序"
          value={sort}
          onChange={(e) => update({ sort: e.target.value })}
          className="w-36"
          wrapperClassName="w-36"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>

      {result.error ? (
        <ErrorState description={result.error} onRetry={result.reload} />
      ) : result.loading && !result.data ? (
        <ListSkeleton count={Math.min(perPage, 6)} />
      ) : posts.length === 0 ? (
        <EmptyState
          icon="search"
          title="没有找到文章"
          description={tag ? '试试其他标签，或查看全部文章。' : '这里还没有内容。'}
        />
      ) : (
        <>
          <PostCollection posts={posts} offset={offset} />
          <Pagination
            className="mt-12"
            page={meta.page ?? 1}
            totalPages={meta.totalPages ?? 1}
            onChange={(p) => update({ page: p })}
          />
        </>
      )}
    </PageWithSidebar>
  );
}
