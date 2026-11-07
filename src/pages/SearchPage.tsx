import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PostSummary } from '@shared/types';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { Pagination } from '../components/ui/Pagination';
import { PostCollection } from '../components/blog/PostListItem';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { api, qs } from '../lib/api';
import { useAsync, useDebounced, useDocumentTitle } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

const RECENT_KEY = 'eb:recent-searches';
const PER_PAGE = 12;

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function SearchSkeleton({ count = 4 }: { count?: number }) {
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

export function SearchPage() {
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const query = useDebounced(input.trim(), 350);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const page = Number(params.get('page') ?? 1) || 1;

  // ⌘K / Ctrl+K 或 `/` 聚焦搜索框。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing = Boolean(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      const isPalette = e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey);
      if (isPalette || (e.key === '/' && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 记住最近搜索，空结果时不是死路。
  useEffect(() => {
    if (!query || query.length < 2) return;
    const next = [query, ...readRecent().filter((r) => r !== query)].slice(0, 6);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — recent searches are a bonus, not a requirement */
    }
    setRecent(next);
  }, [query]);

  useDocumentTitle('搜索', settings.site.name);

  // ?q 同步：新查询回到第 1 页，带 page 的深链首屏保留页码。
  const prevQuery = useRef(query);
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (query) next.set('q', query);
    else next.delete('q');
    if (prevQuery.current !== query) next.delete('page');
    prevQuery.current = query;
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const result = useAsync(async () => {
    if (!query) return { data: [] as PostSummary[], meta: undefined };
    return api.get<PostSummary[]>(`/search${qs({ q: query, page, perPage: PER_PAGE })}`);
  }, [query, page]);

  const posts = result.data?.data ?? [];
  const total = result.data?.meta?.total ?? 0;
  const totalPages = result.data?.meta?.totalPages ?? 1;
  const noResults = Boolean(query) && !result.loading && !result.error && posts.length === 0;

  // 空结果时给几篇热门文章，避免只剩一行灰字。
  const recommend = useAsync(async () => {
    if (!noResults) return [] as PostSummary[];
    const { data } = await api.get<PostSummary[]>(`/posts${qs({ perPage: 3, sort: 'popular' })}`);
    return data;
  }, [noResults]);

  const goPage = (p: number) => {
    const next = new URLSearchParams(params);
    if (p <= 1) next.delete('page');
    else next.set('page', String(p));
    setParams(next, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <PageWithSidebar>
      <header className="mb-8">
        <span className="eb-kicker">检索</span>
        <h1 className="mt-3 font-heading text-3xl tracking-tight text-fg sm:text-4xl">搜索</h1>
        <div className="relative mt-6 max-w-xl">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            ref={inputRef}
            type="search"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入关键词…（⌘K 或 / 聚焦）"
            aria-label="搜索关键词"
            className="w-full rounded-xl bg-surface py-3 pl-11 pr-4 text-base text-fg shadow-card ring-1 ring-fg/5 transition-shadow placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>
        <p className="mt-3 text-xs text-faint">
          {query
            ? result.loading && !result.data
              ? '搜索中…'
              : `${total} 条结果`
            : '支持中英文关键词'}
        </p>
      </header>

      {!query ? (
        <div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted">输入关键词开始搜索。</p>
          ) : (
            <>
              <h2 className="eb-kicker">最近搜索</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {recent.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => setInput(term)}
                    className="rounded-full bg-surface px-3.5 py-1.5 text-sm text-muted shadow-card transition-colors hover:text-fg"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : result.error ? (
        <ErrorState title="搜索失败" description={result.error} onRetry={result.reload} />
      ) : result.loading && !result.data ? (
        <SearchSkeleton />
      ) : posts.length === 0 ? (
        <div>
          <EmptyState
            icon="search"
            title="没有匹配的结果"
            description={`没有找到与「${query}」相关的文章，试试其他关键词。`}
          />
          {(recommend.data?.length ?? 0) > 0 && (
            <div className="mt-12">
              <h2 className="mb-4 eb-kicker">热门文章</h2>
              <PostCollection posts={recommend.data ?? []} />
            </div>
          )}
        </div>
      ) : (
        <>
          <PostCollection
            posts={posts}
            offset={(page - 1) * PER_PAGE}
            highlight={query}
          />
          <Pagination className="mt-10" page={page} totalPages={totalPages} onChange={goPage} />
        </>
      )}
    </PageWithSidebar>
  );
}
