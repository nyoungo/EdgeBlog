import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post, WechatSettings } from '../shared/types';
import type { Env } from '../functions/lib/env';

const mocks = vi.hoisted(() => ({
  all: vi.fn(),
  first: vi.fn(),
  run: vi.fn(),
  loadImageSource: vi.fn(),
  prepareImageForUpload: vi.fn(),
  addDraft: vi.fn(),
  updateDraft: vi.fn(),
  uploadContentImage: vi.fn(),
  uploadCoverMaterial: vi.fn(),
  submitPublish: vi.fn(),
}));

vi.mock('../functions/lib/db', () => ({
  all: mocks.all,
  first: mocks.first,
  run: mocks.run,
}));

vi.mock('../functions/lib/media-ingest', () => ({
  loadImageSource: mocks.loadImageSource,
}));

// 真正的压缩在 Worker 里由 wasm 完成（Node 下无法解码），这里只模拟「压缩完成」的结果，
// 用来验证编排顺序：先压缩、再把压缩结果上传。
vi.mock('../functions/lib/image-codec', () => ({
  prepareImageForUpload: mocks.prepareImageForUpload,
}));

vi.mock('../functions/lib/wechat', () => ({
  addDraft: mocks.addDraft,
  updateDraft: mocks.updateDraft,
  uploadContentImage: mocks.uploadContentImage,
  uploadCoverMaterial: mocks.uploadCoverMaterial,
  submitPublish: mocks.submitPublish,
}));

import { pushPostToWechatDraft } from '../functions/lib/wechat-draft';

const SETTINGS: WechatSettings = {
  enabled: true,
  appId: 'wx-test',
  appSecret: 'test-secret',
  author: '',
  openComment: false,
  onlyFansCanComment: false,
  bodyCoverPosition: 'top',
  repairPushFailures: true,
  miniprogramEnabled: false,
  miniprogramAppId: '',
  miniprogramPath: '',
  miniprogramTitle: '',
  miniprogramDesc: '',
  miniprogramImage: '',
  miniprogramButton: '',
};

const COVER_URL = 'https://images.example/random.jpg?token=abc';
const COVER_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
const COVER_SOURCE = { bytes: COVER_BYTES, mime: 'image/jpeg', filename: 'random.jpg' };

function post(contentMd: string): Post {
  return {
    id: 7,
    slug: 'test-post',
    title: '测试文章',
    excerpt: '',
    content_md: contentMd,
    cover_url: COVER_URL,
    status: 'draft',
    published_at: null,
    meta_title: null,
    meta_description: null,
    og_image: null,
    word_count: 0,
    featured: 0,
    pinned: 0,
    views: 0,
    author_id: null,
    column_id: null,
    created_at: '',
    updated_at: '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.first.mockResolvedValue(null);
  mocks.run.mockResolvedValue({ meta: { changes: 1, last_row_id: 1 } });
  mocks.loadImageSource.mockResolvedValue(COVER_SOURCE);
  // 默认「原图已合规」：原样返回，字节不变。
  mocks.prepareImageForUpload.mockImplementation(async (bytes: Uint8Array, mime: string) => ({
    bytes,
    mime,
    width: 100,
    height: 100,
    attempts: 0,
    sourceWidth: 100,
    sourceHeight: 100,
    sourceBytes: bytes.byteLength,
    reencoded: false,
  }));
  mocks.uploadContentImage.mockResolvedValue('https://mmbiz.example/body-image.jpg');
  mocks.uploadCoverMaterial.mockResolvedValue('permanent-cover-id');
  mocks.addDraft.mockResolvedValue('draft-media-id');
});

describe('公众号封面复用同一次图片读取', () => {
  it('正文已经嵌入封面 URL（fragment 不同）时，只下载一次并复用同一份字节', async () => {
    const postWithEmbeddedCover = post(
      `正文图片：\n\n![封面](https://images.example/random.jpg?token=abc#body)`,
    );

    await pushPostToWechatDraft({} as Env, SETTINGS, postWithEmbeddedCover);

    expect(mocks.loadImageSource).toHaveBeenCalledTimes(1);
    expect(mocks.loadImageSource).toHaveBeenCalledWith(
      expect.anything(),
      COVER_URL,
      expect.objectContaining({ maxSize: 10 * 1024 * 1024 }),
    );
    expect(mocks.uploadContentImage).toHaveBeenCalledTimes(1);
    expect(mocks.uploadCoverMaterial).toHaveBeenCalledTimes(1);
    expect(mocks.uploadContentImage.mock.calls[0]?.[2]).toBe(COVER_BYTES);
    expect(mocks.uploadCoverMaterial.mock.calls[0]?.[2]).toBe(COVER_BYTES);
  });

  it('正文没有封面 URL 时，插入正文封面和 thumb_media_id 也共用一次读取', async () => {
    await pushPostToWechatDraft({} as Env, SETTINGS, post('只有普通文字的正文'));

    expect(mocks.loadImageSource).toHaveBeenCalledTimes(1);
    expect(mocks.uploadContentImage).toHaveBeenCalledTimes(1);
    expect(mocks.uploadCoverMaterial).toHaveBeenCalledTimes(1);
    expect(mocks.uploadContentImage.mock.calls[0]?.[2]).toBe(COVER_BYTES);
    expect(mocks.uploadCoverMaterial.mock.calls[0]?.[2]).toBe(COVER_BYTES);
  });
});

describe('推送前压缩图片', () => {
  it('正文图与封面都先压缩，上传的是压缩后的字节与格式', async () => {
    const compressed = new Uint8Array([1, 2, 3, 4, 5]);
    mocks.prepareImageForUpload.mockResolvedValue({
      bytes: compressed,
      mime: 'image/jpeg',
      width: 1440,
      height: 1080,
      attempts: 2,
      sourceWidth: 4032,
      sourceHeight: 3024,
      sourceBytes: 5_000_000,
      reencoded: true,
    });
    // 正文图是 webp，封面是 jpg：压缩后两者都变成 jpeg。
    mocks.loadImageSource.mockImplementation(async (_env: unknown, url: string) =>
      url.includes('photo.webp')
        ? { bytes: new Uint8Array([9, 9]), mime: 'image/webp', filename: 'photo.webp' }
        : COVER_SOURCE,
    );

    await pushPostToWechatDraft(
      {} as Env,
      SETTINGS,
      post('![配图](https://images.example/photo.webp)'),
    );

    // 正文图 + 封面各压一次（正文里没有封面 URL，插入的正文封面复用封面字节）。
    expect(mocks.prepareImageForUpload).toHaveBeenCalledTimes(2);
    // 压缩目标与微信正文图限制一致。
    expect(mocks.prepareImageForUpload).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'image/webp',
      expect.objectContaining({ maxBytes: 900_000, maxWidth: 1440 }),
    );

    // 先压缩，再上传：上传拿到的必须是压缩结果，而不是原图。
    expect(mocks.prepareImageForUpload.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.uploadContentImage.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.uploadContentImage).toHaveBeenCalledTimes(2);
    for (const call of mocks.uploadContentImage.mock.calls) {
      expect(call[2]).toBe(compressed);
      expect(call[3]).toBe('image/jpeg');
    }
    // 格式从 webp 转成 jpeg 后，文件名后缀要跟着换。
    expect(mocks.uploadContentImage.mock.calls[0]?.[4]).toBe('photo.jpg');
    expect(mocks.uploadCoverMaterial.mock.calls[0]?.[2]).toBe(compressed);
  });
});

describe('推送整体超时', () => {
  it('单张图片的下载超时按剩余预算收窄，不会各自等满 30 秒', async () => {
    await pushPostToWechatDraft({} as Env, SETTINGS, post('只有普通文字的正文'), {
      budgetMs: 5_000,
    });

    expect(mocks.loadImageSource).toHaveBeenCalledTimes(1);
    const options = mocks.loadImageSource.mock.calls[0]?.[2] as { timeoutMs?: number };
    expect(options.timeoutMs).toBeGreaterThan(0);
    expect(options.timeoutMs).toBeLessThanOrEqual(5_000);
  });

  it('预算耗尽后不再发起后续微信接口调用，并报出卡在哪一步', async () => {
    let clock = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    // 第一张图上传耗掉全部预算（模拟上传接口很慢）。
    mocks.uploadContentImage.mockImplementation(async () => {
      clock += 10_000;
      return 'https://mmbiz.example/body-image.jpg';
    });

    try {
      await expect(
        pushPostToWechatDraft({} as Env, SETTINGS, post('只有普通文字的正文'), {
          budgetMs: 5_000,
        }),
      ).rejects.toThrow(/推送超时/);
      // 预算耗尽后封面素材与草稿接口都不该被调用。
      expect(mocks.uploadCoverMaterial).not.toHaveBeenCalled();
      expect(mocks.addDraft).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });
});
