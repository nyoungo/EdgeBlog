import { describe, expect, it } from 'vitest';
import { readImageSize } from '../functions/lib/image-size';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((part) => (part instanceof Uint8Array ? part : new Uint8Array(part)));
  const total = arrays.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of arrays) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('readImageSize', () => {
  it('读 PNG 的 IHDR', () => {
    const png = concat(PNG_SIGNATURE, u32be(13), [0x49, 0x48, 0x44, 0x52], u32be(1920), u32be(1080));
    expect(readImageSize(png)).toEqual({ width: 1920, height: 1080 });
  });

  it('跳过 JPEG 的 APPn 段再读 SOF0', () => {
    const app0 = concat([0xff, 0xe0], u16be(16), new Uint8Array(14));
    const sof0 = concat([0xff, 0xc0], u16be(17), [8], u16be(3024), u16be(4032), [3]);
    const jpeg = concat([0xff, 0xd8], app0, sof0, [0xff, 0xd9]);
    expect(readImageSize(jpeg)).toEqual({ width: 4032, height: 3024 });
  });

  it('遇到 DHT 之类的非 SOF 段不会误判尺寸', () => {
    const dht = concat([0xff, 0xc4], u16be(20), new Uint8Array(18));
    const sof2 = concat([0xff, 0xc2], u16be(17), [8], u16be(600), u16be(800), [3]);
    const jpeg = concat([0xff, 0xd8], dht, sof2, [0xff, 0xd9]);
    expect(readImageSize(jpeg)).toEqual({ width: 800, height: 600 });
  });

  it('读 WebP 的 VP8X 画布尺寸', () => {
    const vp8x = concat(
      [0x52, 0x49, 0x46, 0x46],
      [0, 0, 0, 0],
      [0x57, 0x45, 0x42, 0x50],
      [0x56, 0x50, 0x38, 0x58],
      [10, 0, 0, 0],
      [0, 0, 0, 0],
      u24le(1279),
      u24le(719),
    );
    expect(readImageSize(vp8x)).toEqual({ width: 1280, height: 720 });
  });

  it('读 WebP 的 VP8L 位宽', () => {
    const bits = ((640 - 1) & 0x3fff) | (((360 - 1) & 0x3fff) << 14);
    const vp8l = concat(
      [0x52, 0x49, 0x46, 0x46],
      [0, 0, 0, 0],
      [0x57, 0x45, 0x42, 0x50],
      [0x56, 0x50, 0x38, 0x4c],
      [5, 0, 0, 0],
      [0x2f],
      [(bits >>> 0) & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff],
    );
    expect(readImageSize(vp8l)).toEqual({ width: 640, height: 360 });
  });

  it('读 WebP 的 VP8 有损帧头', () => {
    const vp8 = concat(
      [0x52, 0x49, 0x46, 0x46],
      [0, 0, 0, 0],
      [0x57, 0x45, 0x42, 0x50],
      [0x56, 0x50, 0x38, 0x20],
      [10, 0, 0, 0],
      [0, 0, 0],
      [0x9d, 0x01, 0x2a],
      u16le(1000),
      u16le(500),
    );
    expect(readImageSize(vp8)).toEqual({ width: 1000, height: 500 });
  });

  it('读 GIF / BMP 尺寸', () => {
    expect(readImageSize(concat([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], u16le(320), u16le(240)))).toEqual({
      width: 320,
      height: 240,
    });
    const bmp = concat([0x42, 0x4d], new Uint8Array(16), u32be(800), u32be(600));
    expect(readImageSize(bmp)).toEqual({ width: 800, height: 600 });
  });

  it('认不出的格式返回 null', () => {
    expect(readImageSize(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16))).toBeNull();
    expect(readImageSize(new Uint8Array(4))).toBeNull();
  });
});
