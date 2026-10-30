import { describe, expect, it } from 'vitest';
import type { Comment } from '@shared/types';
import { buildTree } from '../functions/api/comments';

function row(id: number, parentId: number | null): Omit<Comment, 'replies'> {
  return {
    id,
    post_id: 1,
    parent_id: parentId,
    author: `user${id}`,
    content: `comment ${id}`,
    status: 'approved',
    created_at: '2026-01-01 00:00:00',
  };
}

describe('buildTree', () => {
  it('returns an empty list for no rows', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('nests replies under their parent and keeps order', () => {
    const tree = buildTree([row(1, null), row(2, 1), row(3, 1), row(4, 2), row(5, null)]);
    expect(tree.map((c) => c.id)).toEqual([1, 5]);
    const first = tree[0];
    expect(first?.replies?.map((c) => c.id)).toEqual([2, 3]);
    expect(first?.replies?.[0]?.replies?.map((c) => c.id)).toEqual([4]);
  });

  it('promotes an orphan to the root instead of dropping it', () => {
    // Can happen if a parent row is filtered out (e.g. not yet approved).
    const tree = buildTree([row(2, 99)]);
    expect(tree.map((c) => c.id)).toEqual([2]);
  });

  it('does not mutate the input rows', () => {
    const rows = [row(1, null)];
    buildTree(rows);
    expect('replies' in rows[0]!).toBe(false);
  });
});
