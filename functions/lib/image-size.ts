/**
 * 从文件头读图片尺寸（不解码像素）。
 *
 * 为什么需要：Worker 只有 128MB 内存，解码一张 RGBA 位图要 宽×高×4 字节，
 * 而 wasm 解码器内部还会再放一份。图片太大时 wasm 的内存增长会失败，
 * 表现为 `RuntimeError: unreachable`（Rust 侧 abort），既看不出原因，
 * 也会把 isolate 里的 wasm 实例搞坏。所以解码前先按头部尺寸做预算检查。
 *
 * 只认得出下面几种格式，认不出返回 null（调用方回落到「先解码、出错再说」）。
 */
import type { ImageSize } from './image-process';

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function startsWith(bytes: Uint8Array, offset: number, ascii: string): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

function valid(width: number, height: number): ImageSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** PNG：签名之后紧跟 IHDR，宽高是 16/20 处的大端 32 位。 */
function readPng(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24 || !startsWith(bytes, 12, 'IHDR')) return null;
  return valid(u32be(bytes, 16), u32be(bytes, 20));
}

/** SOFn 段里带着真实尺寸；DHT/JPG/DAC 不是 SOFn，必须排除。 */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** JPEG：逐段跳过 APPn/量化表等，找到 SOFn 再读高宽。 */
function readJpeg(bytes: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xff) {
      i++;
      continue;
    }
    // 无长度的独立标记：TEM、RSTn、SOI
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // EOI / SOS 之后是熵编码数据，不会再出现尺寸
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(bytes, i + 2);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      // FF Cx | len(2) | 精度(1) | 高(2) | 宽(2)
      return valid(u16be(bytes, i + 7), u16be(bytes, i + 5));
    }
    i += 2 + length;
  }
  return null;
}

/** WebP：VP8（有损）/ VP8L（无损）/ VP8X（扩展，画布尺寸）三种头。 */
function readWebp(bytes: Uint8Array): ImageSize | null {
  // RIFF(0-3) + size(4-7) + 'WEBP'(8-11) + fourCC(12-15) + chunkSize(16-19)
  if (bytes.length < 25 || !startsWith(bytes, 8, 'WEBP')) return null;
  const data = 20;
  if (startsWith(bytes, 12, 'VP8X')) {
    if (bytes.length < 30) return null;
    return valid(1 + u24le(bytes, data + 4), 1 + u24le(bytes, data + 7));
  }
  if (startsWith(bytes, 12, 'VP8L')) {
    if (bytes[data] !== 0x2f) return null;
    const bits =
      (bytes[data + 1] ?? 0) |
      ((bytes[data + 2] ?? 0) << 8) |
      ((bytes[data + 3] ?? 0) << 16) |
      ((bytes[data + 4] ?? 0) << 24);
    return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (startsWith(bytes, 12, 'VP8 ')) {
    if (bytes.length < 30) return null;
    if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
      return null;
    }
    return valid(u16le(bytes, data + 6) & 0x3fff, u16le(bytes, data + 8) & 0x3fff);
  }
  return null;
}

/** GIF / BMP 不在可解码格式里，但读一下尺寸能给出更准确的报错。 */
function readGifOrBmp(bytes: Uint8Array): ImageSize | null {
  if (startsWith(bytes, 0, 'GIF8') && bytes.length >= 10) {
    return valid(u16le(bytes, 6), u16le(bytes, 8));
  }
  if (startsWith(bytes, 0, 'BM') && bytes.length >= 26) {
    // 高度可能是负数（自上而下存），取绝对值
    return valid(u32be(bytes, 18), Math.abs(u32be(bytes, 22) | 0));
  }
  return null;
}

/** 读图片的像素尺寸；认不出格式时返回 null。 */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  // GIF 头只有 10 字节，其余格式各自再做长度检查
  if (bytes.length < 10) return null;
  if (bytes[0] === 0x89 && startsWith(bytes, 1, 'PNG')) return readPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes);
  if (startsWith(bytes, 0, 'RIFF')) return readWebp(bytes);
  return readGifOrBmp(bytes);
}
