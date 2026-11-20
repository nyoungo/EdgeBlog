import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post, WechatSettings } from '../shared/types';
import type { Env } from '../functions/lib/env';

const mocks = vi.hoisted(() => ({
  all: vi.fn(),
  first: vi.fn(),
  run: vi.fn(),
  loadImageSource: vi.fn(),
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
