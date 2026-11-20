import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../functions/lib/errors';
import { Deadline, isAbortError, withTimeout } from '../functions/lib/deadline';

afterEach(() => {
  vi.useRealTimers();
});

describe('Deadline', () => {
  it('剩余预算随时间减少，耗尽后 take/remaining 都归零', () => {
    vi.useFakeTimers();
    const deadline = new Deadline(1_000);
    expect(deadline.remainingMs()).toBe(1_000);
    expect(deadline.elapsedMs()).toBe(0);

    vi.advanceTimersByTime(400);
    expect(deadline.remainingMs()).toBe(600);
    expect(deadline.elapsedMs()).toBe(400);
    // 单次调用的上限不会超过剩余预算。
    expect(deadline.take(30_000, '超时')).toBe(600);

    vi.advanceTimersByTime(700);
    expect(deadline.remainingMs()).toBe(0);
    expect(deadline.elapsedMs()).toBe(1_000);
    expect(() => deadline.take(30_000, '卡在取图')).toThrow(/卡在取图/);
  });
});

describe('withTimeout', () => {
  it('任务按时完成时原样返回结果，并撤掉定时器', async () => {
    await expect(withTimeout(async () => 'ok', 1_000, '超时')).resolves.toBe('ok');
  });

  it('到点立即以给定文案报错，而不是继续等下去', async () => {
    vi.useFakeTimers();
    const promise = withTimeout(
      // 永不完成的调用：模拟「服务端发完响应头就不再发 body」。
      () => new Promise<never>(() => undefined),
      5_000,
      '卡在读响应体',
    );
    const assertion = expect(promise).rejects.toThrow('卡在读响应体');
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it('abort 触发的取消也归一成同一句超时文案', async () => {
    vi.useFakeTimers();
    const promise = withTimeout(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
      1_000,
      '请求超时',
    );
    const assertion = expect(promise).rejects.toThrow('请求超时');
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('预算为 0 时不发起任何调用直接报错', async () => {
    const task = vi.fn(async () => 'ok');
    await expect(withTimeout(task, 0, '已超时')).rejects.toBeInstanceOf(AppError);
    expect(task).not.toHaveBeenCalled();
  });

  it('识别 AbortError 与 TimeoutError 两种取消错误', () => {
    expect(isAbortError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
  });
});
