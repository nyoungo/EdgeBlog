import { describe, expect, it } from 'vitest';
import {
  fitDimensions,
  formatBytes,
  nextCompressionStep,
  pickOutputFormat,
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