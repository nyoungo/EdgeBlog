import { useEffect, useRef, useState } from 'react';
import type { ApiMeta, MediaCleanupResult, MediaItem, MediaUsage } from '@shared/types';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { EmptyState, Spinner } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/icons';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Pagination';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SkeletonGrid } from '../../components/admin/MediaPicker';
import { api, qs, uploadMedia } from '../../lib/api';
import { COMPRESS_OPTIONS, FORMAT_OPTIONS, compressImage, getCompressLevel, getImageFormat, setCompressLevel, setImageFormat, type CompressLevel, type ImageFormat } from '../../lib/image-compress';
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
  const [usageFilter, setUsageFilter] = useState<'' | 'used' | 'unused'>('');
  const [uploading, setUploading] = useState(false);
  const [compress, setCompress] = useState<CompressLevel>(getCompressLevel);
  const [format, setFormat] = useState<ImageFormat>(getImageFormat);
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
  const [usage, setUsage] = useState<MediaUsage[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupDone, setCleanupDone] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useDocumentTitle('媒体库', settings.site.name);

  // Reset to the first page whenever the search term or filter changes.
  useEffect(() => {
    setPage(1);
  }, [q, usageFilter]);

  const { data, loading, reload } = useAsync(
    () =>
      api.get<MediaItem[]>(
        `/media${qs({ page, perPage: 24, q: q || undefined, usage: usageFilter || undefined, stats: 1 })}`,
      ),
    [page, q, usageFilter],
  );

  const items = data?.data ?? [];
  const meta: ApiMeta = data?.meta ?? {};
  const unusedCount = meta.unused ?? 0;

  const onUpload = async (files: FileList) => {
    setUploading(true);
    let ok = 0;
    let saved = 0;
    for (const file of Array.from(files)) {
      try {
        const prepared = await compressImage(file, compress, format);
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

  const onFormatChange = (value: ImageFormat) => {
    setFormat(value);
    setImageFormat(value);
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

  /**
   * 分批清理未使用媒体。服务端一次最多删 30 个（免费版子请求上限），
   * 所以这里循环调用，直到 `remaining` 为 0。
   */
  const runCleanup = async () => {
    setCleaning(true);
    setCleanupDone(0);
    let deleted = 0;
    let freed = 0;
    try {
      for (let round = 0; round < 200; round += 1) {
        const { data: result } = await api.post<MediaCleanupResult>('/media/cleanup-unused?limit=20');
        deleted += result.deleted;
        freed += result.freedBytes;
        setCleanupDone(deleted);
        if (result.deleted === 0 || result.remaining === 0) break;
      }
      success(
        deleted > 0
          ? `已清理 ${deleted} 个未使用文件，释放 ${humanSize(freed)}`
          : '没有可清理的文件',
      );
      setCleanupOpen(false);
    } catch (err) {
      error(err instanceof Error ? err.message : '清理失败');
    } finally {
      setCleaning(false);
      setCleanupDone(0);
      reload();
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
            {unusedCount > 0 ? ` · ${unusedCount} 个未使用` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="图片格式"
            title="图片上传格式"
            value={format}
            onChange={(e) => onFormatChange(e.target.value as ImageFormat)}
            wrapperClassName="w-32"
          >
            {FORMAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
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
          <Button
            variant="secondary"
            disabled={unusedCount === 0 || uploading || cleaning}
            onClick={() => setCleanupOpen(true)}
            title={unusedCount === 0 ? '没有未使用的文件' : `清理 ${unusedCount} 个未使用文件`}
          >
            <Icon name="trash" size={16} />
            清理未使用{unusedCount > 0 ? ` (${unusedCount})` : ''}
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

      {meta.usageError && (
        <p className="mb-4 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
          未使用统计不可用，文件仍可正常管理：{meta.usageError}
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          type="search"
          placeholder="按文件名搜索..."
          value={search}
          wrapperClassName="w-56"
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={usageFilter}
          onChange={(e) => setUsageFilter(e.target.value as '' | 'used' | 'unused')}
          wrapperClassName="w-40"
          aria-label="按使用状态筛选"
        >
          <option value="">全部文件</option>
          <option value="unused">仅未使用</option>
          <option value="used">仅使用中</option>
        </Select>
      </div>

      {loading && !data ? (
        <SkeletonGrid count={24} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="image"
          title={q ? '没有匹配的文件' : usageFilter === 'unused' ? '没有未使用的文件' : '媒体库为空'}
          description={
            q
              ? `没有找到与「${q}」相关的文件。`
              : usageFilter === 'unused'
                ? '当前所有媒体都被文章、专栏或设置引用。'
                : '上传图片或视频后，可在文章编辑器中直接引用。'
          }
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
            <div key={item.id} className="group overflow-hidden rounded-3xl bg-surface shadow-lift">
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
                {item.in_use === 0 && (
                  <span className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-warning/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    未使用
                  </span>
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

      <ConfirmDialog
        open={cleanupOpen}
        title="清理未使用媒体"
        description={
          cleaning
            ? `正在清理，已删除 ${cleanupDone} 个文件，请勿关闭页面。`
            : `将永久删除 ${unusedCount} 个未在文章正文、封面、OG、专栏、定时任务或站点设置里出现的文件（约 ${humanSize(meta.unusedBytes ?? 0)}）。此操作无法撤销。`
        }
        confirmLabel={cleaning ? '清理中…' : '开始清理'}
        danger
        loading={cleaning}
        onConfirm={() => void runCleanup()}
        onClose={() => {
          if (!cleaning) setCleanupOpen(false);
        }}
      />

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.filename ?? '视频预览'}
        description={
          preview
            ? `${preview.mime} · ${humanSize(preview.size)}${preview.in_use === 0 ? ' · 未使用' : ''}`
            : undefined
        }
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
        <div className={cn('fixed bottom-5 right-5 flex items-center gap-2 rounded-xl bg-surface px-4 py-3 shadow-pop ring-1 ring-fg/5')}>
          <Spinner />
          <span className="text-sm">正在上传...</span>
        </div>
      )}
    </div>
  );
}