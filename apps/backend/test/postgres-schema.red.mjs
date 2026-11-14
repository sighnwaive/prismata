import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const migrationsDirectory = path.join(repoRoot, 'supabase', 'migrations');

const readMigrationSql = async () => {
  const entries = await readdir(migrationsDirectory, {
    withFileTypes: true,
  });

  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => path.join(migrationsDirectory, entry.name));

  const contents = await Promise.all(sqlFiles.map((filePath) => readFile(filePath, 'utf8')));

  return contents.join('\n\n');
};

test('postgres schema artifacts define the initial auth and sync tables from the PRD', async () => {
  const migrationSql = await readMigrationSql();

  assert.match(migrationSql, /create table if not exists public\.users\b/i);
  assert.match(migrationSql, /create table if not exists public\.(auth_accounts|linked_accounts)\b/i);
  assert.match(migrationSql, /create table if not exists public\.sessions\b/i);
  assert.match(migrationSql, /create table if not exists public\.devices\b/i);
  assert.match(migrationSql, /create table if not exists public\.user_settings\b/i);
});
