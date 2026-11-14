import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadBackendEnvironment } from './load-backend-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadBackendEnvironment();
const { Pool } = createRequire(path.join(repoRoot, 'apps', 'backend', 'package.json'))('pg');
const migrationsDirectory = path.join(repoRoot, 'db', 'migrations');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query('create table if not exists public.schema_migrations (filename text primary key, applied_at timestamptz not null default now())');
  const { rows: applied } = await pool.query('select filename from public.schema_migrations');
  const appliedNames = new Set(applied.map(({ filename }) => filename));
  const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();

  for (const filename of files) {
    if (appliedNames.has(filename)) continue;
    const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8');
    await pool.query('begin');
    try {
      await pool.query(sql);
      await pool.query('insert into public.schema_migrations (filename) values ($1)', [filename]);
      await pool.query('commit');
    } catch (error) {
      await pool.query('rollback');
      throw error;
    }
    console.log(`Applied ${filename}`);
  }
} finally {
  await pool.end();
}
