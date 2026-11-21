import { describe, expect, it } from 'vitest';
import { prepareImageForUpload } from '../functions/lib/image-codec';

/** 拼一张只有 PNG 签名 + IHDR 的「图片」：够 `readImageSize` 读尺寸，不会真的解码。 */
function fakePng(width: number, height: number, padding = 0): Uint8Array {
  const header = new Uint8Array(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(header.buffer);
  view.setUint32(8, 13);
  header.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  const out = new Uint8Array(header.length + padding);
  out.set(header);
  return out;
}

describe('prepareImageForUpload', () => {
  it('已经合规的 PNG 直接原样返回，不重新编码', async () => {
    const bytes = fakePng(800, 600);
    const prepared = await prepareImageForUpload(bytes, 'image/png', {
      maxBytes: 900_000,
      maxWidth: 1440,
      quality: 82,
      format: 'auto',
    });

    expect(prepared.reencoded).toBe(false);
    expect(prepared.attempts).toBe(0);
    expect(prepared.bytes).toBe(bytes);
    expect(prepared.mime).toBe('image/png');
    expect(prepared.width).toBe(800);
    expect(prepared.height).toBe(600);
  });

  it('超出解码内存预算的巨图在碰 wasm 之前就被拦下', async () => {
    const bytes = fakePng(20_000, 20_000);
    await expect(
      prepareImageForUpload(bytes, 'image/png', {
        maxBytes: 900_000,
        maxWidth: 1440,
        quality: 82,
        format: 'auto',
      }),
    ).rejects.toThrow(/超出 Worker 单张解码上限/);
  });

  it('GIF 这类无法解码的格式给出可读报错', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
    await expect(
      prepareImageForUpload(gif, 'image/gif', {
        maxBytes: 900_000,
        maxWidth: 1440,
        quality: 82,
        format: 'auto',
      }),
    ).rejects.toThrow(/暂不支持处理 image\/gif/);
  });
});
