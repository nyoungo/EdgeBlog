import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ApiMeta, ColumnSummary, PostSummary } from '@shared/types';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/icons';
import { Pagination } from '../../components/ui/Pagination';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api, qs } from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';
import { useAsync, useDebounced, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';
import { cn } from '../../lib/utils';

const STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'published', label: '已发布' },
  { value: 'draft', label: '草稿' },
  { value: 'scheduled', label: '定时' },
];

const SORTS = [
  { value: 'newest', label: '最新发布' },
  { value: 'oldest', label: '最早发布' },
  { value: 'popular', label: '浏览量' },
  { value: 'title', label: '标题' },
];

type Row = PostSummary & { deleted_at?: string };

export function PostsAdminPage() {
  const { settings } = useSettings();
  const { success, error } = useToast();
  const [params, setParams] = useSearchParams();
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const page = Number(params.get('page') ?? 1) || 1;
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? 'newest';
  const q = params.get('q') ?? '';
  const columnId = params.get('columnId') ?? '';
  const trash = params.get('trash') === '1';

  // Debounce the search box: typing used to fire a request per keystroke.
  const [searchInput, setSearchInput] = useState(q);
  const debouncedSearch = useDebounced(searchInput, 350);

  useDocumentTitle(trash ? '回收站' : '文章管理', settings.site.name);

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
    setSelected(new Set());
  };

  useEffect(() => {
    if (debouncedSearch !== q) update({ q: debouncedSearch || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const columns = useAsync(
    () => api.get<ColumnSummary[]>('/columns/admin').then((r) => r.data).catch(() => [] as ColumnSummary[]),
    [],
  );

  const { data, loading, reload } = useAsync(
    () =>
      trash
        ? api.get<Row[]>(`/posts/trash${qs({ page, perPage: 15 })}`)
        : api.get<Row[]>(
            `/posts/admin${qs({
              page,
              perPage: 15,
              status: status || undefined,
              q: q || undefined,
              sort,
              columnId: columnId || undefined,
            })}`,
          ),
    [page, status, q, sort, columnId, trash],
  );

  const posts = data?.data ?? [];
  const meta: ApiMeta = data?.meta ?? {};
  const allSelected = posts.length > 0 && posts.every((p) => selected.has(p.id));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(posts.map((p) => p.id)));
  };
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runSingle = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      success(okMsg);
      setPendingDelete(null);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    if (trash) {
      await runSingle(() => api.del(`/posts/${target.id}/purge`), '文章已彻底删除');
    } else {
      await runSingle(() => api.del(`/posts/${target.id}`), '文章已移到回收站');
    }
  };

  const restore = (post: Row) => runSingle(() => api.post(`/posts/${post.id}/restore`), '文章已恢复');

  const bulkTrash = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    let done = 0;
    for (const id of ids) {
      try {
        await api.del(`/posts/${id}`);
        done += 1;
      } catch {
        /* keep going; report the count below */
      }
    }
    setBusy(false);
    setSelected(new Set());
    success(`已将 ${done} 篇文章移到回收站`);
    reload();
  };

  const bulkRestore = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    let done = 0;
    for (const id of ids) {
      try {
        await api.post(`/posts/${id}/restore`);
        done += 1;
      } catch {
        /* ignore individual failures */
      }
    }
    setBusy(false);
    setSelected(new Set());
    success(`已恢复 ${done} 篇文章`);
    reload();
  };

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-fg">
            {trash ? '回收站' : '文章管理'}
            {trash && <Icon name="trash" size={18} className="text-faint" />}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {trash
              ? '删除的文章会先进入这里,可随时恢复或彻底删除'
              : meta.total != null
                ? `共 ${meta.total} 篇文章`
                : '管理全部文章'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => update({ trash: trash ? undefined : '1', status: undefined })}>
            <Icon name={trash ? 'arrowLeft' : 'trash'} size={16} />
            {trash ? '返回文章' : '回收站'}
          </Button>
          {!trash && (
            <Link
              to="/admin/posts/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-hover"
            >
              <Icon name="plus" size={17} />
              新建文章
            </Link>
          )}
        </div>
      </header>

      {!trash && (
        <div className="mb-4 flex flex-wrap gap-3">
          <Select value={status} onChange={(e) => update({ status: e.target.value })} wrapperClassName="w-36">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select
            value={columnId}
            onChange={(e) => update({ columnId: e.target.value })}
            wrapperClassName="w-44"
            aria-label="按专栏筛选"
          >
            <option value="">全部归属</option>
            <option value="0">仅博客</option>
            {(columns.data ?? []).map((column) => (
              <option key={column.id} value={String(column.id)}>
                {column.name}
              </option>
            ))}
          </Select>
          <Select value={sort} onChange={(e) => update({ sort: e.target.value })} wrapperClassName="w-36">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Input
            placeholder="搜索标题..."
            value={searchInput}
            wrapperClassName="w-56"
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
          <span className="text-muted">已选择 {selected.size} 篇</span>
          <div className="ml-auto flex gap-2">
            {trash ? (
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void bulkRestore()}>
                恢复所选
              </Button>
            ) : (
              <Button size="sm" variant="danger" loading={busy} onClick={() => void bulkTrash()}>
                移到回收站
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              取消
            </Button>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon={trash ? 'trash' : 'fileText'}
          title={trash ? '回收站是空的' : '没有文章'}
          description={trash ? '被删除的文章会出现在这里。' : '创建第一篇文章开始你的写作。'}
          action={
            !trash ? (
              <Link to="/admin/posts/new" className="text-sm font-medium text-brand hover:underline">
                新建文章
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-faint">
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="全选"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 accent-[rgb(var(--c-brand))]"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">标题</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">{trash ? '删除时间' : '浏览量'}</th>
                  <th className="px-4 py-3 font-medium">{trash ? '原发布时间' : '更新时间'}</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {posts.map((post) => (
                  <tr key={post.id} className={cn('transition-colors hover:bg-surface-2/50', selected.has(post.id) && 'bg-brand/5')}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`选择《${post.title}》`}
                        checked={selected.has(post.id)}
                        onChange={() => toggleOne(post.id)}
                        className="h-4 w-4 accent-[rgb(var(--c-brand))]"
                      />
                    </td>
                    <td className="px-4 py-3">
                      {trash ? (
                        <span className="font-medium text-fg">{post.title}</span>
                      ) : (
                        <Link to={`/admin/posts/${post.slug}`} className="font-medium text-fg hover:text-brand">
                          {post.title}
                        </Link>
                      )}
                      {post.tags.length > 0 && (
                        <p className="mt-0.5 text-xs text-faint">{post.tags.map((t) => t.name).join(' · ')}</p>
                      )}
                      {post.column && (
                        <Link
                          to={`/columns/${post.column.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand no-underline hover:underline"
                        >
                          <Icon name="columns" size={11} />
                          {post.column.name}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={post.status} />
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {trash ? formatDateTime(post.deleted_at ?? '') : formatNumber(post.views)}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDateTime(post.updated_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {trash ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void restore(post)}
                              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                              title="恢复"
                            >
                              <Icon name="refresh" size={15} />
                              恢复
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(post)}
                              className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                              title="彻底删除"
                            >
                              <Icon name="trash" size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            {post.status === 'published' && (
                              <a
                                href={`/posts/${post.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                                title="预览"
                              >
                                <Icon name="externalLink" size={16} />
                              </a>
                            )}
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
                              title="移到回收站"
                            >
                              <Icon name="trash" size={16} />
                            </button>
                          </>
                        )}
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
        title={trash ? '彻底删除文章' : '移到回收站'}
        description={
          pendingDelete
            ? trash
              ? `确定要彻底删除《${pendingDelete.title}》吗?此操作无法撤销。`
              : `《${pendingDelete.title}》将被移到回收站,可随时恢复。`
            : ''
        }
        confirmLabel={trash ? '彻底删除' : '移到回收站'}
        danger
        loading={busy}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}