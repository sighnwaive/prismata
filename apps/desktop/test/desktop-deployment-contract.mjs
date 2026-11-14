import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

test('desktop-owned runtime contract is authoritative', async () => {
  const [desktopPackage, service, transport, architecture] = await Promise.all([
    readFile(path.join(repoRoot, 'apps/desktop/package.json'), 'utf8'),
    readFile(path.join(repoRoot, 'apps/desktop/src/desktop-service.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'packages/sync/src/desktop.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'docs/architecture/desktop-owned-architecture.md'), 'utf8'),
  ]);

  assert.match(desktopPackage, /"electron"/);
  assert.match(service, /['"]\/api\/v1\/(health|instance|pairing\/start|settings|devices)/);
  assert.match(transport, /['"]\/api\/v1\/(health|instance|settings|devices)/);
  assert.match(architecture, /desktop.*authorit|desktop.*local/i);
  assert.doesNotMatch(service, /PRISMATA_BACKEND_URL|accessToken.*info/);
  assert.doesNotMatch(transport, /\/api\/v1\/info/);
});
