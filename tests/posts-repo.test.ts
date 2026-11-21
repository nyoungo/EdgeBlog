import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../functions/lib/env';

const mocks = vi.hoisted(() => ({
  all: vi.fn(),
  first: vi.fn(),
}));

vi.mock('../functions/lib/db', () => ({
  all: mocks.all,
  first: mocks.first,
}));

import { listPosts } from '../functions/lib/posts-repo';

/** 取最近一次列表查询（COUNT 与分页是并发发出的，按内容挑出带 ORDER BY 的那条）。 */
function lastListSql(): string {
  const sqls = mocks.all.mock.calls.map((call) => call[1] as string);
  return sqls.find((sql) => sql.includes('ORDER BY')) ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.first.mockResolvedValue({ total: 0 });
  mocks.all.mockResolvedValue([]);
});

describe('文章列表排序', () => {
  it('后台默认按更新时间倒序，刚写好的草稿不会因为缺少发布时间沉到最后一页', async () => {
    await listPosts({} as Env, { page: 1, perPage: 10, admin: true });

    expect(lastListSql()).toContain('ORDER BY p.updated_at DESC, p.id DESC');
  });

  it('后台「最久未更新」按更新时间正序', async () => {
    await listPosts({} as Env, { page: 1, perPage: 10, admin: true, sort: 'oldest' });

    expect(lastListSql()).toContain('ORDER BY p.updated_at ASC, p.id ASC');
  });

  it('公开列表不受影响：仍按发布时间排，置顶最前', async () => {
    await listPosts({} as Env, { page: 1, perPage: 10 });

    expect(lastListSql()).toContain('ORDER BY p.pinned DESC, p.published_at DESC');
  });
});
