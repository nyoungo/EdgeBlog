import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WechatSettings } from '../shared/types';
import type { Env } from '../functions/lib/env';
import { AppError } from '../functions/lib/errors';
import { renderWechatContent, substituteWechatImages, truncateChars, validateWechatContent } from '../functions/lib/wechat-render';
import { validateWechatContentImage } from '../functions/lib/wechat-draft';
import { addDraft, type WechatArticle } from '../functions/lib/wechat';

const SETTINGS: WechatSettings = {
  enabled: true,
  appId: 'wx-test-app',
  appSecret: 'secret-must-not-appear-in-errors',
  author: '测试作者',
  openComment: false,
  onlyFansCanComment: false,
};

const ARTICLE: WechatArticle = {
  title: '示例文章',
  author: '测试作者',
  digest: '摘要',
  content: '<p>正文</p>',
  contentSourceUrl: '',
  thumbMediaId: 'thumb-media-id',
  needOpenComment: 0,
  onlyFansCanComment: 0,
};

function createEnv(): { env: Env; kv: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } } {
  const values = new Map<string, string>();
  const kv = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
  return { env: { CACHE: kv } as unknown as Env, kv };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WeChat Markdown rendering', () => {
  it('renders Markdown with inline styles, drops raw HTML, and collects image placeholders', () => {
    const rendered = renderWechatContent(
      '# 标题 **加粗**\n\n正文 [链接](https://example.com) 与 ![图片](/media/a.jpg)\n\n<script>alert(1)</script>',
    );

    expect(rendered.html).toContain('<h1 style=');
    expect(rendered.html).toContain('<strong style=');
    expect(rendered.html).toContain('href="https://example.com"');
    expect(rendered.html).toContain('src="{{WXIMG:0}}"');
    expect(rendered.images).toEqual(['/media/a.jpg']);
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('alert(1)');
    expect(rendered.html).not.toContain('<style');

    const finalHtml = substituteWechatImages(rendered.html, ['https://mmbiz.qpic.cn/example.jpg']);
    expect(finalHtml).toContain('src="https://mmbiz.qpic.cn/example.jpg"');
    expect(finalHtml).not.toContain('{{WXIMG:');
  });

  it('supports GFM tables/lists and safely truncates by Unicode code point', () => {
    const rendered = renderWechatContent('| A | B |\n| - | - |\n| 1 | 2 |\n\n- 一\n- 二');
    expect(rendered.html).toContain('<table style=');
    expect(rendered.html).toContain('<ul style=');
    expect(rendered.html).toContain('<li style=');
    expect(truncateChars('甲😀乙', 2)).toBe('甲😀');
    expect(truncateChars('abc', 4)).toBe('abc');
  });

  it('enforces strict HTML character and byte limits', () => {
    expect(validateWechatContent('<p>ok</p>')).toBeNull();
    expect(validateWechatContent('a'.repeat(20_000))).toContain('2 万字符');
  });

  it('rejects unsupported or oversized body images with their identifying label', () => {
    expect(() =>
      validateWechatContentImage('image/webp', 100, '第 2 张正文图片（/media/example.webp）'),
    ).toThrow(/第 2 张正文图片（\/media\/example\.webp）.*image\/webp.*只支持 jpg\/png/);
    expect(() =>
      validateWechatContentImage('image/jpeg', 1024 * 1024, '第 1 张正文图片（图.jpg）'),
    ).toThrow(/第 1 张正文图片（图\.jpg）.*1024KB.*1MB/);
    expect(() => validateWechatContentImage('image/png', 1024 * 1024 - 1, '图.png')).not.toThrow();
  });
});

describe('WeChat API client', () => {
  it('caches stable access tokens across API calls', async () => {
    const { env, kv } = createEnv();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/cgi-bin/stable_token')) return jsonResponse({ access_token: 'cached-token', expires_in: 7200 });
      if (url.includes('/cgi-bin/draft/add')) return jsonResponse({ media_id: 'draft-media-id' });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(addDraft(env, SETTINGS, ARTICLE)).resolves.toBe('draft-media-id');
    await expect(addDraft(env, SETTINGS, ARTICLE)).resolves.toBe('draft-media-id');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(kv.put).toHaveBeenCalledWith('wechat:token:wx-test-app', 'cached-token', { expirationTtl: 6900 });
  });

  it('force-refreshes a rejected token and retries only once', async () => {
    const { env, kv } = createEnv();
    let draftCalls = 0;
    const tokenBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/cgi-bin/stable_token')) {
        tokenBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        const refreshed = tokenBodies.length === 2;
        return jsonResponse({ access_token: refreshed ? 'fresh-token' : 'stale-token', expires_in: 7200 });
      }
      if (url.includes('/cgi-bin/draft/add')) {
        draftCalls += 1;
        if (draftCalls === 1) return jsonResponse({ errcode: 40014, errmsg: 'invalid access token' });
        expect(url).toContain('access_token=fresh-token');
        return jsonResponse({ media_id: 'draft-media-id' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(addDraft(env, SETTINGS, ARTICLE)).resolves.toBe('draft-media-id');

    expect(kv.delete).toHaveBeenCalledWith('wechat:token:wx-test-app');
    expect(tokenBodies).toHaveLength(2);
    expect(tokenBodies[0]?.['force_refresh']).toBe(false);
    expect(tokenBodies[1]?.['force_refresh']).toBe(true);
    expect(draftCalls).toBe(2);
  });

  it('maps WeChat errcodes to upstream errors without leaking the AppSecret', async () => {
    const { env } = createEnv();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/cgi-bin/stable_token')) return jsonResponse({ access_token: 'token', expires_in: 7200 });
      return jsonResponse({ errcode: 45009, errmsg: 'api freq out of limit' });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await addDraft(env, SETTINGS, ARTICLE);
      throw new Error('expected addDraft to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as Error).message).toContain('45009');
      expect((err as Error).message).toContain('api freq out of limit');
      expect((err as Error).message).not.toContain(SETTINGS.appSecret);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
