/**
 * 截止时间（预算）工具。
 *
 * 一次公众号推送要串行做许多次外部调用（读图 / 下载外链图、uploadimg、
 * add_material、draft/add），每一步各自只包自己的超时是拦不住整体的：
 * 几步各卡 30 秒，加起来就会顶穿 Cloudflare 125 秒的代理读超时，
 * 用户只看到转圈或 524。
 *
 * 这里给整条链路一个总预算，每次调用再按「剩余预算」收窄自己的超时，
 * 预算耗尽时立刻报错并指明卡在哪一步，而不是继续等下去。
 */
import { AppError } from './errors';

/** AbortController 触发的取消错误（各运行时抛出的类型略有差异）。 */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

export class Deadline {
  readonly totalMs: number;
  private readonly expiresAt: number;

  constructor(totalMs: number) {
    this.totalMs = Math.max(0, Math.floor(totalMs));
    this.expiresAt = Date.now() + this.totalMs;
  }

  /** 剩余预算（毫秒），已耗尽时返回 0。 */
  remainingMs(): number {
    return Math.max(0, this.expiresAt - Date.now());
  }

  /** 已用时间（毫秒）。 */
  elapsedMs(): number {
    return Math.min(this.totalMs, this.totalMs - this.remainingMs());
  }

  /**
   * 取一次调用的可用超时：不超过 `cap`，也不超过剩余预算；耗尽时直接抛错。
   * 返回值可能很小（例如只剩 200ms），调用方照用即可——那正是「就快超时了」。
   */
  take(cap: number, message: string): number {
    const remaining = this.remainingMs();
    if (remaining <= 0) throw AppError.upstream(message);
    return Math.min(cap, remaining);
  }
}

/**
 * 在 `ms` 毫秒内跑完 `task`；到点会 abort 传进去的 signal 并立即以 `message` 报错。
 *
 * 关键点：`task` 里必须把 signal 传给 fetch，并且**把读取响应体也放在里面**。
 * 只包 fetch 是不够的——服务端下发响应头后不再传 body 时，`response.json()`
 * 会一直挂着，看起来就和「推送卡死」一样。
 */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  if (ms <= 0) throw AppError.upstream(message);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(AppError.upstream(message));
    }, ms);
  });
  const running = task(controller.signal);
  // 超时先到时，running 稍后仍会以 AbortError 拒绝；先挂一个空处理器，
  // 避免它变成「未处理的 promise 拒绝」把 Worker 日志淹没。
  running.catch(() => undefined);
  try {
    return await Promise.race([running, expired]);
  } catch (err) {
    // abort 与「到点 reject」几乎同时发生，先到的是谁都统一成超时文案。
    if (isAbortError(err)) throw AppError.upstream(message);
    throw err;
  } finally {
    // 任务先完成时把定时器撤掉，否则这个 promise 迟点会 reject 成未处理异常。
    if (timer !== undefined) clearTimeout(timer);
  }
}
