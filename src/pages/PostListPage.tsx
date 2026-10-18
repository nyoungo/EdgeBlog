import { useSearchParams } from 'react-router-dom';
import type { ApiMeta, PostSummary, Tag } from '@shared/types';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Field';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { Pagination } from '../components/ui/Pagination';
import { PostCard, cardGridClass } from '../components/blog/PostCard';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { api, qs } from '../lib/api';
import { useAsync, useDocumentTitle } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

const SORTS = [
  { value: 'newest', label: '最新优先' },
  { value: 'oldest', label: '最早优先' },
  { value: 'popular', label: '最多浏览' },
  { value: 'title', label: '按标题' },
] as const;

export function PostListPage() {
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1) || 1;
  const tag = params.get('tag') ?? '';
  const sort = (params.get('sort') ?? 'newest') as (typeof SORTS)[number]['value'];

  const tags = useAsync(() => api.get<Tag[]>('/tags').then((r) => r.data), []);

  const result = useAsync(async () => {
    return api.get<PostSummary[]>(
      `/posts${qs({ page, perPage: settings.layout.postsPerPage, tag: tag || undefined, sort })}`,
    );
  }, [page, tag, sort, settings.layout.postsPerPage]);

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

  return (
    <PageWithSidebar>
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-fg">
          <Icon name="fileText" size={22} className="text-brand" />
          {activeTag ? activeTag.name : '全部文章'}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {meta.total != null ? `共 ${meta.total} 篇文章` : '探索全部内容'}
          {activeTag && (
            <button
              type="button"
              onClick={() => update({ tag: undefined })}
              className="ml-2 text-brand hover:underline"
            >
              清除筛选
            </button>
          )}
        </p>
      </header>

      {tags.data && tags.data.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => update({ tag: undefined })}
            className="no-underline"
            aria-pressed={!tag}
          >
            <Badge tone={!tag ? 'brand' : 'outline'} className="px-3 py-1 text-sm">
              全部
            </Badge>
          </button>
          {tags.data.map((t) => (
            <button key={t.id} type="button" onClick={() => update({ tag: t.slug })} aria-pressed={tag === t.slug} className="no-underline">
              <Badge tone={tag === t.slug ? 'brand' : 'outline'} className="px-3 py-1 text-sm">
                {t.name}
                <span className="text-faint">{t.post_count}</span>
              </Badge>
            </button>
          ))}
        </div>
      )}

      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-faint">
          {meta.page && meta.totalPages ? `第 ${meta.page} / ${meta.totalPages} 页` : ''}
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

      {result.loading && !result.data ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border bg-surface">
              <Skeleton className="aspect-[16/9] w-full" />
              <div className="space-y-3 p-5">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon="search"
          title="没有找到文章"
          description={tag ? '试试其他标签，或查看全部文章。' : '这里还没有内容。'}
        />
      ) : (
        <>
          <div className={cardGridClass(settings.layout.cardStyle, settings.layout.cardSize)}>
            {posts.map((post) => (
              <PostCard key={post.id} post={post} style={settings.layout.cardStyle} />
            ))}
          </div>
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
