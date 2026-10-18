import { useRef, useState } from 'react';
import type { MediaItem } from '@shared/types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Field';
import { Centered, EmptyState, Skeleton, Spinner } from '../ui/Feedback';
import { Icon } from '../ui/icons';
import { api, qs, uploadMedia } from '../../lib/api';
import { COMPRESS_OPTIONS, compressImage, getCompressLevel, setCompressLevel, type CompressLevel } from '../../lib/image-compress';
import { useAsync } from '../../hooks';
import { useToast } from '../../providers/ToastProvider';

export function MediaPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: MediaItem) => void;
}) {
  const { success, error } = useToast();
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [compress, setCompress] = useState<CompressLevel>(getCompressLevel);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, loading, reload } = useAsync(
    () => api.get<MediaItem[]>(`/media${qs({ page, perPage: 18 })}`),
    [page],
  );

  const items = data?.data ?? [];
  const meta = data?.meta;

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const item = await uploadMedia(await compressImage(file, compress));
      success('上传成功');
      reload();
      onSelect(item);
      onClose();
    } catch (err) {
      error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onCompressChange = (level: CompressLevel) => {
    setCompress(level);
    setCompressLevel(level);
  };

  return (
    <Modal open={open} onClose={onClose} title="选择媒体" description="从媒体库中选择，或上传新图片" className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={15} />
            上传图片
          </Button>
          <Select
            aria-label="压缩质量"
            value={compress}
            onChange={(e) => onCompressChange(e.target.value as CompressLevel)}
            className="w-32 py-1.5 text-xs"
          >
            {COMPRESS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onUpload(file);
          }}
        />
        {meta && <span className="text-xs text-faint">共 {meta.total} 个文件</span>}
      </div>

      {loading && !data ? (
        <Centered className="py-10">
          <Spinner />
        </Centered>
      ) : items.length === 0 ? (
        <EmptyState icon="image" title="媒体库为空" description="上传第一张图片吧。" />
      ) : (
        <div className="grid max-h-[50vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item);
                onClose();
              }}
              className="group overflow-hidden rounded-lg border border-border transition-colors hover:border-brand"
              title={item.filename ?? item.key}
            >
              <img src={item.url} alt={item.filename ?? ''} loading="lazy" className="aspect-square w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {meta && meta.totalPages && meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <Icon name="chevronLeft" size={15} />
            上一页
          </Button>
          <span className="text-xs text-faint">
            {meta.page} / {meta.totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
            <Icon name="chevronRight" size={15} />
          </Button>
        </div>
      )}
    </Modal>
  );
}

export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="aspect-square w-full" />
      ))}
    </div>
  );
}
