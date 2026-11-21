/**
 * 图片解码 / 缩放 / 编码（@jsquash 的 wasm 编解码器）。
 *
 * 为什么需要它：微信正文图只收 jpg/png 且单张 < 1MB，而文章里的图可能是
 * webp、尺寸过大或体积超限。Workers 里没有 sharp/canvas，只能用 wasm 编解码。
 *
 * wasm 以「模块导入」的方式随 Worker 打包（wrangler 会把 `.wasm` 作为
 * CompiledWasm 上传），再把 `WebAssembly.Module` 交给 jsquash 的 init()。
 * 不能用 jsquash 默认的 fetch(相对 URL) 路径：Workers 里拿不到那个文件。
 *
 * 内存是这个模块的主要约束（Worker 上限 128MB）：
 *   * 缩放自己用 JS 做（`downscaleRgba`），不用 `@jsquash/resize`——后者会把
 *     整张源位图再拷进 wasm 堆，12MP 的图光这一步就要多占 48MB；
 *   * 解码前先按文件头尺寸做预算检查（`image-size.ts`），超预算直接给出
 *     可读的报错。wasm 内存增长失败在 Rust 侧只会抛一个 `unreachable`，
 *     既看不出原因，还会把 isolate 里的 wasm 实例弄坏；
 *   * 解码结果不整张复制：jsquash 的 jpeg/webp 解码器返回的是 wasm 堆里的
 *     视图（不是副本），直接读它做缩放即可，省下一整份位图。
 */
import { init as initPngDecode, decode as decodePng } from '@jsquash/png/decode.js';
import encodePng, { init as initPngEncode } from '@jsquash/png/encode.js';
import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode.js';
import encodeJpeg, { init as initJpegEncode } from '@jsquash/jpeg/encode.js';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode.js';

// 相对路径是 wrangler 能解析的写法；包名路径会被 module collector 当成相对路径。
// png 包自带的 `.wasm.d.ts` 没有 default 导出（与 wrangler 的 CompiledWasm
// 模块形状不一致），只能用 @ts-expect-error 让类型检查放行。
// @ts-expect-error 该 wasm 由 wrangler 作为模块导入，默认导出是 WebAssembly.Module
import pngWasm from '../../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import jpegDecWasm from '../../node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import jpegEncWasm from '../../node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm';
import webpDecWasm from '../../node_modules/@jsquash/webp/codec/dec/webp_dec.wasm';
import { AppError } from './errors';
import { readImageSize } from './image-size';
import {
  DECODABLE_IMAGE_MIMES,
  downscaleRgba,
  fitDimensions,
  isWithinDecodeBudget,
  maxDecodablePixels,
  nextCompressionStep,
  pickOutputFormat,
  type ImageSize,
  type RasterFormat,
} from './image-process';

/** 解码后的位图：`data` 可能直接是 wasm 堆里的视图，读之前不要跨模块再调 wasm。 */
export interface DecodedImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** 待编码的位图：一定是 JS 自己持有的缓冲区。 */
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
  })().catch((err: unknown) => {
    // 失败的初始化不能缓存：否则这个 isolate 之后每次图片处理都会报同一个错
    codecsReady = null;
    throw err;
  });
  return codecsReady;
}

/**
 * 串行化所有 wasm 调用。
 *
 * jsquash 的编解码器是 isolate 级的单例：同一个 wasm 实例、同一块线性内存。
 * 两个请求并发解码时，A 拿到的视图会被 B 的调用覆盖，轻则图片花屏，
 * 重则越界读到垃圾数据触发 `unreachable`。
 */
let wasmChain: Promise<unknown> = Promise.resolve();

function withWasmLock<T>(task: () => Promise<T>): Promise<T> {
  const next = wasmChain.then(task, task);
  // 队列只用来排队，不传播上一次的失败
  wasmChain = next.catch(() => undefined);
  return next;
}

/** 把 wasm 侧的错误翻译成能看懂的报错。 */
function toImageError(err: unknown, stage: string): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  // Rust/wasm-bindgen 的内存分配失败只会抛 `unreachable`（abort），没有任何上下文
  if (/unreachable|out of bounds|RuntimeError|memory access/i.test(message)) {
    return AppError.payloadTooLarge(
      `图片在${stage}时超出 Worker 内存上限（单张约 ${Math.round(maxDecodablePixels() / 1000)} 千像素封顶），` +
        '请先裁剪或缩小这张图再试',
    );
  }
  return AppError.unsupportedMedia(
    `图片${stage}失败（${message}）：可能是动图或文件已损坏，请换一张静态 JPG / PNG 图片`,
  );
}

async function runWasm<T>(stage: string, task: () => Promise<T> | T): Promise<T> {
  try {
    return await task();
  } catch (err) {
    throw toImageError(err, stage);
  }
}

/** 复制成独立 ArrayBuffer：传入的 bytes 可能是 R2 切片的视图。 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** 解码前的内存预算检查：能提前拦住就不让 wasm 去撞内存墙。 */
function assertDecodeBudget(size: ImageSize | null, inputBytes: number): void {
  if (!size) return;
  if (isWithinDecodeBudget(size.width, size.height, inputBytes)) return;
  const megapixels = ((size.width * size.height) / 1_000_000).toFixed(1);
  throw AppError.payloadTooLarge(
    `图片 ${size.width}×${size.height}（约 ${megapixels} 百万像素）超出 Worker 单张解码上限` +
      `（约 ${Math.round(maxDecodablePixels() / 1_000_000)} 百万像素），请先裁剪或缩小后再上传`,
  );
}

/**
 * 解码图片。返回的 `data` 可能指向 wasm 堆（jpeg / webp 解码器不复制），
 * 调用方要么立刻缩放出自己的缓冲区，要么在同一次加锁里用完就丢。
 */
export async function decodeImage(bytes: Uint8Array, mime: string): Promise<DecodedImage> {
  if (!DECODABLE_IMAGE_MIMES.has(mime)) {
    throw AppError.unsupportedMedia(
      `暂不支持处理 ${mime || '未知格式'}，请改用 JPG / PNG / WebP 图片`,
    );
  }
  await ensureCodecs();
  const buffer = toArrayBuffer(bytes);
  const decoded = await runWasm('解码', async () => {
    if (mime === 'image/jpeg') return decodeJpeg(buffer);
    if (mime === 'image/png') return decodePng(buffer);
    return decodeWebp(buffer);
  });
  if (!decoded || !decoded.width || !decoded.height) {
    throw AppError.unsupportedMedia('图片解码失败：没有读到有效的图像数据，请换一张图片');
  }
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}

/** 编码成 JPEG / PNG 字节。 */
export async function encodeImage(
  image: RasterImage,
  format: RasterFormat,
  quality: number,
): Promise<Uint8Array> {
  await ensureCodecs();
  return runWasm('编码', async () => {
    if (format === 'png') return new Uint8Array(await encodePng(image));
    return new Uint8Array(await encodeJpeg(image, { quality }));
  });
}

/** 缩到指定尺寸；尺寸相同时不复制。 */
function downscaleTo(image: DecodedImage, width: number, height: number): RasterImage {
  const data = downscaleRgba(image.data, image.width, image.height, width, height);
  return { data, width, height };
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
  /** 原图尺寸，用于给用户看「压了多少」。 */
  sourceWidth: number;
  sourceHeight: number;
}

/** 编码重试次数上限；再压不下去就是真的压不动了。 */
const MAX_COMPRESSION_ATTEMPTS = 8;

function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return 82;
  return Math.min(95, Math.max(30, Math.round(quality)));
}

/**
 * 压缩到目标体积以内：先按最大宽度缩放（JS 盒式缩放，不额外占 wasm 内存），
 * 再按策略逐步降质量 / 缩尺寸。
 *
 * 到下限仍超限时直接报错，不做「悄悄存个超大图」的降级。
 */
export async function compressImage(
  bytes: Uint8Array,
  mime: string,
  options: CompressOptions,
): Promise<CompressedImage> {
  if (!DECODABLE_IMAGE_MIMES.has(mime)) {
    throw AppError.unsupportedMedia(
      `暂不支持处理 ${mime || '未知格式'}，请改用 JPG / PNG / WebP 图片`,
    );
  }
  // 先按文件头尺寸拦一道：认不出格式时交给解码器，失败会翻译成可读报错
  assertDecodeBudget(readImageSize(bytes), bytes.byteLength);

  return withWasmLock(async () => {
    const decoded = await decodeImage(bytes, mime);
    const sourceWidth = decoded.width;
    const sourceHeight = decoded.height;
    assertDecodeBudget({ width: sourceWidth, height: sourceHeight }, 0);

    const format = pickOutputFormat(options.format);
    const fitted = fitDimensions(sourceWidth, sourceHeight, options.maxWidth);
    let width = fitted.width;
    let height = fitted.height;
    let quality = clampQuality(options.quality);

    // 原图只在这里被读一次，之后就只留缩放后的小图
    let bitmap = downscaleTo(decoded, width, height);

    for (let attempt = 1; attempt <= MAX_COMPRESSION_ATTEMPTS; attempt++) {
      const output = await encodeImage(bitmap, format, quality);
      if (output.byteLength <= options.maxBytes) {
        return {
          bytes: output,
          mime: format === 'png' ? 'image/png' : 'image/jpeg',
          width,
          height,
          attempts: attempt,
          sourceWidth,
          sourceHeight,
        };
      }
      const step = nextCompressionStep(width, height, quality, format);
      if (!step) break;
      quality = step.quality;
      width = step.width;
      height = step.height;
      // 从当前小图继续缩，不再回头读原图
      bitmap = downscaleTo(bitmap, width, height);
    }

    throw AppError.payloadTooLarge(
      `压缩到 ${Math.round(options.maxBytes / 1024)}KB 以内失败（已降到 ${width}×${height}），请换一张更小的图片`,
    );
  });
}

export interface UploadReadyImage extends CompressedImage {
  /** 是否真的重新编码过；false 表示原图本来就符合要求。 */
  reencoded: boolean;
  /** 原图字节数，用于展示压缩前后的对比。 */
  sourceBytes: number;
}

/**
 * 上传前的一次性处理：符合要求就原样上传，否则「解码 → 缩放 → 压缩」再上传。
 *
 * 这是「先压缩再入库」的唯一入口：压缩结果只产生一次，直接写媒体库，
 * 不存在「先传原图、再压一份替换」的两步流程。
 */
export async function prepareImageForUpload(
  bytes: Uint8Array,
  mime: string,
  options: CompressOptions,
): Promise<UploadReadyImage> {
  const size = readImageSize(bytes);
  const target = pickOutputFormat(options.format);
  // auto 不强制转格式：本来就合规的 PNG 不该被重编码成 JPEG（会丢透明通道）
  const formatOk =
    options.format === 'auto' || options.format === undefined
      ? mime === 'image/jpeg' || mime === 'image/png'
      : mime === (target === 'png' ? 'image/png' : 'image/jpeg');

  if (size && formatOk && bytes.byteLength <= options.maxBytes && size.width <= options.maxWidth) {
    return {
      bytes,
      mime,
      width: size.width,
      height: size.height,
      attempts: 0,
      sourceWidth: size.width,
      sourceHeight: size.height,
      sourceBytes: bytes.byteLength,
      reencoded: false,
    };
  }

  const compressed = await compressImage(bytes, mime, options);
  return { ...compressed, sourceBytes: bytes.byteLength, reencoded: true };
}
