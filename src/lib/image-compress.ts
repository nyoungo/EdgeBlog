/** Client-side image compression: resize + re-encode via canvas before upload. */

export type CompressLevel = 'none' | 'low' | 'medium' | 'high';

export const COMPRESS_OPTIONS: { value: CompressLevel; label: string }[] = [
  { value: 'none', label: '不压缩' },
  { value: 'low', label: '轻度压缩' },
  { value: 'medium', label: '中等压缩' },
  { value: 'high', label: '高度压缩' },
];

const PRESET: Record<Exclude<CompressLevel, 'none'>, { max: number; quality: number }> = {
  low: { max: 2560, quality: 0.85 },
  medium: { max: 1920, quality: 0.72 },
  high: { max: 1280, quality: 0.55 },
};

const LEVELS: CompressLevel[] = ['none', 'low', 'medium', 'high'];
const STORAGE_KEY = 'eb:upload-compress';
const SKIP_TYPES = new Set(['image/gif', 'image/svg+xml']);

export function getCompressLevel(): CompressLevel {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LEVELS as string[]).includes(saved)) return saved as CompressLevel;
  } catch {
    /* storage unavailable */
  }
  return 'medium';
}

export function setCompressLevel(level: CompressLevel): void {
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch {
    /* storage unavailable */
  }
}

let webpSupport: boolean | null = null;

function supportsWebp(): boolean {
  if (webpSupport === null) {
    try {
      webpSupport = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
    } catch {
      webpSupport = false;
    }
  }
  return webpSupport;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片'));
    };
    img.src = url;
  });
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Downscale + re-encode an image file. Non-image and animated/vector types are
 * passed through untouched, and the original is kept whenever the result would
 * be bigger.
 */
export async function compressImage(file: File, level: CompressLevel = getCompressLevel()): Promise<File> {
  if (level === 'none' || !file.type.startsWith('image/') || SKIP_TYPES.has(file.type)) return file;

  const preset = PRESET[level];
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }

  const sourceW = img.naturalWidth || img.width;
  const sourceH = img.naturalHeight || img.height;
  if (sourceW === 0 || sourceH === 0) return file;

  const scale = Math.min(1, preset.max / Math.max(sourceW, sourceH));
  const width = Math.max(1, Math.round(sourceW * scale));
  const height = Math.max(1, Math.round(sourceH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  const type = supportsWebp() ? 'image/webp' : file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await encode(canvas, type, preset.quality);
  if (!blob) return file;
  if (scale === 1 && blob.size >= file.size) return file;

  const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
  const name = `${file.name.replace(/\.[^.]+$/, '') || 'image'}.${ext}`;
  return new File([blob], name, { type, lastModified: Date.now() });
}
