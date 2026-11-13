import { Hono } from 'hono';
import type { Column, MediaItem, Post, Tag } from '@shared/types';
import { requireAdmin } from '../lib/auth';
import { all } from '../lib/db';
import type { AppEnv } from '../lib/env';
import { ok } from '../lib/response';
import { getSettings } from '../lib/settings';

export const exportRoutes = new Hono<AppEnv>();

exportRoutes.use('*', requireAdmin);

/**
 * One-shot JSON backup of the editable content model. Deliberately excludes
 * users/password hashes, login attempts and audit rows — this is a content
 * export, not a full database dump (that is what `wrangler d1 export` is for).
 */
exportRoutes.get('/', async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Content-Disposition', 'attachment; filename="edge-blog-export.json"');

  const [posts, tags, columns, media, settings] = await Promise.all([
    all<Post>(
      c.env,
      `SELECT * FROM posts WHERE deleted_at IS NULL ORDER BY id ASC`,
    ),
    all<Tag>(c.env, 'SELECT id, name, slug, created_at FROM tags ORDER BY id ASC'),
    all<Column>(c.env, 'SELECT * FROM columns ORDER BY sort_order ASC, id ASC'),
    all<MediaItem>(c.env, 'SELECT * FROM media ORDER BY id ASC'),
    getSettings(c.env),
  ]);

  return ok(c, {
    exportedAt: new Date().toISOString(),
    version: 1,
    posts,
    tags,
    columns,
    media,
    settings,
  });
});