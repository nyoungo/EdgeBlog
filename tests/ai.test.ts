import { describe, expect, it } from 'vitest';
import type { Env } from '../functions/lib/env';
import {
  CLOUDFLARE_FALLBACK_MODELS,
  aiBindingAvailable,
  aiProviderReady,
  extractAiText,
  extractToolCalls,
  listAiModels,
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
    await expect(listAiModels(env)).resolves.toEqual(CLOUDFLARE_FALLBACK_MODELS);
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
    await expect(listAiModels(env)).resolves.toEqual(['@cf/a-model', '@cf/b-model']);
  });
});
