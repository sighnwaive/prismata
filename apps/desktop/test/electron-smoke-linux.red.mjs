import { spawn } from 'node:child_process';
import process from 'node:process';

if (process.platform !== 'linux') {
  process.exit(0);
}

const timeoutMs = 15000;
const child = spawn(
  'pnpm',
  ['--filter', '@prismata/desktop', 'exec', 'electron', 'electron/main.mjs'],
  {
    cwd: new URL('../../..', import.meta.url),
    detached: true,
    env: {
      ...process.env,
      PRISMATA_ELECTRON_SMOKE_TEST: '1',
    },
    stdio: 'pipe',
  },
);

let stderr = '';

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
  process.stderr.write(chunk);
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});

const timeout = setTimeout(() => {
  process.kill(-child.pid, 'SIGKILL');

  if (stderr.trim().length > 0) {
    process.stderr.write(stderr);
  }

  console.error(
    `red check failed: Electron smoke mode did not exit cleanly within ${timeoutMs}ms`,
  );
  process.exit(1);
}, timeoutMs);

child.on('exit', (code, signal) => {
  clearTimeout(timeout);

  if (code === 0) {
    process.exit(0);
    return;
  }

  if (signal) {
    console.error(`red check failed: Electron smoke mode exited via signal ${signal}`);
    process.exit(1);
    return;
  }

  console.error(`red check failed: Electron smoke mode exited with code ${code ?? 'null'}`);
  process.exit(1);
});
