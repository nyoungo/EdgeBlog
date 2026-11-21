import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { MEDIA_IN_USE_SQL } from '../functions/lib/media-usage';

// Vite 会把 `import ... from 'node:sqlite'` 误解析成裸模块 `sqlite`，改用 require。
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/**
 * 「未使用」判定直接决定清理会删掉哪些文件，所以用真实 SQLite 跑一遍，
 * 防止后续改动 WHERE 条件时误删仍在引用的图片。
 */
function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE media (id INTEGER PRIMARY KEY, key TEXT, url TEXT, size INTEGER);
    CREATE TABLE posts (cover_url TEXT, og_image TEXT, content_md TEXT);
    CREATE TABLE columns (cover_url TEXT);
    CREATE TABLE automation_tasks (cover_url TEXT);
    CREATE TABLE automation_runs (cover_url TEXT);
    CREATE TABLE settings (value_json TEXT);
  `);
  return db;
}

function addMedia(db: DatabaseSync, key: string): void {
  db.prepare('INSERT INTO media (key, url, size) VALUES (?, ?, 100)').run(
    key,
    `https://cdn.example.com/media/${key}`,
  );
}

function isUsed(db: DatabaseSync, key: string): boolean {
  const row = db
    .prepare(
      `SELECT CASE WHEN ${MEDIA_IN_USE_SQL} THEN 1 ELSE 0 END AS in_use
         FROM media m WHERE m.key = ?`,
    )
    .get(key) as { in_use: number } | undefined;
  return row?.in_use === 1;
}

describe('MEDIA_IN_USE_SQL', () => {
  it('counts posts covers, OG images and inline Markdown references', () => {
    const db = makeDb();
    addMedia(db, 'a/cover.jpg');
    addMedia(db, 'a/og.jpg');
    addMedia(db, 'a/inline.png');
    db.exec(`INSERT INTO posts (cover_url, og_image, content_md) VALUES
      ('https://cdn.example.com/media/a/cover.jpg', NULL, 'plain'),
      (NULL, 'https://cdn.example.com/media/a/og.jpg', 'plain'),
      (NULL, NULL, '![x](https://cdn.example.com/media/a/inline.png)')`);

    expect(isUsed(db, 'a/cover.jpg')).toBe(true);
    expect(isUsed(db, 'a/og.jpg')).toBe(true);
    expect(isUsed(db, 'a/inline.png')).toBe(true);
  });

  it('counts column, automation and settings references', () => {
    const db = makeDb();
    addMedia(db, 'a/column.png');
    addMedia(db, 'a/task.png');
    addMedia(db, 'a/run.png');
    addMedia(db, 'a/setting.webp');
    db.exec(`INSERT INTO columns (cover_url) VALUES ('https://cdn.example.com/media/a/column.png')`);
    db.exec(`INSERT INTO automation_tasks (cover_url) VALUES ('https://cdn.example.com/media/a/task.png')`);
    db.exec(`INSERT INTO automation_runs (cover_url) VALUES ('https://cdn.example.com/media/a/run.png')`);
    db.exec(`INSERT INTO settings (value_json) VALUES ('{"backgroundImage":"https://cdn.example.com/media/a/setting.webp"}')`);

    expect(isUsed(db, 'a/column.png')).toBe(true);
    expect(isUsed(db, 'a/task.png')).toBe(true);
    expect(isUsed(db, 'a/run.png')).toBe(true);
    expect(isUsed(db, 'a/setting.webp')).toBe(true);
  });

  it('treats files nobody references as unused', () => {
    const db = makeDb();
    addMedia(db, 'a/orphan.jpg');
    db.exec(`INSERT INTO posts (cover_url, og_image, content_md) VALUES
      ('https://cdn.example.com/media/a/other.jpg', NULL, 'text')`);

    expect(isUsed(db, 'a/orphan.jpg')).toBe(false);
  });
});
