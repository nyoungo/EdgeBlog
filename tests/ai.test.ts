import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../functions/lib/env';
import {
  CLOUDFLARE_FALLBACK_MODELS,
  STREAM_IDLE_TIMEOUT_MS,
  aiBindingAvailable,
  aiChatComplete,
  aiChatStream,
  aiProviderReady,
  chatComplete,
  cloudflareModelId,
  extractAiText,
  extractReasoning,
  extractToolCalls,
  listAiModels,
  modelLabel,
  readAiSettings,
  resolveCloudflareModel,
  type AiSettings,
} from '../functions/lib/ai';
import { AI_DEFAULTS } from '../shared/settings-defaults';

function fakeEnv(settings: Partial<AiSettings>, ai: Record<string, unknown> | null): Env {
  const stored = { ...AI_DEFAULTS, enabled: true, provider: 'cloudflare', ...settings };
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ value_json: JSON.stringify(stored) }),
        }),
      }),
    },
    AI: ai,
  } as unknown as Env;
}

describe('extractAiText', () => {
  it('reads the legacy flat `response` shape', () => {
    expect(extractAiText({ response: '  你好  ' })).toBe('你好');
  });

  it('reads OpenAI-style choices', () => {
    expect(extractAiText({ choices: [{ message: { content: 'hello' } }] })).toBe('hello');
  });

  it('unwraps a nested result payload', () => {
    expect(extractAiText({ result: { response: 'nested' } })).toBe('nested');
  });

  it('returns an empty string when no text is present', () => {
    expect(extractAiText({})).toBe('');
    expect(extractAiText(null)).toBe('');
    expect(extractAiText(undefined)).toBe('');
  });

  it('reads array-shaped content parts', () => {
    expect(
      extractAiText({
        choices: [
          { message: { content: [{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }] } },
        ],
      }),
    ).toBe('hello world');
    expect(extractAiText([{ type: 'text', text: 'a' }, { text: 'b' }])).toBe('ab');
  });

  it('falls through a null content to the next known field', () => {
    expect(extractAiText({ choices: [{ message: { content: null } }], response: 'fallback' })).toBe(
      'fallback',
    );
  });
});

describe('extractReasoning', () => {
  it('reads reasoning_content from an OpenAI-style message', () => {
    expect(
      extractReasoning({
        choices: [{ message: { content: null, reasoning_content: '先分析再作答' } }],
      }),
    ).toBe('先分析再作答');
  });

  it('reads flat reasoning fields and tolerates their absence', () => {
    expect(extractReasoning({ reasoning: '推理中' })).toBe('推理中');
    expect(extractReasoning({})).toBe('');
    expect(extractReasoning(null)).toBe('');
  });
});

describe('aiChatComplete (cloudflare)', () => {
  it('retries with a larger token budget when reasoning exhausts max_tokens', async () => {
    const budgets: number[] = [];
    const env = fakeEnv({ model: '@cf/zai-org/glm-4.7-flash', maxTokens: 256 }, {
      run: async (_model: string, inputs: { max_tokens: number }) => {
        budgets.push(inputs.max_tokens);
        return inputs.max_tokens >= 1024
          ? { choices: [{ finish_reason: 'stop', message: { content: '最终摘要' } }] }
          : {
              choices: [
                {
                  finish_reason: 'length',
                  message: { content: null, reasoning_content: '先分析一下文章…' },
                },
              ],
            };
      },
    });

    await expect(aiChatComplete(env, [{ role: 'user', content: '写摘要' }])).resolves.toEqual({
      text: '最终摘要',
      toolCalls: [],
    });
    expect(budgets).toEqual([256, 1024]);
  });

  it('falls back to reasoning when the model stops before writing an answer', async () => {
    const env = fakeEnv({ model: '@cf/zai-org/glm-4.7-flash' }, {
      run: async () => ({
        choices: [
          { finish_reason: 'stop', message: { content: null, reasoning_content: '这就是答案' } },
        ],
      }),
    });

    await expect(aiChatComplete(env, [{ role: 'user', content: '你好' }])).resolves.toEqual({
      text: '这就是答案',
      toolCalls: [],
    });
  });

  it('keeps tool calls and does not retry them', async () => {
    let calls = 0;
    const env = fakeEnv({ model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', maxTokens: 256 }, {
      run: async () => {
        calls += 1;
        return {
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: null,
                tool_calls: [
                  { id: 'call_1', function: { name: 'list_posts', arguments: '{"limit":3}' } },
                ],
              },
            },
          ],
        };
      },
    });

    const result = await aiChatComplete(env, [{ role: 'user', content: '列出文章' }]);
    expect(calls).toBe(1);
    expect(result.text).toBe('');
    expect(result.toolCalls.map((call) => call.name)).toEqual(['list_posts']);
  });

  it('resolves a legacy UUID model before calling the binding', async () => {
    const seen: string[] = [];
    const env = fakeEnv({ model: 'f9f2250b-1048-4a52-9910-d0bf976616a1' }, {
      run: async (model: string) => {
        seen.push(model);
        return { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] };
      },
      models: async () => [
        { id: 'f9f2250b-1048-4a52-9910-d0bf976616a1', name: '@cf/openai/gpt-oss-120b' },
      ],
    });

    await expect(aiChatComplete(env, [{ role: 'user', content: '你好' }])).resolves.toEqual({
      text: 'ok',
      toolCalls: [],
    });
    expect(seen).toEqual(['@cf/openai/gpt-oss-120b']);
  });

  it('explains a truncated reasoning-only completion instead of a generic error', async () => {
    const env = fakeEnv({ model: '@cf/zai-org/glm-4.7-flash', maxTokens: 8192 }, {
      run: async () => ({
        choices: [
          {
            finish_reason: 'length',
            message: { content: null, reasoning_content: '还没写完…' },
          },
        ],
        usage: { prompt_tokens: 300, completion_tokens: 8192 },
      }),
    });

    await expect(aiChatComplete(env, [{ role: 'user', content: '写一篇长文' }])).rejects.toThrow(
      /结束原因：length，tokens：输入 300 \/ 输出 8192/,
    );
  });
});

describe('extractToolCalls', () => {
  it('normalises Workers AI flat tool calls', () => {
    const calls = extractToolCalls({
      tool_calls: [{ name: 'list_posts', arguments: { limit: 5 } }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('list_posts');
    expect(JSON.parse(calls[0].arguments)).toEqual({ limit: 5 });
  });

  it('normalises OpenAI-style tool calls and keeps ids', () => {
    const calls = extractToolCalls({
      choices: [
        {
          message: {
            tool_calls: [
              { id: 'call_abc', type: 'function', function: { name: 'get_post', arguments: '{"id":1}' } },
            ],
          },
        },
      ],
    });
    expect(calls).toEqual([{ id: 'call_abc', name: 'get_post', arguments: '{"id":1}' }]);
  });

  it('reads a legacy function_call', () => {
    const calls = extractToolCalls({
      choices: [{ message: { function_call: { name: 'get_stats', arguments: '{}' } } }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('get_stats');
  });

  it('ignores entries without a function name', () => {
    expect(extractToolCalls({ tool_calls: [{ arguments: '{}' }] })).toEqual([]);
  });

  it('does not duplicate calls when flat and OpenAI shapes coexist', () => {
    const call = { name: 'web_search', arguments: { query: '雷军' } };
    const calls = extractToolCalls({
      tool_calls: [call],
      choices: [
        { message: { tool_calls: [{ id: 'call_x', function: { name: 'web_search', arguments: '{"query":"雷军"}' } }] } },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('web_search');
  });
});

describe('modelLabel', () => {
  it('prefers a short `name` when the runtime provides one', () => {
    expect(modelLabel('@cf/zai-org/glm-4.7-flash', 'glm-4.7-flash')).toBe('glm-4.7-flash');
  });

  it('ignores a `name` that merely repeats the id', () => {
    expect(modelLabel('@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast')).toBe(
      'meta/llama-3.3-70b-instruct-fp8-fast',
    );
  });

  it('falls back to the id without the @cf/ prefix', () => {
    expect(modelLabel('@cf/qwen/qwen3.8-27b')).toBe('qwen/qwen3.8-27b');
    expect(modelLabel('gpt-4o-mini')).toBe('gpt-4o-mini');
  });
});

describe('cloudflareModelId', () => {
  it('prefers the callable `name` when the catalogue id is an internal UUID', () => {
    expect(
      cloudflareModelId({
        id: 'f9f2250b-1048-4a52-9910-d0bf976616a1',
        name: '@cf/openai/gpt-oss-120b',
      }),
    ).toBe('@cf/openai/gpt-oss-120b');
  });

  it('keeps the id when it already is a callable model name', () => {
    expect(cloudflareModelId({ id: '@cf/meta/llama-3.2-3b-instruct' })).toBe(
      '@cf/meta/llama-3.2-3b-instruct',
    );
  });

  it('tolerates a UUID-only entry instead of returning an empty string', () => {
    expect(cloudflareModelId({ id: 'f9f2250b-1048-4a52-9910-d0bf976616a1' })).toBe(
      'f9f2250b-1048-4a52-9910-d0bf976616a1',
    );
  });
});

describe('resolveCloudflareModel', () => {
  const uuid = 'f9f2250b-1048-4a52-9910-d0bf976616a1';

  it('maps a legacy UUID back to the callable model name', async () => {
    const ai = {
      models: async () => [{ id: uuid, name: '@cf/openai/gpt-oss-120b' }],
    } as unknown as Ai;
    await expect(resolveCloudflareModel(ai, uuid)).resolves.toBe('@cf/openai/gpt-oss-120b');
  });

  it('passes a normal model name through without querying the catalogue', async () => {
    let called = false;
    const ai = {
      models: async () => {
        called = true;
        return [];
      },
    } as unknown as Ai;
    await expect(resolveCloudflareModel(ai, '@cf/meta/llama-3.3-70b-instruct-fp8-fast')).resolves.toBe(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    );
    expect(called).toBe(false);
  });

  it('keeps the stored value when the catalogue cannot be read', async () => {
    const ai = {
      models: async () => {
        throw new Error('not supported');
      },
    } as unknown as Ai;
    await expect(resolveCloudflareModel(ai, uuid)).resolves.toBe(uuid);
  });
});

describe('Workers AI readiness', () => {
  it('detects a usable binding', () => {
    expect(aiBindingAvailable({ AI: { run: () => undefined } } as unknown as Env)).toBe(true);
    expect(aiBindingAvailable({} as unknown as Env)).toBe(false);
  });

  it('requires the feature flag and a model for cloudflare', () => {
    const env = fakeEnv({}, { run: () => undefined });
    expect(aiProviderReady(env, { ...AI_DEFAULTS, enabled: false })).toBe(false);
    expect(aiProviderReady(env, { ...AI_DEFAULTS, enabled: true, provider: 'cloudflare' })).toBe(true);
  });

  it('still requires an API key for OpenAI-compatible providers', () => {
    const env = fakeEnv({ provider: 'openai', apiKey: '' }, { run: () => undefined });
    expect(aiProviderReady(env, { ...AI_DEFAULTS, enabled: true, provider: 'openai' })).toBe(false);
    expect(
      aiProviderReady(env, { ...AI_DEFAULTS, enabled: true, provider: 'openai', apiKey: 'sk-test' }),
    ).toBe(true);
  });
});

describe('listAiModels (cloudflare)', () => {
  it('returns the curated fallback when the binding catalogue is unavailable', async () => {
    const env = fakeEnv({}, {
      run: () => undefined,
      models: async () => {
        throw new Error('not supported');
      },
    });
    await expect(listAiModels(env)).resolves.toEqual(
      CLOUDFLARE_FALLBACK_MODELS.map((id) => ({ id, label: modelLabel(id) })),
    );
  });

  it('returns a sorted, de-duplicated catalogue from the binding', async () => {
    const env = fakeEnv({}, {
      run: () => undefined,
      models: async () => [
        { id: '@cf/b-model' },
        { id: '@cf/a-model' },
        { id: '@cf/a-model' },
        { id: '' },
      ],
    });
    await expect(listAiModels(env)).resolves.toEqual([
      { id: '@cf/a-model', label: 'a-model' },
      { id: '@cf/b-model', label: 'b-model' },
    ]);
  });

  it('uses the binding `name` as the display label', async () => {
    const env = fakeEnv({}, {
      run: () => undefined,
      models: async () => [
        { id: '@cf/zai-org/glm-4.7-flash', name: 'glm-4.7-flash' },
      ],
    });
    await expect(listAiModels(env)).resolves.toEqual([
      { id: '@cf/zai-org/glm-4.7-flash', label: 'glm-4.7-flash' },
    ]);
  });

  it('turns internal UUID catalogue ids into callable model names', async () => {
    const env = fakeEnv({}, {
      run: () => undefined,
      models: async () => [
        { id: 'f9f2250b-1048-4a52-9910-d0bf976616a1', name: '@cf/openai/gpt-oss-120b' },
        { id: 'd9dc8363-66f4-4bb0-8641-464ee7bfc131', name: '@cf/meta/llama-3.2-3b-instruct' },
      ],
    });
    await expect(listAiModels(env)).resolves.toEqual([
      { id: '@cf/meta/llama-3.2-3b-instruct', label: 'meta/llama-3.2-3b-instruct' },
      { id: '@cf/openai/gpt-oss-120b', label: 'openai/gpt-oss-120b' },
    ]);
  });
});

/** 判定一个 Promise 在给定时刻是否仍未 settle(配合假定时器使用)。 */
async function stillPending(outcome: Promise<string>): Promise<boolean> {
  return (await Promise.race([outcome, Promise.resolve('pending')])) === 'pending';
}

describe('请求超时', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('默认超时取自「AI 设置」,未配置时为 5 分钟', async () => {
    vi.useFakeTimers();
    const env = fakeEnv({ model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }, {
      run: () => new Promise(() => {}),
    });
    const promise = aiChatComplete(env, [{ role: 'user', content: '写一段摘要' }]);
    const outcome = promise.then(() => 'resolved', () => 'rejected');

    // 旧的 60s / 120s 硬编码会在这里就把请求判死;默认 300s 必须还能继续等。
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await stillPending(outcome)).toBe(true);

    await vi.advanceTimersByTimeAsync(180_000);
    await expect(promise).rejects.toThrow('Workers AI 请求超时');
  });

  it('设置里配的超时会生效,而不是被常量覆盖', async () => {
    vi.useFakeTimers();
    const env = fakeEnv(
      { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', timeoutMs: 45_000 },
      { run: () => new Promise(() => {}) },
    );
    const promise = aiChatComplete(env, [{ role: 'user', content: '写一段摘要' }]);
    const outcome = promise.then(() => 'resolved', () => 'rejected');

    await vi.advanceTimersByTimeAsync(44_999);
    expect(await stillPending(outcome)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toThrow('Workers AI 请求超时');
  });

  it('调用方传入的超时会覆盖设置值', async () => {
    vi.useFakeTimers();
    const env = fakeEnv(
      { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', timeoutMs: 600_000 },
      { run: () => new Promise(() => {}) },
    );
    const promise = aiChatComplete(env, [{ role: 'user', content: '写正文' }], undefined, 30_000);
    const outcome = promise.then(() => 'resolved', () => 'rejected');

    await vi.advanceTimersByTimeAsync(29_999);
    expect(await stillPending(outcome)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toThrow('Workers AI 请求超时');
  });

  it('OpenAI 兼容分支同样按传入的超时中止请求', async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    // 永不完成的请求,只在收到 abort 信号时失败,以此验证超时被透传。
    globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      })) as unknown as typeof fetch;

    try {
      const env = fakeEnv(
        { provider: 'custom', baseUrl: 'https://ai.example.com/v1', apiKey: 'test-key' },
        null,
      );
      const promise = chatComplete(env, [{ role: 'user', content: '你好' }], 5_000);
      const outcome = promise.then(() => 'resolved', () => 'rejected');

      await vi.advanceTimersByTimeAsync(4_999);
      expect(await stillPending(outcome)).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).rejects.toThrow('AI 请求超时');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('readAiSettings 的 timeoutMs', () => {
  it('默认 5 分钟,老设置里没有该字段时也回落到 5 分钟', async () => {
    expect(AI_DEFAULTS.timeoutMs).toBe(300_000);
    // 线上已有设置的 JSON 里不会有这个字段,必须自动带上默认值。
    await expect(readAiSettings(fakeEnv({}, null))).resolves.toMatchObject({
      timeoutMs: 300_000,
    });
  });

  it('越界的值被夹到 10s – 15min 之间', async () => {
    await expect(readAiSettings(fakeEnv({ timeoutMs: 1_000 }, null))).resolves.toMatchObject({
      timeoutMs: 10_000,
    });
    await expect(readAiSettings(fakeEnv({ timeoutMs: 10_000_000 }, null))).resolves.toMatchObject({
      timeoutMs: 900_000,
    });
  });
});

/** 构造一条 SSE 响应流:分片依次输出,最后带 finish_reason 与 [DONE]。 */
function sseStream(chunks: string[], finish = 'stop'): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payloads = chunks.map(
    (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
  );
  payloads.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`);
  payloads.push('data: [DONE]\n\n');
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= payloads.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(payloads[index]));
      index += 1;
    },
  });
}

/** 永不结束、但每隔 `everyMs` 吐一个分片的流,用于验证整体上限。 */
function endlessStream(everyMs: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      setTimeout(() => {
        // 消费方取消后不能再 enqueue,否则会抛「Controller is already closed」。
        if (closed) return;
        try {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'));
        } catch {
          closed = true;
        }
      }, everyMs);
    },
    cancel() {
      closed = true;
    },
  });
}

describe('aiChatStream (cloudflare)', () => {
  const encoderText = (value: string): Uint8Array => new TextEncoder().encode(value);

  it('把流式分片聚合成完整正文', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const env = fakeEnv({ model: '@cf/qwen/qwen3.8-27b' }, {
      run: async (_model: string, inputs: Record<string, unknown>) => {
        seen.push(inputs);
        return sseStream(['# 标题\n\n', '第一段', '第二段']);
      },
    });

    await expect(aiChatStream(env, [{ role: 'user', content: '写正文' }])).resolves.toBe(
      '# 标题\n\n第一段第二段',
    );
    // 成文必须显式要求流式,否则又会撞上非流式请求的时间上限。
    expect(seen[0].stream).toBe(true);
  });

  it('兼容旧版顶层 `response` 增量分片', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoderText('data: {"response":"你"}\n\n'));
        controller.enqueue(encoderText('data: {"response":"好"}\n\n'));
        controller.enqueue(encoderText('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const env = fakeEnv({}, { run: async () => stream });

    await expect(aiChatStream(env, [{ role: 'user', content: '你好' }])).resolves.toBe('你好');
  });

  it('分片之外的完整对象响应退化成一次性解析', async () => {
    const env = fakeEnv({}, {
      run: async () => ({ choices: [{ message: { content: '不支持流式的模型' } }] }),
    });

    await expect(aiChatStream(env, [{ role: 'user', content: '你好' }])).resolves.toBe(
      '不支持流式的模型',
    );
  });

  it('分片长时间不到达时报中断,而不是无限等待', async () => {
    vi.useFakeTimers();
    try {
      // 只有 start、永不 enqueue/close 的流:read() 会一直挂起。
      const env = fakeEnv({}, { run: async () => new ReadableStream<Uint8Array>({ start: () => {} }) });
      const promise = aiChatStream(env, [{ role: 'user', content: '你好' }]);
      const outcome = promise.then(() => 'resolved', () => 'rejected');

      await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);
      await expect(promise).rejects.toThrow('流式输出中断');
      expect(await outcome).toBe('rejected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('整体超时与静默上限是两个概念:整体可调,静默固定 90s', async () => {
    vi.useFakeTimers();
    try {
      const env = fakeEnv({ timeoutMs: 600_000 }, {
        run: async () => new ReadableStream<Uint8Array>({ start: () => {} }),
      });
      const promise = aiChatStream(env, [{ role: 'user', content: '你好' }]);
      const outcome = promise.then(() => 'resolved', () => 'rejected');

      await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);
      await expect(promise).rejects.toThrow('流式输出中断');
      expect(await outcome).toBe('rejected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('持续有分片也会在整体上限处停止', async () => {
    // 用真实定时器 + 极小上限:分片一直有(每 20ms 一个,远小于静默上限),
    // 但总时长到顶就必须停,不能无限跑。
    const env = fakeEnv({}, { run: async () => endlessStream(20) });
    await expect(
      aiChatStream(env, [{ role: 'user', content: '你好' }], { timeoutMs: 400, idleTimeoutMs: 200 }),
    ).rejects.toThrow('流式输出超时');
  });
});

describe('aiChatStream (OpenAI 兼容)', () => {
  it('解析 chat/completions 的 SSE 流', async () => {
    const originalFetch = globalThis.fetch;
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(sseStream(['来自', '兼容层的正文']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    try {
      const env = fakeEnv({ provider: 'custom', baseUrl: 'https://ai.example.com/v1', apiKey: 'k' }, null);
      await expect(aiChatStream(env, [{ role: 'user', content: '你好' }])).resolves.toBe(
        '来自兼容层的正文',
      );
      expect(sentBody.stream).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP 错误按服务端返回的错误信息抛出', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: '额度不足' } }), {
        status: 402,
      })) as unknown as typeof fetch;

    try {
      const env = fakeEnv({ provider: 'custom', baseUrl: 'https://ai.example.com/v1', apiKey: 'k' }, null);
      await expect(aiChatStream(env, [{ role: 'user', content: '你好' }])).rejects.toThrow('额度不足');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
