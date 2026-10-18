import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PostSummary } from '@shared/types';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { PostCard, cardGridClass } from '../components/blog/PostCard';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { api, qs } from '../lib/api';
import { useAsync, useDebounced, useDocumentTitle } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

export function SearchPage() {
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const query = useDebounced(input.trim(), 350);

  useDocumentTitle('搜索', settings.site.name);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (query) next.set('q', query);
    else next.delete('q');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const result = useAsync(async () => {
    if (!query) return { data: [] as PostSummary[], meta: undefined };
    return api.get<PostSummary[]>(`/search${qs({ q: query, perPage: 20 })}`);
  }, [query]);

  const posts = result.data?.data ?? [];
  const total = result.data?.meta?.total ?? 0;

  return (
    <PageWithSidebar>
      <header className="mx-auto mb-10 max-w-2xl text-center">
        <h1 className="text-2xl font-bold tracking-tight text-fg">搜索</h1>
        <p className="mt-1.5 text-sm text-muted">在全部文章中查找关键词（支持中英文）</p>
        <div className="relative mt-6">
          <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入关键词…"
            className="w-full rounded-full border border-border bg-surface py-3 pl-11 pr-4 text-base text-fg placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        {query && <p className="mt-3 text-sm text-faint">找到 {total} 条结果</p>}
      </header>

      {!query ? (
        <p className="text-center text-sm text-faint">输入关键词开始搜索</p>
      ) : result.loading && !result.data ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon="search"
          title="没有匹配的结果"
          description={`没有找到与「${query}」相关的文章，试试其他关键词。`}
        />
      ) : (
        <div className={cardGridClass(settings.layout.cardStyle, settings.layout.cardSize)}>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} style={settings.layout.cardStyle} />
          ))}
        </div>
      )}
    </PageWithSidebar>
  );
}
