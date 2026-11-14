/**
 * 部署前的数据库自举：让「Deploy to Cloudflare」一键部署完成后站点直接可用。
 *
 * - 空库（还没有 `users` 表）：执行 `db/init.sql`（0001–0009 + seed），
 *   建表、建索引/触发器、写入默认管理员与站点配置；
 * - 已有数据的库：只做检查，不执行任何写操作，避免误改线上数据。
 *
 * 为什么不用 `wrangler d1 migrations apply`：
 * 本仓库的 SQL 文件是「空库一次性执行」语义，而早期部署的库并没有
 * `d1_migrations` 记录表，重放 0001 会在 `ALTER TABLE ... ADD COLUMN`
 * 处报 `duplicate column name`。所以这里直接判断表结构，而不是判断迁移记录。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE = process.env.D1_BINDING || 'DB';
const TAG = '[db-bootstrap]';

// 直接跑 node_modules 里的 wrangler 入口：Windows 下 spawn 一个 .cmd 在
// Node 18.20+/20.12+ 会抛 EINVAL，用 node 执行 JS 入口在各平台都稳。
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_BIN = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!existsSync(WRANGLER_BIN)) {
  throw new Error(`${TAG} 找不到 wrangler，请先执行 npm install`);
}

/** 调用 wrangler 并返回 stdout（stderr 只在失败时随异常抛出）。 */
function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_BIN, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** 查询远程 D1，返回第一行结果对象；没有行时返回 null。 */
function query(sql) {
  const out = wrangler(['d1', 'execute', DATABASE, '--remote', '--json', '--command', sql]);
  // wrangler 会在 JSON 前后打印日志，截取最外层的数组再解析。
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error(`${TAG} 无法解析 D1 返回：\n${out}`);
  }
  const batches = JSON.parse(out.slice(start, end + 1));
  for (const batch of batches) {
    const rows = batch?.results;
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return null;
}

const hasUsers = query(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users';",
);

if (hasUsers) {
  console.log(`${TAG} 数据库已初始化，跳过建表`);
  process.exit(0);
}

console.log(`${TAG} 检测到空数据库，执行 db/init.sql …`);
execFileSync(process.execPath, [WRANGLER_BIN, 'd1', 'execute', DATABASE, '--remote', '--file=./db/init.sql'], {
  stdio: 'inherit',
});

// 校验种子数据确实写入：只建了表却没有默认配置时，后台会是一片空白。
const seeded = query('SELECT count(*) AS n FROM settings;');
if (!seeded || Number(seeded.n) === 0) {
  console.log(`${TAG} 建表完成但缺少默认配置，补写 seed/seed.sql …`);
  execFileSync(process.execPath, [WRANGLER_BIN, 'd1', 'execute', DATABASE, '--remote', '--file=./seed/seed.sql'], {
    stdio: 'inherit',
  });
}

console.log(`${TAG} 初始化完成`);