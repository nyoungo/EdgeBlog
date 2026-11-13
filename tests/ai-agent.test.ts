import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../functions/lib/env';
import { runToolAgent } from '../functions/lib/ai-agent';
import { AI_DEFAULTS } from '../shared/settings-defaults';

/** 只实现 AI 绑定 + 设置读取所需的最小 Env。 */
function fakeEnv(
  run: (model: string, inputs: Record<string, unknown>) => Promise<unknown>,
  timeoutMs?: number,
): Env {
  const stored = { ...AI_DEFAULTS, enabled: true, provider: 'cloudflare' };
  if (timeoutMs !== undefined) stored.timeoutMs = timeoutMs;
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ value_json: JSON.stringify(stored) }),
        }),
      }),
    },
    AI: { run, models: async () => [] },
  } as unknown as Env;
}

function openAiReply(content: string, toolCalls?: unknown[]): unknown {
  return {
    choices: [
      {
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
        message: { content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
      },
    ],
  };
}

describe('runToolAgent 工具白名单', () => {
  it('只把白名单里的工具定义交给模型', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const env = fakeEnv(async (_model, inputs) => {
      seen.push(inputs);
      return openAiReply('写好的文章');
    });

    const result = await runToolAgent(env, null, 'sys', '写一篇早报', {
      tools: ['fetch_web_page'],
    });

    expect(result.reply).toBe('写好的文章');
    const offered = (seen[0]?.tools as Array<{ function: { name: string } }>).map(
      (tool) => tool.function.name,
    );
    expect(offered).toEqual(['fetch_web_page']);
  });

  it('省略 tools 时开放全部工具', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const env = fakeEnv(async (_model, inputs) => {
      seen.push(inputs);
      return openAiReply('好');
    });

    await runToolAgent(env, null, 'sys', 'msg');

    const offered = (seen[0]?.tools as Array<{ function: { name: string } }>).map(
      (tool) => tool.function.name,
    );
    expect(offered).toContain('create_post');
    expect(offered).toContain('fetch_web_page');
  });

  it('模型直接调用白名单外的工具时拒绝执行', async () => {
    let round = 0;
    const env = fakeEnv(async () => {
      round += 1;
      if (round === 1) {
        return openAiReply('', [
          { id: 'call_1', function: { name: 'delete_post', arguments: '{"id":1}' } },
        ]);
      }
      return openAiReply('文章写好了');
    });

    const result = await runToolAgent(env, null, 'sys', 'msg', {
      tools: ['fetch_web_page'],
    });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.tool).toBe('delete_post');
    expect(result.actions[0]?.ok).toBe(false);
    // 关键是被白名单拦下,而不是走到数据库才失败
    expect(result.actions[0]?.summary).toContain('不允许');
    expect(result.reply).toBe('文章写好了');
  });

  it('写进正文的工具调用同样受白名单约束', async () => {
    let round = 0;
    const env = fakeEnv(async () => {
      round += 1;
      if (round === 1) {
        return openAiReply(
          '```json\n{"tool":"moderate_comments","arguments":{"ids":[1],"action":"delete"}}\n```',
        );
      }
      return openAiReply('完成');
    });

    const result = await runToolAgent(env, null, 'sys', 'msg', {
      tools: ['fetch_web_page'],
    });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.tool).toBe('moderate_comments');
    expect(result.actions[0]?.ok).toBe(false);
    expect(result.actions[0]?.summary).toContain('不允许');
    expect(result.reply).toBe('完成');
  });
});

describe('runToolAgent 取数轮与流式成文', () => {
  it('toolRounds 之后的轮次退回无工具,并插入「立即成文」提示', async () => {
    const seen: Array<Record<string, unknown>> = [];
    let round = 0;
    const env = fakeEnv(async (_model, inputs) => {
      seen.push(inputs);
      round += 1;
      if (round === 1) {
        return openAiReply('', [
          { id: 'call_1', function: { name: 'fetch_web_page', arguments: '{"url":"https://a.com"}' } },
        ]);
      }
      return openAiReply('# 标题\n\n正文');
    });

    const result = await runToolAgent(env, null, 'sys', '写文章', {
      maxRounds: 3,
      toolRounds: 1,
      tools: ['fetch_web_page'],
    });

    expect(result.reply).toContain('正文');
    // 第 1 轮下发工具,第 2 轮收回
    expect(seen[0].tools).toBeDefined();
    expect(seen[1].tools).toBeUndefined();
    const secondMessages = seen[1].messages as Array<{ role: string; content?: string }>;
    expect(secondMessages[secondMessages.length - 1]?.content).toContain('立即');
  });

  it('streamFinal 时成文走流式聚合,取数轮仍用普通调用', async () => {
    const streamFlags: boolean[] = [];
    let round = 0;
    const env = fakeEnv(async (_model, inputs) => {
      streamFlags.push(inputs.stream === true);
      round += 1;
      if (round === 1) {
        return openAiReply('', [
          { id: 'call_1', function: { name: 'fetch_web_page', arguments: '{"url":"https://a.com"}' } },
        ]);
      }
      // 成文轮返回 SSE 分片
      const encoder = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"# 题目\\n\\n"}}]}\n\n'),
          );
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"流式正文"}}]}\n\n'),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
    });

    const result = await runToolAgent(env, null, 'sys', '写文章', {
      maxRounds: 2,
      toolRounds: 1,
      streamFinal: true,
      tools: ['fetch_web_page'],
    });

    expect(streamFlags).toEqual([false, true]);
    expect(result.reply).toBe('# 题目\n\n流式正文');
  });

  it('streamFinal 时把模型在取数轮写出的正文丢掉,只在成文轮采信', async () => {    let round = 0;
    const env = fakeEnv(async () => {
      round += 1;
      // 第 1 轮不去读链接,直接凭记忆写正文:必须被丢弃
      if (round === 1) return openAiReply('# 凭记忆编的文章');
      return openAiReply('# 真实成文');
    });

    const result = await runToolAgent(env, null, 'sys', '写文章', {
      maxRounds: 3,
      toolRounds: 1,
      streamFinal: true,
      tools: ['fetch_web_page'],
    });

    // 第 1 轮产出被丢弃,第 2 轮(成文轮)才是最终结果
    expect(round).toBe(2);
    expect(result.reply).toBe('# 真实成文');
  });

  it('maxToolResultChars 压住单条取数结果的长度', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('x'.repeat(5_000), {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })) as unknown as typeof fetch;

    try {
      const seen: Array<Record<string, unknown>> = [];
      let round = 0;
      const env = fakeEnv(async (_model, inputs) => {
        seen.push(inputs);
        round += 1;
        if (round === 1) {
          return openAiReply('', [
            {
              id: 'call_1',
              function: { name: 'fetch_web_page', arguments: '{"url":"https://a.com"}' },
            },
          ]);
        }
        return openAiReply('# 成文');
      });

      await runToolAgent(env, null, 'sys', '写文章', {
        maxRounds: 2,
        toolRounds: 1,
        streamFinal: true,
        tools: ['fetch_web_page'],
        maxToolResultChars: 200,
      });

      const messages = seen[1].messages as Array<{ role: string; content?: string }>;
      const toolMessage = messages.find((message) => message.role === 'tool');
      expect(toolMessage?.content).toHaveLength(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('runToolAgent 整体预算', () => {
  it('预算耗尽时不再提供工具,直接让模型收尾成文', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const env = fakeEnv(async (_model, inputs) => {
      seen.push(inputs);
      return openAiReply('收尾正文');
    });

    const result = await runToolAgent(env, null, 'sys', 'msg', {
      tools: ['fetch_web_page'],
      budgetMs: 0,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.tools).toBeUndefined();
    expect(result.reply).toBe('收尾正文');
  });

  it('整体预算会收紧成文轮的流式超时', async () => {
    vi.useFakeTimers();
    try {
      // 分片一直不来,只有「没收到分片」的定时器能结束它;
      // 若预算没生效,这里会按设置的 5 分钟等下去。
      const env = fakeEnv(async () => new ReadableStream<Uint8Array>({ start: () => {} }));
      const promise = runToolAgent(env, null, 'sys', '写文章', {
        maxRounds: 1,
        toolRounds: 0,
        streamFinal: true,
        tools: ['fetch_web_page'],
        budgetMs: 5_000,
      });
      const outcome = promise.then(() => 'resolved', () => 'rejected');

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(promise).rejects.toThrow('流式输出');
      expect(await outcome).toBe('rejected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('设置里的超时同样收紧成文轮,不会被预算撑大', async () => {
    vi.useFakeTimers();
    try {
      // 设置成 10s(下限),预算给 10 分钟:实际必须按 10s 结束。
      const env = fakeEnv(
        async () => new ReadableStream<Uint8Array>({ start: () => {} }),
        10_000,
      );
      const promise = runToolAgent(env, null, 'sys', '写文章', {
        maxRounds: 1,
        toolRounds: 0,
        streamFinal: true,
        tools: ['fetch_web_page'],
        budgetMs: 600_000,
      });
      const outcome = promise.then(() => 'resolved', () => 'rejected');

      await vi.advanceTimersByTimeAsync(9_999);
      expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('pending');

      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).rejects.toThrow('流式输出');
    } finally {
      vi.useRealTimers();
    }
  });
});
