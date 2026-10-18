import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PostDetail } from '@shared/types';
import { ApiError, api } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { useAsync, useDocumentTitle, useMetaDescription } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';
import { Badge } from '../components/ui/Badge';
import { buttonStyles } from '../components/ui/Button';
import { Centered, Spinner } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { PostCard, cardGridClass } from '../components/blog/PostCard';
import { TableOfContents } from '../components/blog/TableOfContents';
import { ShareButtons } from '../components/blog/ShareButtons';
import { CommentSection } from '../components/blog/CommentSection';
import { useMarkdownToc } from '../components/blog/Prose';

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
    <article className="container-page py-10">
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-faint">
        <Link to="/" className="no-underline transition-colors hover:text-fg">
          首页
        </Link>
        <Icon name="chevronRight" size={14} />
        <Link to="/posts" className="no-underline transition-colors hover:text-fg">
          文章
        </Link>
      </nav>

      <header className="max-w-3xl">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-fg text-balance sm:text-4xl">
          {detail.title}
        </h1>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-faint">
          {detail.author_name && (
            <span className="inline-flex items-center gap-1.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-brand-fg">
                {detail.author_name.slice(0, 1).toUpperCase()}
              </span>
              {detail.author_name}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Icon name="calendar" size={15} />
            {formatDate(published, settings.site.locale)}
          </span>
          {features.views && (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="eye" size={15} />
              {formatNumber(detail.views)} 次浏览
            </span>
          )}
        </div>
      </header>

      {detail.cover_url && (
        <img
          src={detail.cover_url}
          alt={detail.title}
          className="mt-8 w-full rounded-xl border border-border object-cover"
        />
      )}

      <div className="mt-10 flex gap-10">
        <div className="min-w-0 flex-1">
          <div className="prose-article max-w-content" dangerouslySetInnerHTML={{ __html: html }} />

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
            <div className="flex flex-wrap gap-1.5">
              {detail.tags.map((tag) => (
                <Link key={tag.id} to={`/posts?tag=${encodeURIComponent(tag.slug)}`} className="no-underline">
                  <Badge tone="outline" className="px-2.5 py-1">
                    <Icon name="tag" size={12} />
                    {tag.name}
                  </Badge>
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
                  className="group rounded-xl border border-border bg-surface p-4 no-underline transition-colors hover:border-brand"
                >
                  <span className="flex items-center gap-1.5 text-xs text-faint">
                    <Icon name="arrowLeft" size={13} />
                    上一篇
                  </span>
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium text-fg group-hover:text-brand">
                    {detail.prev.title}
                  </p>
                </Link>
              ) : (
                <span />
              )}
              {detail.next && (
                <Link
                  to={`/posts/${detail.next.slug}`}
                  className="group rounded-xl border border-border bg-surface p-4 text-right no-underline transition-colors hover:border-brand"
                >
                  <span className="flex items-center justify-end gap-1.5 text-xs text-faint">
                    下一篇
                    <Icon name="arrowRight" size={13} />
                  </span>
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium text-fg group-hover:text-brand">
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
            <div className="sticky top-24">
              <TableOfContents entries={toc} />
            </div>
          </aside>
        )}
      </div>

      {features.relatedPosts && detail.related.length > 0 && (
        <section className="mt-20 border-t border-border pt-10">
          <h2 className="mb-6 text-xl font-semibold tracking-tight text-fg">相关文章</h2>
          <div className={cardGridClass(settings.layout.cardStyle, settings.layout.cardSize)}>
            {detail.related.map((post) => (
              <PostCard key={post.id} post={post} style={settings.layout.cardStyle} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
