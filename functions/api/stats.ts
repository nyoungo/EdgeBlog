import { Hono } from 'hono';
import { all, first } from '../lib/db';
import { requireAuth } from '../lib/auth';
import type { AppEnv } from '../lib/env';
import { ok } from '../lib/response';

export const statsRoutes = new Hono<AppEnv>();

statsRoutes.use('*', requireAuth);

statsRoutes.get('/', async (c) => {
  c.header('Cache-Control', 'no-store');

  const [postTotals, postsByStatus, commentTotals, commentsByStatus, recentComments, recentPosts] =
    await Promise.all([
      first<{ posts: number; views: number }>(
        c.env,
        'SELECT COUNT(*) AS posts, COALESCE(SUM(views), 0) AS views FROM posts',
      ),
      all<{ status: string; count: number }>(
        c.env,
        'SELECT status, COUNT(*) AS count FROM posts GROUP BY status',
      ),
      first<{ comments: number }>(c.env, 'SELECT COUNT(*) AS comments FROM comments'),
      all<{ status: string; count: number }>(
        c.env,
        'SELECT status, COUNT(*) AS count FROM comments GROUP BY status',
      ),
      all<{
        id: number;
        author: string;
        content: string;
        status: string;
        created_at: string;
        post_title: string;
        post_slug: string;
      }>(
        c.env,
        `SELECT c.id, c.author, c.content, c.status, c.created_at, p.title AS post_title, p.slug AS post_slug
           FROM comments c JOIN posts p ON p.id = c.post_id
          ORDER BY c.created_at DESC LIMIT 5`,
      ),
      all<{
        id: number;
        slug: string;
        title: string;
        status: string;
        views: number;
        updated_at: string;
      }>(
        c.env,
        'SELECT id, slug, title, status, views, updated_at FROM posts ORDER BY updated_at DESC LIMIT 5',
      ),
    ]);

  const statusMap = (rows: Array<{ status: string; count: number }>) =>
    Object.fromEntries(rows.map((r) => [r.status, r.count]));

  const postsBy = statusMap(postsByStatus);
  const commentsBy = statusMap(commentsByStatus);

  return ok(c, {
    posts: {
      total: postTotals?.posts ?? 0,
      published: postsBy.published ?? 0,
      draft: postsBy.draft ?? 0,
      scheduled: postsBy.scheduled ?? 0,
    },
    views: postTotals?.views ?? 0,
    comments: {
      total: commentTotals?.comments ?? 0,
      pending: commentsBy.pending ?? 0,
      approved: commentsBy.approved ?? 0,
      rejected: commentsBy.rejected ?? 0,
      spam: commentsBy.spam ?? 0,
    },
    recentComments,
    recentPosts,
  });
});
