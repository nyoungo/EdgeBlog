import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { MEDIA_IN_USE_SQL, buildMediaInUseSql } from '../functions/lib/media-usage';

/**
 * `node:sqlite` 只在 Node 22.5+ 存在，CI 可能跑在更老的版本上，所以拿不到就
 * 跳过真实 SQL 用例（下面的结构断言仍会执行）。
 *
 * 另外 Vite 会把 `import ... from 'node:sqlite'` 误解析成裸模块 `sqlite`，
 * 这里用 require 绕开静态分析。
 */
const sqlite = (() => {
  try {
    return createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  } catch {
    return null;
  }
})();

type Db = InstanceType<NonNullable<typeof sqlite>['DatabaseSync']>;

/**
 * 「未使用」判定直接决定清理会删掉哪些文件，所以用真实 SQLite 跑一遍，
 * 防止后续改动 WHERE 条件时误删仍在引用的图片。
 */
function makeDb(): Db {
  const db = new sqlite!.DatabaseSync(':memory:');
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

function addMedia(db: Db, key: string): void {
  db.prepare('INSERT INTO media (key, url, size) VALUES (?, ?, 100)').run(
    key,
    `https://cdn.example.com/media/${key}`,
  );
}

function isUsed(db: Db, key: string): boolean {
  const row = db
    .prepare(
      `SELECT CASE WHEN ${MEDIA_IN_USE_SQL} THEN 1 ELSE 0 END AS in_use
         FROM media m WHERE m.key = ?`,
    )
    .get(key) as { in_use: number } | undefined;
  return row?.in_use === 1;
}

describe('MEDIA_IN_USE_SQL', () => {
  it('covers every place a media URL can be referenced', () => {    // 结构断言：不依赖 SQLite，防止有人删掉某一条引用来源。
    for (const fragment of [
      'posts p',
      'p.cover_url',
      'p.og_image',
      'p.content_md',
      'columns c',
      'c.cover_url',
      'automation_tasks t',
      't.cover_url',
      'automation_runs r',
      'r.cover_url',
      'settings s',
      's.value_json',
    ]) {
      expect(MEDIA_IN_USE_SQL).toContain(fragment);
    }
  });

  const needsSqlite = sqlite ? it : it.skip;

  needsSqlite('counts posts covers, OG images and inline Markdown references', () => {
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

  needsSqlite('counts column, automation and settings references', () => {
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

  needsSqlite('treats files nobody references as unused', () => {
    const db = makeDb();
    addMedia(db, 'a/orphan.jpg');
    db.exec(`INSERT INTO posts (cover_url, og_image, content_md) VALUES
      ('https://cdn.example.com/media/a/other.jpg', NULL, 'text')`);

    expect(isUsed(db, 'a/orphan.jpg')).toBe(false);
  });
});

describe('buildMediaInUseSql', () => {
  it('omits references whose table or column is missing', () => {
    const sql = buildMediaInUseSql(new Set(['posts.cover_url', 'settings.value_json']));
    expect(sql).toContain('p.cover_url = m.url');
    expect(sql).toContain('settings s');
    expect(sql).not.toContain('p.og_image');
    expect(sql).not.toContain('p.content_md');
    expect(sql).not.toContain('columns c');
    expect(sql).not.toContain('automation_tasks');
    expect(sql).not.toContain('automation_runs');
  });

  it('ORs every available source together', () => {
    const sql = buildMediaInUseSql(new Set(['columns.cover_url', 'automation_runs.cover_url']));
    expect(sql).toMatch(/columns c[\s\S]+OR[\s\S]+automation_runs r/);
    expect(sql).not.toContain('posts p');
  });
});
