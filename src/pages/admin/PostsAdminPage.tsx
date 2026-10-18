import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ApiMeta, PostSummary } from '@shared/types';
import { Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/icons';
import { Pagination } from '../../components/ui/Pagination';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api, qs } from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';

const STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'published', label: '已发布' },
  { value: 'draft', label: '草稿' },
  { value: 'scheduled', label: '定时' },
];

export function PostsAdminPage() {
  const { settings } = useSettings();
  const { success, error } = useToast();
  const [params, setParams] = useSearchParams();
  const [pendingDelete, setPendingDelete] = useState<PostSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const page = Number(params.get('page') ?? 1) || 1;
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';

  useDocumentTitle('文章管理', settings.site.name);

  const { data, loading, reload } = useAsync(
    () => api.get<PostSummary[]>(`/posts/admin${qs({ page, perPage: 15, status: status || undefined, q: q || undefined })}`),
    [page, status, q],
  );

  const posts = data?.data ?? [];
  const meta: ApiMeta = data?.meta ?? {};

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/posts/${pendingDelete.id}`);
      success('文章已删除');
      setPendingDelete(null);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">文章管理</h1>
          <p className="mt-1 text-sm text-muted">{meta.total != null ? `共 ${meta.total} 篇文章` : '管理全部文章'}</p>
        </div>
        <Link
          to="/admin/posts/new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand/90"
        >
          <Icon name="plus" size={17} />
          新建文章
        </Link>
      </header>

      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          value={status}
          onChange={(e) => update({ status: e.target.value })}
          wrapperClassName="w-40"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Input
          placeholder="搜索标题…"
          defaultValue={q}
          wrapperClassName="w-56"
          onChange={(e) => update({ q: e.target.value })}
        />
      </div>

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon="fileText"
          title="没有文章"
          description="创建第一篇文章开始你的写作。"
          action={
            <Link to="/admin/posts/new" className="text-sm font-medium text-brand hover:underline">
              新建文章
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-faint">
                  <th className="px-4 py-3 font-medium">标题</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">浏览量</th>
                  <th className="px-4 py-3 font-medium">更新时间</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {posts.map((post) => (
                  <tr key={post.id} className="transition-colors hover:bg-surface-2/50">
                    <td className="px-4 py-3">
                      <Link to={`/admin/posts/${post.slug}`} className="font-medium text-fg hover:text-brand">
                        {post.title}
                      </Link>
                      {post.tags.length > 0 && (
                        <p className="mt-0.5 text-xs text-faint">{post.tags.map((t) => t.name).join(' · ')}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={post.status} />
                    </td>
                    <td className="px-4 py-3 text-muted">{formatNumber(post.views)}</td>
                    <td className="px-4 py-3 text-muted">{formatDateTime(post.updated_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Link
                          to={`/admin/posts/${post.slug}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                          title="编辑"
                        >
                          <Icon name="pencil" size={16} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(post)}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                          title="删除"
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Pagination
        className="mt-6"
        page={meta.page ?? 1}
        totalPages={meta.totalPages ?? 1}
        onChange={(p) => update({ page: p })}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除文章"
        description={pendingDelete ? `确定要删除《${pendingDelete.title}》吗？此操作无法撤销。` : ''}
        confirmLabel="删除"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
