import { useEffect, useRef, useState } from 'react';
import type { ApiMeta, MediaItem, MediaUsage } from '@shared/types';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { EmptyState, Spinner } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/icons';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Pagination';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SkeletonGrid } from '../../components/admin/MediaPicker';
import { api, qs, uploadMedia } from '../../lib/api';
import { COMPRESS_OPTIONS, compressImage, getCompressLevel, setCompressLevel, type CompressLevel } from '../../lib/image-compress';
import { useAsync, useDebounced, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';
import { cn } from '../../lib/utils';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isVideo(item: MediaItem): boolean {
  return item.mime.startsWith('video/');
}

export function MediaAdminPage() {
  const { settings } = useSettings();
  const { success, error } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 350);
  const [uploading, setUploading] = useState(false);
  const [compress, setCompress] = useState<CompressLevel>(getCompressLevel);
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
  const [usage, setUsage] = useState<MediaUsage[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useDocumentTitle('媒体库', settings.site.name);

  // Reset to the first page whenever the search term changes.
  useEffect(() => {
    setPage(1);
  }, [q]);

  const { data, loading, reload } = useAsync(
    () => api.get<MediaItem[]>(`/media${qs({ page, perPage: 24, q: q || undefined })}`),
    [page, q],
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
      success(saved > 0 ? `成功上传 ${ok} 个文件,压缩节省 ${humanSize(saved)}` : `成功上传 ${ok} 个文件`);
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
      const absolute = /^https?:\/\//i.test(item.url)
        ? item.url
        : new URL(item.url, window.location.origin).toString();
      await navigator.clipboard.writeText(absolute);
      success('链接已复制');
    } catch {
      error('复制失败');
    }
  };

  /** Load which posts reference this file, then open the confirm dialog. */
  const requestDelete = async (item: MediaItem) => {
    setPendingDelete(item);
    setUsage(null);
    try {
      const { data: rows } = await api.get<MediaUsage[]>(`/media/${item.id}/usage`);
      setUsage(rows);
    } catch {
      // Non-fatal: the dialog still works, just without the reference list.
      setUsage([]);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/media/${pendingDelete.id}`);
      success('已删除');
      setPendingDelete(null);
      setUsage(null);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const deleteDescription = pendingDelete
    ? usage && usage.length > 0
      ? `「${pendingDelete.filename ?? pendingDelete.key}」正被 ${usage.length} 篇文章引用(${usage
          .slice(0, 3)
          .map((p) => `《${p.title}》`)
          .join('、')}${usage.length > 3 ? ' 等' : ''}),删除后这些位置将无法显示。确定继续?`
      : `确定要删除「${pendingDelete.filename ?? pendingDelete.key}」吗?此操作无法撤销。`
    : '';

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">媒体库</h1>
          <p className="mt-1 text-sm text-muted">
            {meta.total != null ? `共 ${meta.total} 个文件` : '管理上传的图片与视频'} · 图片 ≤ 8MB / 视频 ≤ 25MB
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            aria-label="压缩质量"
            value={compress}
            onChange={(e) => onCompressChange(e.target.value as CompressLevel)}
            wrapperClassName="w-36"
          >
            {COMPRESS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Button loading={uploading} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} />
            上传图片 / 视频
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/mp4,video/webm"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void onUpload(e.target.files);
          }}
        />
      </header>

      <div className="mb-4">
        <Input
          type="search"
          placeholder="按文件名搜索..."
          value={search}
          wrapperClassName="w-56"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading && !data ? (
        <SkeletonGrid count={12} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="image"
          title={q ? '没有匹配的文件' : '媒体库为空'}
          description={q ? `没有找到与「${q}」相关的文件。` : '上传图片或视频后，可在文章编辑器中直接引用。'}
          action={
            !q ? (
              <Button onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={16} />
                上传图片 / 视频
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {items.map((item) => (
            <div key={item.id} className="group overflow-hidden rounded-lg border border-border bg-surface">
              <div className="relative aspect-square">
                {isVideo(item) ? (
                  <>
                    {item.thumbnail_url ? (
                      <img
                        src={item.thumbnail_url}
                        alt={item.filename ?? ''}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <video
                        src={`${item.url}#t=0.1`}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    )}
                    <span className="pointer-events-none absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      <Icon name="play" size={10} /> 视频
                    </span>
                  </>
                ) : (
                  <img
                    src={item.url}
                    alt={item.filename ?? ''}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {isVideo(item) && (
                    <button
                      type="button"
                      onClick={() => setPreview(item)}
                      className="flex h-7 w-7 items-center justify-center rounded bg-white/95 text-neutral-900 hover:bg-white"
                      title="预览视频"
                    >
                      <Icon name="play" size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void copyUrl(item)}
                    className="flex h-7 w-7 items-center justify-center rounded bg-white/95 text-neutral-900 hover:bg-white"
                    title="复制链接"
                  >
                    <Icon name="copy" size={14} />
                  </button>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-7 w-7 items-center justify-center rounded bg-white/95 text-neutral-900 hover:bg-white"
                    title={isVideo(item) ? '在新标签页打开视频' : '查看原图'}
                  >
                    <Icon name="externalLink" size={14} />
                  </a>
                  <button
                    type="button"
                    onClick={() => void requestDelete(item)}
                    className="flex h-7 w-7 items-center justify-center rounded bg-danger text-white hover:bg-danger/90"
                    title="删除"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              <div className="px-1.5 py-1">
                <p className="truncate text-[11px] font-medium text-fg" title={item.filename ?? item.key}>
                  {item.filename ?? item.key}
                </p>
                <p className="text-[10px] text-faint">
                  {humanSize(item.size)}
                  {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
                </p>
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
        description={deleteDescription}
        confirmLabel="删除"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => {
          setPendingDelete(null);
          setUsage(null);
        }}
      />

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.filename ?? '视频预览'}
        description={preview ? `${preview.mime} · ${humanSize(preview.size)}` : undefined}
        className="max-w-3xl"
      >
        {preview && (
          <video
            key={preview.id}
            src={preview.url}
            controls
            autoPlay
            playsInline
            className="max-h-[70vh] w-full rounded-lg bg-black"
          />
        )}
      </Modal>

      {uploading && (
        <div className={cn('fixed bottom-5 right-5 flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-pop')}>
          <Spinner />
          <span className="text-sm">正在上传...</span>
        </div>
      )}
    </div>
  );
}