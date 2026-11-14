import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const composeFilePath = path.join(repoRoot, 'docker-compose.local-postgres.yml');
const readmeFilePath = path.join(repoRoot, 'README.md');

const fileExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

test('local Postgres dev environment is defined and documented', async () => {
  assert.equal(
    await fileExists(composeFilePath),
    true,
    'expected docker-compose.local-postgres.yml to exist for local Postgres development',
  );

  const [composeFile, readmeFile] = await Promise.all([
    readFile(composeFilePath, 'utf8'),
    readFile(readmeFilePath, 'utf8'),
  ]);

  assert.match(composeFile, /image:\s*postgres:15(?:\D|$)/i);
  assert.match(composeFile, /ports:\s*(?:.|\n|\r)*?['"]?5434:5432['"]?/i);
  assert.match(readmeFile, /docker compose -f docker-compose\.local-postgres\.yml up -d/i);
  assert.match(
    readmeFile,
    /DATABASE_URL=postgres(?:ql)?:\/\/postgres:postgres@(?:127\.0\.0\.1|localhost):5434\/prismata/i,
  );
});
