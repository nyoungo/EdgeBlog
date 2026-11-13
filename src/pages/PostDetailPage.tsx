import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PostDetail } from '@shared/types';
import { ApiError, api } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { useAsync, useDocumentTitle, useMetaDescription } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';
import { buttonStyles } from '../components/ui/Button';
import { Centered, ErrorState, Spinner } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { PostCollection } from '../components/blog/PostListItem';
import { TableOfContents } from '../components/blog/TableOfContents';
import { ShareButtons } from '../components/blog/ShareButtons';
import { CommentSection } from '../components/blog/CommentSection';
import { Prose, useMarkdownToc } from '../components/blog/Prose';

/** Thin bar at the very top showing how far through the article you are. */
function ReadingProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setPct(max > 0 ? Math.min(100, Math.max(0, (el.scrollTop / max) * 100)) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-0.5" aria-hidden="true">
      <div className="h-full bg-brand transition-[width] duration-150 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PostDetailPage() {
  const { slug = '' } = useParams();
  const { settings } = useSettings();
  const { features } = settings;

  const post = useAsync(async () => {
    try {
      return await api.get<PostDetail>(`/posts/${slug}`).then((r) => r.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }, [slug]);

  const detail = post.data;

  // Read the body + headings once (memoised inside the component below).
  const { html, toc } = useMarkdownToc(detail?.content_md ?? '');

  useDocumentTitle(detail?.meta_title || detail?.title, settings.site.name);
  useMetaDescription(detail?.meta_description || detail?.excerpt);

  // Count a view once per browser session.
  useEffect(() => {
    if (!detail || !features.views) return;
    const key = `eb:view:${detail.slug}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    void api.post(`/posts/${detail.slug}/view`).catch(() => undefined);
  }, [detail, features.views]);

  // A failed request is not a missing article — say so and offer a retry.
  if (post.error) {
    return (
      <div className="container-page py-24">
        <ErrorState
          className="mx-auto max-w-lg"
          title="文章加载失败"
          description={post.error}
          onRetry={post.reload}
        />
      </div>
    );
  }

  if (post.loading && !detail) {
    return (
      <Centered className="py-32">
        <Spinner />
      </Centered>
    );
  }

  if (!detail) {
    return (
      <div className="container-page flex flex-col items-center py-32 text-center">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-faint">
          <Icon name="fileText" size={26} />
        </span>
        <h1 className="text-2xl font-bold text-fg">文章不存在</h1>
        <p className="mt-2 text-sm text-muted">它可能已被删除，或从未发布。</p>
        <Link to="/posts" className={buttonStyles({ className: 'mt-6' })}>
          返回文章列表
        </Link>
      </div>
    );
  }

  const showToc = features.toc && toc.length >= 2;
  const published = detail.published_at ?? detail.created_at;

  return (
    <article className="container-page py-12">
      <ReadingProgress />
      <nav className="mb-6 flex items-center gap-1.5 text-xs text-faint">
        <Link to="/" className="no-underline transition-colors hover:text-fg">
          首页
        </Link>
        <Icon name="chevronRight" size={12} />
        {detail.column ? (
          <>
            <Link to="/columns" className="no-underline transition-colors hover:text-fg">
              专栏
            </Link>
            <Icon name="chevronRight" size={12} />
            <Link
              to={`/columns/${detail.column.slug}`}
              className="truncate no-underline transition-colors hover:text-fg"
            >
              {detail.column.name}
            </Link>
          </>
        ) : (
          <Link to="/posts" className="no-underline transition-colors hover:text-fg">
            文章
          </Link>
        )}
      </nav>

      <header>
        {detail.column ? (
          <Link
            to={`/columns/${detail.column.slug}`}
            className="eb-kicker inline-flex items-center gap-1 no-underline hover:text-brand"
          >
            <Icon name="columns" size={12} />
            专栏 · {detail.column.name}
          </Link>
        ) : (
          <span className="eb-kicker">文章</span>
        )}
        <h1 className="mt-3 font-heading text-3xl leading-tight tracking-tight text-fg text-balance sm:text-4xl lg:text-5xl">
          {detail.title}
        </h1>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-faint">
          {detail.author_name && (
            <span className="inline-flex items-center gap-1.5">
              <span className="flex size-6 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-brand-fg">
                {detail.author_name.slice(0, 1).toUpperCase()}
              </span>
              {detail.author_name}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Icon name="calendar" size={13} />
            {formatDate(published, settings.site.locale)}
          </span>
          {features.views && (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="eye" size={13} />
              {formatNumber(detail.views)}
            </span>
          )}
        </div>
      </header>

      {detail.cover_url && (
        // Fixed aspect box reserves the space before the image loads (no CLS).
        <div className="mt-8 aspect-[16/9] w-full overflow-hidden rounded-2xl bg-surface-2 shadow-card">
          <img
            src={detail.cover_url}
            alt={detail.title}
            // Hero image: it is the LCP element, so decode it with priority
            // instead of lazily.
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {showToc && (
        // Long reads used to have no navigation at all on phones.
        <details className="mt-8 rounded-2xl bg-surface p-4 shadow-card lg:hidden">
          <summary className="cursor-pointer list-none text-sm font-semibold text-fg">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="list" size={15} />
              目录（{toc.length}）
            </span>
          </summary>
          <div className="mt-3">
            <TableOfContents entries={toc} />
          </div>
        </details>
      )}

      <div className="mt-10 flex gap-10">
        <div className="min-w-0 flex-1">
          <Prose markdown={detail.content_md ?? ''} html={html} className="max-w-content" />

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {detail.tags.map((tag) => (
                <Link
                  key={tag.id}
                  to={`/posts?tag=${encodeURIComponent(tag.slug)}`}
                  className="text-sm text-muted no-underline transition-colors hover:text-brand"
                >
                  #{tag.name}
                </Link>
              ))}
            </div>
            <ShareButtons title={detail.title} slug={detail.slug} />
          </div>

          {features.prevNext && (detail.prev || detail.next) && (
            <nav className="mt-10 grid gap-4 sm:grid-cols-2">
              {detail.prev ? (
                <Link
                  to={`/posts/${detail.prev.slug}`}
                  className="group rounded-2xl bg-surface p-4 no-underline shadow-card transition-shadow hover:shadow-lift"
                >
                  <span className="eb-kicker inline-flex items-center gap-1.5">
                    <Icon name="arrowLeft" size={12} />
                    上一篇
                  </span>
                  <p className="mt-2 line-clamp-2 font-heading text-base text-fg transition-colors group-hover:text-brand">
                    {detail.prev.title}
                  </p>
                </Link>
              ) : (
                <span />
              )}
              {detail.next && (
                <Link
                  to={`/posts/${detail.next.slug}`}
                  className="group rounded-2xl bg-surface p-4 text-right no-underline shadow-card transition-shadow hover:shadow-lift"
                >
                  <span className="eb-kicker inline-flex items-center gap-1.5">
                    下一篇
                    <Icon name="arrowRight" size={12} />
                  </span>
                  <p className="mt-2 line-clamp-2 font-heading text-base text-fg transition-colors group-hover:text-brand">
                    {detail.next.title}
                  </p>
                </Link>
              )}
            </nav>
          )}

          {features.comments && <CommentSection postSlug={detail.slug} />}
        </div>

        {showToc && (
          <aside className="hidden w-56 shrink-0 lg:block">
            <div className="rail-sticky">
              <TableOfContents entries={toc} />
            </div>
          </aside>
        )}
      </div>

      {features.relatedPosts && detail.related.length > 0 && (
        <section className="mt-20">
          <h2 className="mb-4 font-heading text-2xl tracking-tight text-fg">相关文章</h2>
          <PostCollection posts={detail.related} />
        </section>
      )}
    </article>
  );
}
