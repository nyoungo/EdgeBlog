/**
 * 图片处理策略（纯函数）。
 *
 * 这里只做尺寸/质量的计算，不引入 wasm 编解码器，因此可以在 Node 下直接单测；
 * 真正的解码、缩放、编码在 `image-codec.ts`。
 */

/** 浏览器里能解码、也能重新编码的格式。 */
export type RasterFormat = 'jpeg' | 'png';

/** 能解码的输入格式（GIF/BMP/AVIF 暂不支持）。 */
export const DECODABLE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 等比缩放到不超过 maxWidth；只缩小，不放大。 */
export function fitDimensions(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  if (maxWidth <= 0 || width <= maxWidth) return { width, height };
  const scale = maxWidth / width;
  return { width: Math.max(1, Math.round(maxWidth)), height: Math.max(1, Math.round(height * scale)) };
}

/** 输出格式：显式指定优先；`auto` 统一转 jpeg（照片体积最小，微信也接受）。 */
export function pickOutputFormat(requested?: RasterFormat | 'auto'): RasterFormat {
  if (requested === 'jpeg' || requested === 'png') return requested;
  return 'jpeg';
}

export interface CompressionStep {
  width: number;
  height: number;
  quality: number;
}

/** 单次压缩仍超限时，下一次该用什么参数；返回 null 表示已到下限。 */
export function nextCompressionStep(
  width: number,
  height: number,
  quality: number,
  format: RasterFormat,
): CompressionStep | null {
  if (width <= 320) return null;
  // JPEG 先降质量（几乎不损失观感），质量降到 55 之后再缩尺寸。
  if (format === 'jpeg' && quality > 55) {
    return { width, height, quality: Math.max(55, quality - 10) };
  }
  return {
    width: Math.max(1, Math.round(width * 0.8)),
    height: Math.max(1, Math.round(height * 0.8)),
    quality,
  };
}

/** 人类可读的体积，用于工具返回与报错。 */
export function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}