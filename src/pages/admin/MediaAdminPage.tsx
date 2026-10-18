import { useRef, useState } from 'react';
import type { ApiMeta, MediaItem } from '@shared/types';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Field';
import { EmptyState, Spinner } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/icons';
import { Pagination } from '../../components/ui/Pagination';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SkeletonGrid } from '../../components/admin/MediaPicker';
import { api, qs, uploadMedia } from '../../lib/api';
import { COMPRESS_OPTIONS, compressImage, getCompressLevel, setCompressLevel, type CompressLevel } from '../../lib/image-compress';
import { useAsync, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';
import { cn } from '../../lib/utils';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaAdminPage() {
  const { settings } = useSettings();
  const { success, error } = useToast();
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [compress, setCompress] = useState<CompressLevel>(getCompressLevel);
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useDocumentTitle('媒体库', settings.site.name);

  const { data, loading, reload } = useAsync(
    () => api.get<MediaItem[]>(`/media${qs({ page, perPage: 24 })}`),
    [page],
  );

  const items = data?.data ?? [];
  const meta: ApiMeta = data?.meta ?? {};

  const onUpload = async (files: FileList) => {
    setUploading(true);
    let ok = 0;
    let saved = 0;
    for (const file of Array.from(files)) {
      try {
        const prepared = await compressImage(file, compress);
        saved += Math.max(0, file.size - prepared.size);
        await uploadMedia(prepared);
        ok += 1;
      } catch (err) {
        error(`${file.name}: ${err instanceof Error ? err.message : '上传失败'}`);
      }
    }
    if (ok > 0) {
      success(saved > 0 ? `成功上传 ${ok} 个文件，压缩节省 ${humanSize(saved)}` : `成功上传 ${ok} 个文件`);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    reload();
  };

  const onCompressChange = (level: CompressLevel) => {
    setCompress(level);
    setCompressLevel(level);
  };

  const copyUrl = async (item: MediaItem) => {
    try {
      await navigator.clipboard.writeText(item.url);
      success('链接已复制');
    } catch {
      error('复制失败');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/media/${pendingDelete.id}`);
      success('已删除');
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
          <h1 className="text-xl font-bold tracking-tight text-fg">媒体库</h1>
          <p className="mt-1 text-sm text-muted">{meta.total != null ? `共 ${meta.total} 个文件` : '管理上传的图片'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            aria-label="压缩质量"
            value={compress}
            onChange={(e) => onCompressChange(e.target.value as CompressLevel)}
            className="w-36"
          >
            {COMPRESS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Button loading={uploading} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} />
            上传图片
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void onUpload(e.target.files);
          }}
        />
      </header>

      {loading && !data ? (
        <SkeletonGrid count={12} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="image"
          title="媒体库为空"
          description="上传图片后，可在文章编辑器中直接引用。"
          action={
            <Button onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={16} />
              上传图片
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="group overflow-hidden rounded-xl border border-border bg-surface">
              <div className="relative aspect-square">
                <img src={item.url} alt={item.filename ?? ''} loading="lazy" className="h-full w-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => void copyUrl(item)}
                    className="flex h-9 w-9 items-center justify-center rounded-md bg-white/90 text-fg hover:bg-white"
                    title="复制链接"
                  >
                    <Icon name="copy" size={16} />
                  </button>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-9 w-9 items-center justify-center rounded-md bg-white/90 text-fg hover:bg-white"
                    title="查看原图"
                  >
                    <Icon name="externalLink" size={16} />
                  </a>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(item)}
                    className="flex h-9 w-9 items-center justify-center rounded-md bg-danger text-white hover:bg-danger/90"
                    title="删除"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-medium text-fg" title={item.filename ?? item.key}>
                  {item.filename ?? item.key}
                </p>
                <p className="mt-0.5 text-xs text-faint">{humanSize(item.size)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination
        className="mt-6"
        page={meta.page ?? 1}
        totalPages={meta.totalPages ?? 1}
        onChange={(p) => {
          setPage(p);
          window.scrollTo({ top: 0 });
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除文件"
        description={pendingDelete ? `确定要删除「${pendingDelete.filename ?? pendingDelete.key}」吗？引用该图片的地方将无法显示。` : ''}
        confirmLabel="删除"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />

      {uploading && (
        <div className={cn('fixed bottom-5 right-5 flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-pop')}>
          <Spinner />
          <span className="text-sm">正在上传…</span>
        </div>
      )}
    </div>
  );
}
