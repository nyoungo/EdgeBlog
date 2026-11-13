import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ColumnSummary, MediaItem } from '@shared/types';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Switch';
import { Badge } from '../../components/ui/Badge';
import { Card, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/icons';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { MediaPicker } from '../../components/admin/MediaPicker';
import { api } from '../../lib/api';
import { formatDateShort } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';

interface FormState {
  name: string;
  slug: string;
  description: string;
  coverUrl: string;
  sortOrder: string;
  visible: boolean;
  showInSidebar: boolean;
}

const EMPTY: FormState = {
  name: '',
  slug: '',
  description: '',
  coverUrl: '',
  sortOrder: '0',
  visible: true,
  showInSidebar: false,
};

function toForm(column: ColumnSummary): FormState {
  return {
    name: column.name,
    slug: column.slug,
    description: column.description,
    coverUrl: column.cover_url ?? '',
    sortOrder: String(column.sort_order),
    visible: column.visible === 1,
    showInSidebar: column.show_in_sidebar === 1,
  };
}

/**
 * 专栏管理：列表 + 新建/编辑弹窗。
 *
 * 绑定侧栏就是逐个勾选 `show_in_sidebar`，没有单独的分组配置——一个专栏
 * 只有「在侧栏显示 / 不显示」两种状态，顺序沿用 sort_order。
 */
export function ColumnsAdminPage() {
  const { settings } = useSettings();
  const { success, error } = useToast();
  useDocumentTitle('专栏管理', settings.site.name);

  const { data, loading, reload } = useAsync(
    () => api.get<ColumnSummary[]>('/columns/admin').then((r) => r.data),
    [],
  );

  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; id: number } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ColumnSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const rows = data ?? [];

  const openCreate = () => {
    setForm(EMPTY);
    setDialog({ mode: 'create' });
  };

  const openEdit = (column: ColumnSummary) => {
    setForm(toForm(column));
    setDialog({ mode: 'edit', id: column.id });
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dialog) return;
    if (!form.name.trim()) {
      error('专栏名称不能为空');
      return;
    }
    const sortOrder = Number.parseInt(form.sortOrder, 10);
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || undefined,
      description: form.description.trim(),
      coverUrl: form.coverUrl.trim() || null,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
      visible: form.visible,
      showInSidebar: form.showInSidebar,
    };

    setSaving(true);
    try {
      if (dialog.mode === 'create') {
        await api.post('/columns', payload);
        success('专栏已创建');
      } else {
        await api.put(`/columns/${dialog.id}`, payload);
        success('专栏已更新');
      }
      setDialog(null);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/columns/${pendingDelete.id}`);
      success('专栏已删除');
      setPendingDelete(null);
      reload();
    } catch (err) {
      // 非空专栏后端返回 409，这里原样展示，避免把「删除失败」说成模糊错误。
      error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">专栏管理</h1>
          <p className="mt-1 text-sm text-muted">
            {rows.length > 0 ? `共 ${rows.length} 个专栏` : '专栏与博客内容互不混合'}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Icon name="plus" size={16} />
          新建专栏
        </Button>
      </header>

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="columns"
          title="还没有专栏"
          description="创建一个专栏，然后把文章发布到它下面。"
          action={
            <button type="button" onClick={openCreate} className="text-sm font-medium text-brand hover:underline">
              新建专栏
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((column) => (
            <Card key={column.id} className="flex flex-wrap items-start gap-4 p-4">
              <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                {column.cover_url ? (
                  <img src={column.cover_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-faint">
                    <Icon name="columns" size={20} />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/columns/${column.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-fg hover:text-brand"
                  >
                    {column.name}
                  </Link>
                  {column.visible === 1 ? (
                    <Badge tone="success">公开</Badge>
                  ) : (
                    <Badge tone="neutral">隐藏</Badge>
                  )}
                  {column.show_in_sidebar === 1 && <Badge tone="brand">侧栏</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-faint">
                  /columns/{column.slug} · 排序 {column.sort_order}
                </p>
                {column.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{column.description}</p>
                )}
                <p className="mt-1 text-xs text-faint">
                  {column.post_count} 篇文章
                  {column.last_published_at && ` · 最近更新 ${formatDateShort(column.last_published_at)}`}
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(column)} title="编辑">
                  <Icon name="pencil" size={15} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingDelete(column)}
                  title="删除"
                  className="text-danger hover:bg-danger/10 hover:text-danger"
                >
                  <Icon name="trash" size={15} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.mode === 'edit' ? '编辑专栏' : '新建专栏'}
        description="文章只能属于博客或某一个专栏，迁移文章请在文章编辑器里改「发布到」。"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button loading={saving} onClick={() => void submit()}>
              保存
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Input
            label="专栏名称"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="例如：深入 Cloudflare"
            maxLength={80}
            required
            wrapperClassName="sm:col-span-2"
          />
          <Input
            label="Slug（选填）"
            value={form.slug}
            onChange={(e) => set('slug', e.target.value)}
            placeholder="自动生成"
            hint="用于 /columns/{slug}"
            maxLength={120}
          />
          <Input
            label="排序"
            type="number"
            value={form.sortOrder}
            onChange={(e) => set('sortOrder', e.target.value)}
            hint="越小越靠前，同时决定侧栏顺序"
          />
          <Textarea
            label="简介"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="一句话说明这个专栏写什么"
            wrapperClassName="sm:col-span-2"
          />
          <div className="flex flex-col gap-2 sm:col-span-2">
            <span className="text-sm font-medium text-fg">封面图</span>
            {form.coverUrl && (
              <img
                src={form.coverUrl}
                alt="封面预览"
                className="aspect-[21/9] w-full rounded-xl object-cover ring-1 ring-fg/10"
              />
            )}
            <div className="flex gap-2">
              <Input
                value={form.coverUrl}
                onChange={(e) => set('coverUrl', e.target.value)}
                placeholder="图片 URL"
                wrapperClassName="flex-1"
              />
              <Button type="button" variant="secondary" size="sm" onClick={() => setPicker(true)}>
                选择
              </Button>
              {form.coverUrl && (
                <Button type="button" variant="ghost" size="sm" onClick={() => set('coverUrl', '')}>
                  清除
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded-xl bg-surface-2/50 p-3 sm:col-span-2">
            <Switch
              checked={form.visible}
              onChange={(v) => set('visible', v)}
              label="对外可见"
              description="关闭后专栏及其文章不出现在任何公开入口（文章仍可在后台编辑）"
            />
            <Switch
              checked={form.showInSidebar}
              onChange={(v) => set('showInSidebar', v)}
              label="显示在侧栏"
              description="勾选后出现在侧栏「专栏」卡片里，可同时绑定多个专栏"
            />
          </div>
        </form>
      </Modal>

      <MediaPicker
        open={picker}
        onClose={() => setPicker(false)}
        onSelect={(item: MediaItem) => set('coverUrl', item.url)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除专栏"
        description={
          pendingDelete
            ? pendingDelete.post_count > 0
              ? `「${pendingDelete.name}」还有 ${pendingDelete.post_count} 篇文章，需要先把它们移到博客或其他专栏，否则无法删除。`
              : `确定要删除专栏「${pendingDelete.name}」吗？此操作无法撤销。`
            : ''
        }
        confirmLabel="删除"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
