import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ApiMeta, Comment } from '@shared/types';
import { Input } from '../../components/ui/Field';
import { Card, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/icons';
import { Pagination } from '../../components/ui/Pagination';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { api, qs } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';

type AdminComment = Comment & { post_title: string; post_slug: string };

const TABS = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'spam', label: '垃圾' },
  { value: 'rejected', label: '已拒绝' },
];

export function CommentsAdminPage() {
  const { settings } = useSettings();
  const { success, error } = useToast();
  const [params, setParams] = useSearchParams();
  const [pendingDelete, setPendingDelete] = useState<AdminComment | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const page = Number(params.get('page') ?? 1) || 1;
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';

  useDocumentTitle('评论管理', settings.site.name);

  const { data, loading, reload } = useAsync(
    () => api.get<AdminComment[]>(`/comments${qs({ page, perPage: 20, status: status || undefined, q: q || undefined })}`),
    [page, status, q],
  );

  const comments = data?.data ?? [];
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

  const setStatus = async (comment: AdminComment, next: string) => {
    setBusyId(comment.id);
    try {
      await api.patch(`/comments/${comment.id}`, { status: next });
      success('评论状态已更新');
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/comments/${pendingDelete.id}`);
      success('评论已删除');
      setPendingDelete(null);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const actionBtn =
    'rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50';

  return (
    <div className="w-full">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-fg">评论管理</h1>
        <p className="mt-1 text-sm text-muted">{meta.total != null ? `共 ${meta.total} 条评论` : '审核与管理评论'}</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => update({ status: tab.value })}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                status === tab.value ? 'bg-brand text-brand-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Input
          placeholder="搜索作者或内容…"
          defaultValue={q}
          wrapperClassName="w-56"
          onChange={(e) => update({ q: e.target.value })}
        />
      </div>

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <EmptyState icon="message" title="没有评论" description="这个筛选条件下没有找到评论。" />
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <Card key={comment.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-fg">{comment.author}</span>
                  <StatusBadge status={comment.status} />
                  <span className="text-xs text-faint">{formatDateTime(comment.created_at)}</span>
                </div>
                <span className="text-xs text-faint">
                  于{' '}
                  <a
                    href={`/posts/${comment.post_slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted hover:text-brand"
                  >
                    《{comment.post_title}》
                  </a>
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg/90">{comment.content}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {comment.status !== 'approved' && (
                  <button
                    type="button"
                    disabled={busyId === comment.id}
                    onClick={() => void setStatus(comment, 'approved')}
                    className={cn(actionBtn, 'text-success hover:bg-success/10')}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Icon name="check" size={13} /> 通过
                    </span>
                  </button>
                )}
                {comment.status !== 'rejected' && (
                  <button
                    type="button"
                    disabled={busyId === comment.id}
                    onClick={() => void setStatus(comment, 'rejected')}
                    className={cn(actionBtn, 'text-muted hover:bg-surface-2')}
                  >
                    拒绝
                  </button>
                )}
                {comment.status !== 'spam' && (
                  <button
                    type="button"
                    disabled={busyId === comment.id}
                    onClick={() => void setStatus(comment, 'spam')}
                    className={cn(actionBtn, 'text-warning hover:bg-warning/10')}
                  >
                    标记垃圾
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPendingDelete(comment)}
                  className={cn(actionBtn, 'text-danger hover:bg-danger/10')}
                >
                  删除
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Pagination
        className="mt-6"
        page={meta.page ?? 1}
        totalPages={meta.totalPages ?? 1}
        onChange={(p) => update({ page: p })}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除评论"
        description="删除后无法恢复，且会一并删除其下所有回复。"
        confirmLabel="删除"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
