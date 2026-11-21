/**
 * 图片处理策略（纯函数）。
 *
 * 这里只做尺寸/质量/内存预算的计算与缩放，不引入 wasm 编解码器，因此可以在
 * Node 下直接单测；真正的解码、编码在 `image-codec.ts`。
 */

/** 浏览器里能解码、也能重新编码的格式。 */
export type RasterFormat = 'jpeg' | 'png';

/** 图片的像素尺寸。 */
export interface ImageSize {
  width: number;
  height: number;
}

/**
 * 一次图片处理允许占用的内存（字节）。
 *
 * Worker 的内存上限是 128MB，wasm 实例、运行时、请求上下文都要占一份，
 * 所以这里只给位图留 104MB。超了不是「慢一点」，而是 wasm 内存增长失败、
 * Rust 侧 abort，最终只抛出一个 `unreachable`。
 */
export const IMAGE_WORKING_BUDGET_BYTES = 104 * 1024 * 1024;

/** 一张 RGBA 位图的字节数。 */
export function rgbaBytes(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width * height * 4;
}

/**
 * 解码一张图的峰值内存估算。
 *
 * 解码器先在 wasm 堆里生成整张位图，再拷一份到 JS；输入字节同样要拷进 wasm。
 * 缩放改在 JS 里做，所以峰值只出现在解码这一步，约为位图的 2 倍。
 */
export function estimateDecodePeakBytes(width: number, height: number, inputBytes: number): number {
  return rgbaBytes(width, height) * 2 + Math.max(0, inputBytes) * 2;
}

/** 这张图能不能在 Worker 里解码而不把内存撑爆。 */
export function isWithinDecodeBudget(width: number, height: number, inputBytes: number): boolean {
  return estimateDecodePeakBytes(width, height, inputBytes) <= IMAGE_WORKING_BUDGET_BYTES;
}

/** 预算内能解码的最大像素数（用于报错文案里的具体数字）。 */
export function maxDecodablePixels(): number {
  return Math.floor(IMAGE_WORKING_BUDGET_BYTES / 8);
}

/**
 * 纯 JS 的盒式（area average）缩小：把每个目标像素覆盖的源像素求平均。
 *
 * 为什么不用 `@jsquash/resize`：它会把整张源位图再拷进 wasm 堆，
 * 12MP 的图光这一步就要再占 48MB，正好把 Worker 顶穿。JS 版只多分配目标尺寸
 * 的小缓冲区，且缩放后可以立刻丢掉源位图。
 *
 * 只缩小不放大；尺寸相同时直接返回（必要时转成 `Uint8ClampedArray`）。
 */
export function downscaleRgba(
  data: ArrayLike<number>,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Uint8ClampedArray {
  if (srcWidth === dstWidth && srcHeight === dstHeight) {
    return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
  }
  if (srcWidth <= 0 || srcHeight <= 0 || dstWidth <= 0 || dstHeight <= 0) {
    return new Uint8ClampedArray(0);
  }

  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y++) {
    const y0 = Math.min(srcHeight - 1, Math.floor(y * yRatio));
    const y1 = Math.max(y0 + 1, Math.min(srcHeight, Math.floor((y + 1) * yRatio)));
    for (let x = 0; x < dstWidth; x++) {
      const x0 = Math.min(srcWidth - 1, Math.floor(x * xRatio));
      const x1 = Math.max(x0 + 1, Math.min(srcWidth, Math.floor((x + 1) * xRatio)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        let index = (sy * srcWidth + x0) * 4;
        for (let sx = x0; sx < x1; sx++) {
          r += data[index] ?? 0;
          g += data[index + 1] ?? 0;
          b += data[index + 2] ?? 0;
          a += data[index + 3] ?? 0;
          index += 4;
          count++;
        }
      }

      const target = (y * dstWidth + x) * 4;
      out[target] = r / count;
      out[target + 1] = g / count;
      out[target + 2] = b / count;
      out[target + 3] = a / count;
    }
  }
  return out;
}

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