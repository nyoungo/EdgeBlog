import { Link } from 'react-router-dom';
import type { PostSummary, Tag } from '@shared/types';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/icons';
import { api } from '../../lib/api';
import { formatDateShort } from '../../lib/format';
import { useAsync } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';

function Widget({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight text-fg">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Sidebar() {
  const { settings } = useSettings();
  const { site, features } = settings;
  const vt = features.viewTransitions;

  const recent = useAsync(() => api.get<PostSummary[]>('/posts?perPage=5&sort=newest').then((r) => r.data), []);
  const tags = useAsync(() => api.get<Tag[]>('/tags').then((r) => r.data), []);

  return (
    <div className="flex flex-col gap-5">
      <Widget title="关于本站">
        <Link to="/about" viewTransition={vt} className="flex items-center gap-2.5 text-fg no-underline">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-fg">
            {(site.logo.text || site.name).slice(0, 1).toUpperCase()}
          </span>
          <span className="font-semibold">{site.name}</span>
        </Link>
        <p className="mt-3 text-sm leading-relaxed text-muted">{site.description || site.tagline}</p>
      </Widget>

      <Widget title="最新文章">
        <ul className="space-y-3">
          {(recent.data ?? []).map((post) => (
            <li key={post.id}>
              <Link
                to={`/posts/${post.slug}`}
                viewTransition={vt}
                className="line-clamp-2 text-sm font-medium text-fg no-underline transition-colors hover:text-brand"
              >
                {post.title}
              </Link>
              <span className="mt-0.5 block font-mono text-xs text-faint">
                {formatDateShort(post.published_at ?? post.created_at)}
              </span>
            </li>
          ))}
          {recent.loading && !recent.data && <li className="text-sm text-faint">载入中…</li>}
          {recent.data && recent.data.length === 0 && <li className="text-sm text-faint">暂无文章</li>}
        </ul>
      </Widget>

      {tags.data && tags.data.length > 0 && (
        <Widget title="标签">
          <div className="flex flex-wrap gap-1.5">
            {tags.data.map((tag) => (
              <Link key={tag.id} to={`/posts?tag=${encodeURIComponent(tag.slug)}`} className="no-underline">
                <Badge tone="outline" className="transition-colors hover:border-brand hover:text-brand">
                  {tag.name}
                </Badge>
              </Link>
            ))}
          </div>
        </Widget>
      )}

      {features.rss && (
        <Widget title="订阅">
          <p className="text-sm text-muted">通过 RSS 订阅，第一时间获取新文章。</p>
          <a
            href="/rss.xml"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand no-underline hover:underline"
          >
            <Icon name="rss" size={15} />
            RSS 订阅
          </a>
        </Widget>
      )}
    </div>
  );
}
