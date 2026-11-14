import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const backendDirectory = new URL('..', import.meta.url);
const configurationVariables = [
  'DATABASE_URL',
  'JOYSTICK_CLIENT_ID',
  'JOYSTICK_CLIENT_SECRET',
  'JOYSTICK_TOKEN_URL',
  'PRISMATA_JWT_SECRET',
  'PRISMATA_SESSION_SECRET',
  'PRISMATA_API_URL',
  'PRISMATA_PUBLIC_URL',
  'PRISMATA_DESKTOP_CALLBACK_URL',
  'PRISMATA_MOBILE_CALLBACK_URL',
];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('direct backend startup loads the repo-root .env', async () => {
  const environment = { ...process.env, PRISMATA_API_PORT: '0' };
  for (const variable of configurationVariables) delete environment[variable];
  // The checked-in local env intentionally omits this operator-provided secret.
  environment.JOYSTICK_CLIENT_SECRET = 'test-placeholder';

  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: backendDirectory,
    env: environment,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  await wait(500);
  assert.equal(child.exitCode, null, `backend exited before startup validation: ${stderr}`);
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
});

test('repo-root .env does not override explicit environment variables', async () => {
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'explicit-test-value';
  try {
    const { loadBackendEnvironment } = await import('../../../scripts/load-backend-env.mjs');
    loadBackendEnvironment();
    assert.equal(process.env.DATABASE_URL, 'explicit-test-value');
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
});
