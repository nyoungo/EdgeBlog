import { describe, expect, it } from 'vitest';
import {
  downscaleRgba,
  estimateDecodePeakBytes,
  fitDimensions,
  formatBytes,
  isWithinDecodeBudget,
  maxDecodablePixels,
  nextCompressionStep,
  pickOutputFormat,
  rgbaBytes,
} from '../functions/lib/image-process';

describe('fitDimensions', () => {
  it('等比缩放到最大宽度以内', () => {
    expect(fitDimensions(3000, 2000, 1440)).toEqual({ width: 1440, height: 960 });
    expect(fitDimensions(1000, 4000, 500)).toEqual({ width: 500, height: 2000 });
  });

  it('只缩小不放大', () => {
    expect(fitDimensions(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });

  it('非法尺寸兜底为 1x1,避免解码器崩溃', () => {
    expect(fitDimensions(0, 100, 1440)).toEqual({ width: 1, height: 1 });
    expect(fitDimensions(Number.NaN, 100, 1440)).toEqual({ width: 1, height: 1 });
  });
});

describe('pickOutputFormat', () => {
  it('auto / 未指定统一转 jpeg', () => {
    expect(pickOutputFormat()).toBe('jpeg');
    expect(pickOutputFormat('auto')).toBe('jpeg');
  });

  it('显式指定优先', () => {
    expect(pickOutputFormat('png')).toBe('png');
    expect(pickOutputFormat('jpeg')).toBe('jpeg');
  });
});

describe('nextCompressionStep', () => {
  it('JPEG 先降质量,质量不再下降后才缩尺寸', () => {
    expect(nextCompressionStep(1440, 900, 82, 'jpeg')).toEqual({
      width: 1440,
      height: 900,
      quality: 72,
    });
    // 质量已到下限:改为缩尺寸,质量保持不变
    expect(nextCompressionStep(1440, 900, 55, 'jpeg')).toEqual({
      width: 1152,
      height: 720,
      quality: 55,
    });
  });

  it('PNG 没有质量档,直接缩尺寸', () => {
    expect(nextCompressionStep(1000, 500, 90, 'png')).toEqual({
      width: 800,
      height: 400,
      quality: 90,
    });
  });

  it('宽度到 320 就停手,避免压成缩略图', () => {
    expect(nextCompressionStep(320, 200, 55, 'jpeg')).toBeNull();
    expect(nextCompressionStep(320, 200, 90, 'png')).toBeNull();
  });
});

describe('formatBytes', () => {
  it('小于 1MB 用 KB,且不会出现 0KB', () => {
    expect(formatBytes(10)).toBe('1KB');
    expect(formatBytes(900 * 1024)).toBe('900KB');
  });

  it('大于等于 1MB 用 MB,保留两位小数', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.50MB');
  });
});

describe('内存预算', () => {
  it('RGBA 位图按 4 字节/像素计算', () => {
    expect(rgbaBytes(100, 50)).toBe(20_000);
    expect(rgbaBytes(0, 50)).toBe(0);
    expect(rgbaBytes(Number.NaN, 50)).toBe(0);
  });

  it('解码峰值按位图的两倍估算,并计入输入字节', () => {
    expect(estimateDecodePeakBytes(1000, 1000, 0)).toBe(8_000_000);
    expect(estimateDecodePeakBytes(1000, 1000, 1000)).toBe(8_002_000);
  });

  it('常见的手机照片在预算内,超大图会被拦下', () => {
    expect(isWithinDecodeBudget(4032, 3024, 3 * 1024 * 1024)).toBe(true);
    expect(isWithinDecodeBudget(12000, 9000, 5 * 1024 * 1024)).toBe(false);
  });

  it('预算上限换算成像素数后仍是正数', () => {
    expect(maxDecodablePixels()).toBeGreaterThan(10_000_000);
  });
});

describe('downscaleRgba', () => {
  /** 造一张纯色图,方便验证求平均的结果。 */
  function solid(width: number, height: number, rgba: [number, number, number, number]) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
    return data;
  }

  it('尺寸相同时原样返回', () => {
    const data = solid(4, 4, [1, 2, 3, 255]);
    expect(downscaleRgba(data, 4, 4, 4, 4)).toBe(data);
  });

  it('纯色图缩小后颜色不变', () => {
    const out = downscaleRgba(solid(100, 100, [10, 20, 30, 255]), 100, 100, 25, 25);
    expect(out.length).toBe(25 * 25 * 4);
    expect(Array.from(out.slice(0, 4))).toEqual([10, 20, 30, 255]);
  });

  it('按覆盖区域求平均,而不是取最近像素', () => {
    // 2x1: 黑 + 白 → 缩成 1x1 应得到中间灰
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const out = downscaleRgba(data, 2, 1, 1, 1);
    expect(Array.from(out)).toEqual([128, 128, 128, 255]);
  });

  it('等比缩小时保持宽高比', () => {
    const out = downscaleRgba(solid(3000, 2000, [0, 0, 0, 255]), 3000, 2000, 1440, 960);
    expect(out.length).toBe(1440 * 960 * 4);
  });

  it('非法尺寸返回空数组,不抛错', () => {
    expect(downscaleRgba(new Uint8ClampedArray(0), 0, 0, 10, 10).length).toBe(0);
  });
});