import { Link } from 'react-router-dom';
import { Card, Centered, Spinner } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/Badge';
import { Icon, type IconName } from '../../components/ui/icons';
import { api } from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';

interface Stats {
  posts: { total: number; published: number; draft: number; scheduled: number };
  views: number;
  comments: { total: number; pending: number; approved: number; rejected: number; spam: number };
  recentComments: Array<{
    id: number;
    author: string;
    content: string;
    status: string;
    created_at: string;
    post_title: string;
    post_slug: string;
  }>;
  recentPosts: Array<{ id: number; slug: string; title: string; status: string; views: number; updated_at: string }>;
}

function StatCard({ label, value, icon, hint }: { label: string; value: string | number; icon: IconName; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Icon name={icon} size={17} />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </Card>
  );
}

export function DashboardPage() {
  const { settings } = useSettings();
  const { data, loading } = useAsync(() => api.get<Stats>('/stats').then((r) => r.data), []);
  useDocumentTitle('概览', settings.site.name);

  if (loading && !data) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  }
  if (!data) return null;

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">概览</h1>
          <p className="mt-1 text-sm text-muted">网站的整体运行情况</p>
        </div>
        <Link
          to="/admin/posts/new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand/90"
        >
          <Icon name="plus" size={17} />
          写文章
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="文章总数"
          value={data.posts.total}
          icon="fileText"
          hint={`${data.posts.published} 已发布 · ${data.posts.draft} 草稿 · ${data.posts.scheduled} 定时`}
        />
        <StatCard label="总浏览量" value={formatNumber(data.views)} icon="eye" />
        <StatCard
          label="评论总数"
          value={data.comments.total}
          icon="message"
          hint={`${data.comments.approved} 已通过 · ${data.comments.pending} 待审核`}
        />
        <StatCard label="垃圾评论" value={data.comments.spam} icon="alert" hint={`${data.comments.rejected} 已拒绝`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-fg">最近文章</h2>
            <Link to="/admin/posts" className="text-xs text-muted hover:text-brand">
              全部
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {data.recentPosts.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-faint">暂无文章</li>
            )}
            {data.recentPosts.map((post) => (
              <li key={post.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <Link to={`/admin/posts/${post.slug}`} className="min-w-0 flex-1 no-underline">
                  <p className="truncate text-sm font-medium text-fg hover:text-brand">{post.title}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {formatDateTime(post.updated_at)} · {formatNumber(post.views)} 次浏览
                  </p>
                </Link>
                <StatusBadge status={post.status} />
              </li>
            ))}
          </ul>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-fg">最新评论</h2>
            <Link to="/admin/comments" className="text-xs text-muted hover:text-brand">
              全部
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {data.recentComments.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-faint">暂无评论</li>
            )}
            {data.recentComments.map((comment) => (
              <li key={comment.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-fg">{comment.author}</span>
                  <StatusBadge status={comment.status} />
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{comment.content}</p>
                <p className="mt-1 truncate text-xs text-faint">于《{comment.post_title}》</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
