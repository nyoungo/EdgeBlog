/**
 * 图片解码 / 缩放 / 编码（@jsquash 的 wasm 编解码器）。
 *
 * 为什么需要它：微信正文图只收 jpg/png 且单张 < 1MB，而文章里的图可能是
 * webp、尺寸过大或体积超限。Workers 里没有 sharp/canvas，只能用 wasm 编解码。
 *
 * wasm 以「模块导入」的方式随 Worker 打包（wrangler 会把 `.wasm` 作为
 * CompiledWasm 上传），再把 `WebAssembly.Module` 交给 jsquash 的 init()。
 * 不能用 jsquash 默认的 fetch(相对 URL) 路径：Workers 里拿不到那个文件。
 */
import { init as initPngDecode, decode as decodePng } from '@jsquash/png/decode.js';
import encodePng, { init as initPngEncode } from '@jsquash/png/encode.js';
import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode.js';
import encodeJpeg, { init as initJpegEncode } from '@jsquash/jpeg/encode.js';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode.js';
import resize, { initResize } from '@jsquash/resize';

// 相对路径是 wrangler 能解析的写法；包名路径会被 module collector 当成相对路径。
// png / resize 两个包自带的 `.wasm.d.ts` 没有 default 导出（与 wrangler 的
// CompiledWasm 模块形状不一致），只能用 @ts-expect-error 让类型检查放行。
// @ts-expect-error 该 wasm 由 wrangler 作为模块导入，默认导出是 WebAssembly.Module
import pngWasm from '../../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import jpegDecWasm from '../../node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import jpegEncWasm from '../../node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm';
import webpDecWasm from '../../node_modules/@jsquash/webp/codec/dec/webp_dec.wasm';
// @ts-expect-error 同上：squoosh_resize_bg.wasm.d.ts 是 wasm-bindgen 的函数声明，没有默认导出
import resizeWasm from '../../node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm';
import { AppError } from './errors';
import { DECODABLE_IMAGE_MIMES, fitDimensions, nextCompressionStep, pickOutputFormat, type RasterFormat } from './image-process';

export interface RasterImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 只初始化一次；同一 isolate 内复用已编译的 wasm 实例。 */
let codecsReady: Promise<void> | null = null;

function ensureCodecs(): Promise<void> {
  codecsReady ??= (async () => {
    await initPngDecode(pngWasm);
    await initPngEncode(pngWasm);
    await initJpegDecode(jpegDecWasm);
    await initJpegEncode(jpegEncWasm);
    await initWebpDecode(webpDecWasm);
    await initResize(resizeWasm);
  })();
  return codecsReady;
}

/** jsquash 的 ImageData 结构统一成 `Uint8ClampedArray`，避免解码器返回 Uint8Array 时缩放出错。 */
function toRaster(image: { data: ArrayLike<number>; width: number; height: number }): RasterImage {
  return {
    data: new Uint8ClampedArray(image.data as ArrayLike<number>),
    width: image.width,
    height: image.height,
  };
}

/** 复制成独立 ArrayBuffer：传入的 bytes 可能是 R2 切片的视图。 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function decodeImage(bytes: Uint8Array, mime: string): Promise<RasterImage> {
  if (!DECODABLE_IMAGE_MIMES.has(mime)) {
    throw AppError.unsupportedMedia(
      `暂不支持处理 ${mime || '未知格式'}，请改用 JPG / PNG / WebP 图片`,
    );
  }
  await ensureCodecs();
  const buffer = toArrayBuffer(bytes);
  if (mime === 'image/jpeg') return toRaster(await decodeJpeg(buffer));
  if (mime === 'image/png') return toRaster(await decodePng(buffer));
  return toRaster(await decodeWebp(buffer));
}

export async function resizeImage(image: RasterImage, width: number, height: number): Promise<RasterImage> {
  if (width === image.width && height === image.height) return image;
  await ensureCodecs();
  return toRaster(await resize(image, { width, height }));
}

export async function encodeImage(image: RasterImage, format: RasterFormat, quality: number): Promise<Uint8Array> {
  await ensureCodecs();
  if (format === 'png') {
    return new Uint8Array(await encodePng(image));
  }
  return new Uint8Array(await encodeJpeg(image, { quality }));
}

export interface CompressOptions {
  /** 目标体积上限（字节）。 */
  maxBytes: number;
  /** 最大宽度；只缩小不放大。 */
  maxWidth: number;
  /** JPEG 初始质量 1-100（PNG 忽略）。 */
  quality: number;
  /** 输出格式；auto 统一转 jpeg。 */
  format?: RasterFormat | 'auto';
}

export interface CompressedImage {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  /** 实际尝试了几次编码（含第一次）。 */
  attempts: number;
}

/**
 * 压缩到目标体积以内：先按最大宽度缩放，再按策略逐步降质量 / 缩尺寸。
 * 到下限仍超限时直接报错，不做「悄悄存个超大图」的降级。
 */
export async function compressImage(
  bytes: Uint8Array,
  mime: string,
  options: CompressOptions,
): Promise<CompressedImage> {
  const source = await decodeImage(bytes, mime);
  const format = pickOutputFormat(options.format);
  const fitted = fitDimensions(source.width, source.height, options.maxWidth);
  let width = fitted.width;
  let height = fitted.height;
  let quality = Math.min(95, Math.max(30, Math.round(options.quality)));

  for (let attempt = 1; attempt <= 10; attempt++) {
    const resized = await resizeImage(source, width, height);
    const output = await encodeImage(resized, format, quality);
    if (output.byteLength <= options.maxBytes) {
      return {
        bytes: output,
        mime: format === 'png' ? 'image/png' : 'image/jpeg',
        width,
        height,
        attempts: attempt,
      };
    }
    const step = nextCompressionStep(width, height, quality, format);
    if (!step) break;
    width = step.width;
    height = step.height;
    quality = step.quality;
  }

  throw AppError.payloadTooLarge(
    `压缩到 ${Math.round(options.maxBytes / 1024)}KB 以内失败，请换一张更小的图片`,
  );
}