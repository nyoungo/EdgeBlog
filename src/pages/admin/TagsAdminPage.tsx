import { useState, type FormEvent } from 'react';
import type { Tag } from '@shared/types';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Card, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/icons';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api } from '../../lib/api';
import { useAsync, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';

type TagRow = Tag & { post_count: number };

export function TagsAdminPage() {
  const { settings } = useSettings();
  const { success, error } = useToast();
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TagRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useDocumentTitle('标签管理', settings.site.name);

  const { data, loading, reload } = useAsync(
    () => api.get<TagRow[]>('/tags?all=1').then((r) => r.data),
    [],
  );

  const rows = data ?? [];
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? rows.filter((t) => t.name.toLowerCase().includes(needle) || t.slug.toLowerCase().includes(needle))
    : rows;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.post('/tags', { name: name.trim(), slug: slug.trim() || undefined });
      success('标签已创建');
      setName('');
      setSlug('');
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const beginEdit = (tag: TagRow) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditSlug(tag.slug);
  };

  const saveEdit = async (id: number) => {
    if (!editName.trim()) return;
    setSavingEdit(true);
    try {
      await api.put(`/tags/${id}`, { name: editName.trim(), slug: editSlug.trim() || undefined });
      success('标签已更新');
      setEditingId(null);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/tags/${pendingDelete.id}`);
      success('标签已删除');
      setPendingDelete(null);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="w-full max-w-3xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">标签管理</h1>
          <p className="mt-1 text-sm text-muted">{rows.length > 0 ? `共 ${rows.length} 个标签` : '管理文章标签'}</p>
        </div>
        <Input
          type="search"
          placeholder="搜索标签..."
          value={filter}
          wrapperClassName="w-56"
          onChange={(e) => setFilter(e.target.value)}
        />
      </header>

      <Card className="mb-6 p-4">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <Input
            label="新标签名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如:Cloudflare"
            wrapperClassName="flex-1 min-w-40"
            maxLength={50}
            required
          />
          <Input
            label="Slug(选填)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="自动生成"
            wrapperClassName="w-40"
            maxLength={60}
          />
          <Button type="submit" loading={creating}>
            <Icon name="plus" size={16} />
            添加
          </Button>
        </form>
      </Card>

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="tag"
          title={needle ? '没有匹配的标签' : '还没有标签'}
          description={needle ? `没有找到与「${filter}」相关的标签。` : '在上方创建第一个标签。'}
        />
      ) : (
        <Card className="divide-y divide-border">
          {visible.map((tag) => (
            <div key={tag.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {editingId === tag.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    wrapperClassName="flex-1 min-w-40"
                    aria-label="标签名"
                    maxLength={50}
                  />
                  <Input
                    value={editSlug}
                    onChange={(e) => setEditSlug(e.target.value)}
                    wrapperClassName="w-36"
                    aria-label="标签 slug"
                    maxLength={60}
                  />
                  <div className="flex gap-1">
                    <Button size="sm" loading={savingEdit} onClick={() => void saveEdit(tag.id)}>
                      <Icon name="check" size={14} />
                      保存
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      取消
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{tag.name}</p>
                    <p className="truncate text-xs text-faint">
                      /{tag.slug} · {tag.post_count} 篇文章
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => beginEdit(tag)} title="编辑">
                      <Icon name="pencil" size={15} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPendingDelete(tag)}
                      title="删除"
                      className="text-danger hover:bg-danger/10 hover:text-danger"
                    >
                      <Icon name="trash" size={15} />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除标签"
        description={
          pendingDelete
            ? `确定要删除标签「${pendingDelete.name}」吗?${pendingDelete.post_count > 0 ? `它会从 ${pendingDelete.post_count} 篇文章上移除,文章本身不会被删除。` : ''}`
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