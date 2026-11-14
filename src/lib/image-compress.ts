/** Client-side image compression: resize + re-encode via canvas before upload. */

export type CompressLevel = 'none' | 'low' | 'medium' | 'high';

export const COMPRESS_OPTIONS: { value: CompressLevel; label: string }[] = [
  { value: 'none', label: '不压缩' },
  { value: 'low', label: '轻度压缩' },
  { value: 'medium', label: '中等压缩' },
  { value: 'high', label: '高度压缩' },
];

/** 上传后的图片格式:保留原编码,或显式转成 WebP。 */
export type ImageFormat = 'original' | 'webp';

export const FORMAT_OPTIONS: { value: ImageFormat; label: string }[] = [
  { value: 'original', label: '原格式' },
  { value: 'webp', label: '转为 WebP' },
];

const PRESET: Record<Exclude<CompressLevel, 'none'>, { max: number; quality: number }> = {
  low: { max: 2560, quality: 0.85 },
  medium: { max: 1920, quality: 0.72 },
  high: { max: 1280, quality: 0.55 },
};

/** 仅转格式、不改尺寸时的编码质量。 */
const CONVERT_QUALITY = 0.9;

/** canvas 能稳定编码的类型,其余(AVIF/BMP/GIF/SVG)无法原格式重编码。 */
const ENCODABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const LEVELS: CompressLevel[] = ['none', 'low', 'medium', 'high'];
const FORMATS: ImageFormat[] = ['original', 'webp'];
const STORAGE_KEY = 'eb:upload-compress';
const FORMAT_KEY = 'eb:upload-format';
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

export function getImageFormat(): ImageFormat {
  try {
    const saved = localStorage.getItem(FORMAT_KEY);
    if (saved && (FORMATS as string[]).includes(saved)) return saved as ImageFormat;
  } catch {
    /* storage unavailable */
  }
  return 'original';
}

export function setImageFormat(format: ImageFormat): void {
  try {
    localStorage.setItem(FORMAT_KEY, format);
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
 * Downscale + re-encode an image file before upload.
 *
 * `level` 控制尺寸与质量,`format` 决定编码目标:默认 `original` 保留原格式
 * (JPG→JPG、PNG→PNG),`webp` 才显式转成 WebP。非图片、动画/矢量图层
 * (GIF/SVG)以及 canvas 无法原格式重编码的类型(AVIF/BMP)一律原样上传;
 * `level !== 'none'` 时若重编码结果反而更大,仍保留原文件。
 */
export async function compressImage(
  file: File,
  level: CompressLevel = getCompressLevel(),
  format: ImageFormat = getImageFormat(),
): Promise<File> {
  if (!file.type.startsWith('image/') || SKIP_TYPES.has(file.type)) return file;

  const convert = format === 'webp' && file.type !== 'image/webp' && supportsWebp();
  // 完全不处理的情形:不转格式、且要么不压缩、要么源类型无法重编码。
  if (level === 'none' && !convert) return file;
  if (!convert && !ENCODABLE_TYPES.has(file.type)) return file;

  const preset =
    level === 'none' ? { max: Number.POSITIVE_INFINITY, quality: CONVERT_QUALITY } : PRESET[level];
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }

  const sourceW = img.naturalWidth || img.width;
  const sourceH = img.naturalHeight || img.height;
  if (sourceW === 0 || sourceH === 0) return file;

  const scale = Number.isFinite(preset.max) ? Math.min(1, preset.max / Math.max(sourceW, sourceH)) : 1;
  const width = Math.max(1, Math.round(sourceW * scale));
  const height = Math.max(1, Math.round(sourceH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  const type = convert ? 'image/webp' : file.type;
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await encode(canvas, type, preset.quality);
  if (!blob) return file;
  // 显式转格式时尊重用户选择;仅压缩时若没变小则保留原文件。
  if (!convert && scale === 1 && blob.size >= file.size) return file;

  const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
  const name = `${file.name.replace(/\.[^.]+$/, '') || 'image'}.${ext}`;
  return new File([blob], name, { type, lastModified: Date.now() });
}
