/**
 * Build db/init.sql: every migration followed by the seed data, in the exact
 * order they must be applied to a brand-new D1 database.
 *
 * Why bundle at all? The documented install path is the browser-only D1
 * Console, which has no way to run a file: users have to copy SQL *content*.
 * One file is far harder to get wrong than seven (and pasting a file *path*
 * into the console is exactly what produced the
 * `near "migrations": syntax error at offset 0` reports).
 *
 * The bundle is committed so GitHub users can open it directly, and CI runs
 * this script and checks that the committed copy is up to date.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Apply order matters: 0001 creates tables that later files alter. */
const SOURCES = [
  'migrations/0001_init.sql',
  'migrations/0002_fts.sql',
  'migrations/0003_auth_hardening.sql',
  'migrations/0004_write_amplification.sql',
  'migrations/0005_audit_and_soft_delete.sql',
  'migrations/0006_media_thumbnail.sql',
  'migrations/0007_columns.sql',
  'seed/seed.sql',
];

const header = `-- ============================================================================
-- Edge Blog — complete database initialization (generated file, do not edit)
--
-- Apply this file ONCE to a brand-new, empty D1 database. It concatenates:
${SOURCES.map((file) => `--   * ${file}`).join('\n')}
--
-- Regenerate with: npm run db:bundle
--
-- If the database has already been initialized, do not run this file again:
-- the ALTER TABLE statements in 0003/0005/0006/0007 will fail with
-- "duplicate column name". See README.md -> 初始化远程数据库.
-- ============================================================================
`;

const sections = SOURCES.map((file) => {
  const sql = readFileSync(join(root, file), 'utf8').trimEnd();
  return `-- ---------------------------------------------------------------------------\n-- ${file}\n-- ---------------------------------------------------------------------------\n\n${sql}\n`;
});

const output = `${header}\n${sections.join('\n')}`;
mkdirSync(join(root, 'db'), { recursive: true });
writeFileSync(join(root, 'db', 'init.sql'), output, 'utf8');
console.log(`Wrote db/init.sql (${SOURCES.length} files, ${output.length} bytes)`);
