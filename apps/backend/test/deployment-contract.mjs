import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

test('Docker deployment contract is explicit and PRD-aligned', async () => {
  const [compose, readme, backendPackage, config, migrationRunner] = await Promise.all([
    readFile(path.join(repoRoot, 'compose.yml'), 'utf8'),
    readFile(path.join(repoRoot, 'README.md'), 'utf8'),
    readFile(path.join(repoRoot, 'apps/backend/package.json'), 'utf8'),
    readFile(path.join(repoRoot, 'apps/backend/src/config.mjs'), 'utf8'),
    readFile(path.join(repoRoot, 'scripts/migrate.mjs'), 'utf8'),
  ]);

  assert.match(compose, /backend:/);
  assert.match(compose, /depends_on:[\s\S]*postgres:[\s\S]*condition:\s*service_healthy/);
  assert.match(compose, /DATABASE_URL:/);
  assert.match(compose, /JOYSTICK_CLIENT_ID:/);
  assert.match(compose, /PRISMATA_JWT_SECRET:/);
  assert.match(compose, /PRISMATA_SESSION_SECRET:/);
  assert.match(compose, /PRISMATA_PUBLIC_URL:/);
  assert.match(compose, /PRISMATA_DESKTOP_CALLBACK_URL:/);
  assert.match(compose, /PRISMATA_MOBILE_CALLBACK_URL:/);
  assert.match(compose, /healthcheck:/g);
  assert.match(compose, /migrate/);
  assert.match(backendPackage, /"start"/);
  assert.match(backendPackage, /"migrate"/);
  for (const variable of [
    'DATABASE_URL', 'JOYSTICK_CLIENT_ID', 'JOYSTICK_CLIENT_SECRET',
    'PRISMATA_JWT_SECRET', 'PRISMATA_SESSION_SECRET', 'PRISMATA_API_URL',
    'PRISMATA_PUBLIC_URL', 'PRISMATA_DESKTOP_CALLBACK_URL', 'PRISMATA_MOBILE_CALLBACK_URL',
  ]) assert.match(config, new RegExp(variable));
  assert.match(migrationRunner, /['"]db['"][\s\S]*['"]migrations['"]/);
  assert.doesNotMatch(migrationRunner, /supabase[\\/]migrations/);
  assert.match(readme, /pnpm run db:migrate/);
  assert.match(readme, /docker compose --env-file \.env up -d --build/);
  assert.match(readme, /JOYSTICK_CLIENT_ID=.*JOYSTICK_CLIENT_SECRET=.*PRISMATA_JWT_SECRET=.*PRISMATA_SESSION_SECRET/s);
  assert.doesNotMatch(readme, /supabase start/i);
  assert.doesNotMatch(readme, /device_records.*support/i);
});
