/**
 * Shared write helpers for posts.
 *
 * Extracted from `api/posts.ts` so the HTTP routes and the AI tool layer use
 * exactly the same slug / tag / publish-time rules.
 */
import type { PostStatus } from '@shared/types';
import { all, batch, placeholders } from './db';
import type { Env } from './env';
import { AppError } from './errors';
import { slugify } from './sanitize';
import { nowSql, toSqlDateTime } from './datetime';

/** Find a slug that is not already used (ignoring `ignoreId` when updating). */
export async function uniqueSlug(env: Env, base: string, ignoreId: number | null): Promise<string> {
  const root = slugify(base) || 'post';
  // One prefix query instead of an EXISTS probe per candidate: the loop used to
  // cost up to 200 sequential D1 round trips on a heavily suffixed title.
  const rows = await all<{ id: number; slug: string }>(
    env,
    'SELECT id, slug FROM posts WHERE slug = ? OR slug LIKE ?',
    root,
    `${root}-%`,
  );
  const taken = new Set(rows.filter((r) => ignoreId === null || r.id !== ignoreId).map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 200; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Resolve tag names to ids, creating missing tags on the fly. */
export async function resolveTagIds(env: Env, names: string[]): Promise<number[]> {
  // slug -> name, de-duplicated (two names may slugify to the same value).
  const wanted = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const slug = slugify(name);
    if (!wanted.has(slug)) wanted.set(slug, name);
  }
  if (wanted.size === 0) return [];

  const slugs = [...wanted.keys()];
  const bySlug = new Map<string, number>();
  const existing = await all<{ id: number; slug: string }>(
    env,
    `SELECT id, slug FROM tags WHERE slug IN (${placeholders(slugs.length)})`,
    ...slugs,
  );
  for (const row of existing) bySlug.set(row.slug, row.id);

  const missing = [...wanted].filter(([slug]) => !bySlug.has(slug));
  if (missing.length > 0) {
    const statements = missing.map(([slug, name]) =>
      env.DB.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)').bind(name, slug),
    );
    await batch(env, statements);

    const inserted = await all<{ id: number; slug: string }>(
      env,
      `SELECT id, slug FROM tags WHERE slug IN (${placeholders(missing.length)})`,
      ...missing.map(([slug]) => slug),
    );
    for (const row of inserted) bySlug.set(row.slug, row.id);

    // A tag with the same *name* but a different slug (renamed by hand) is
    // still the tag the author meant — reuse it instead of dropping it.
    const unresolved = missing.filter(([slug]) => !bySlug.has(slug));
    if (unresolved.length > 0) {
      const byName = await all<{ id: number; name: string }>(
        env,
        `SELECT id, name FROM tags WHERE name IN (${placeholders(unresolved.length)})`,
        ...unresolved.map(([, name]) => name),
      );
      const idByName = new Map(byName.map((r) => [r.name, r.id]));
      for (const [slug, name] of unresolved) {
        const id = idByName.get(name);
        if (id !== undefined) bySlug.set(slug, id);
      }
    }
  }

  return [...bySlug.values()];
}

/** Replace a post's tag set. */
export async function setPostTags(env: Env, postId: number, tagIds: number[]): Promise<void> {
  const statements = [env.DB.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(postId)];
  for (const tagId of tagIds) {
    statements.push(
      env.DB.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(
        postId,
        tagId,
      ),
    );
  }
  await batch(env, statements);
}

/** Drafts may have no publish time; scheduled posts require a future time. */
export function resolvePublishedAt(
  status: PostStatus,
  publishedAt: string | null | undefined,
): string | null {
  if (status === 'draft') return null;
  if (status === 'scheduled') {
    if (!publishedAt) throw AppError.badRequest('定时发布必须提供发布时间');
    const value = toSqlDateTime(publishedAt);
    if (value <= nowSql()) throw AppError.badRequest('定时发布时间必须晚于当前时间');
    return value;
  }
  return publishedAt ? toSqlDateTime(publishedAt) : nowSql();
}
