import { spawn } from 'node:child_process';
import process from 'node:process';

const timeoutMs = 15000;
const expectedMarkers = [
  '[startup] main-entry',
  '[startup] ts-imports-loaded',
  '[startup] app-ready',
];

const child = spawn(
  'pnpm',
  ['--filter', '@prismata/desktop', 'exec', 'electron', 'electron/main.mjs'],
  {
    cwd: new URL('../../..', import.meta.url),
    detached: true,
    env: {
      ...process.env,
      PRISMATA_ELECTRON_SMOKE_TEST: '1',
      PRISMATA_ELECTRON_STARTUP_TRACE: '1',
    },
    stdio: 'pipe',
  },
);

let output = '';

function append(chunk) {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
}

child.stdout.on('data', append);
child.stderr.on('data', append);

const timeout = setTimeout(() => {
  process.kill(-child.pid, 'SIGKILL');
  console.error(
    `red check failed: Electron did not reach the post-whenReady marker within ${timeoutMs}ms`,
  );
  process.exit(1);
}, timeoutMs);

child.on('exit', (code, signal) => {
  clearTimeout(timeout);

  if (signal) {
    console.error(`red check failed: Electron startup trace exited via signal ${signal}`);
    process.exit(1);
    return;
  }

  if (code !== 0) {
    console.error(`red check failed: Electron startup trace exited with code ${code ?? 'null'}`);
    process.exit(1);
    return;
  }

  const missingMarkers = expectedMarkers.filter((marker) => !output.includes(marker));

  if (missingMarkers.length > 0) {
    console.error(
      `red check failed: missing startup trace marker(s): ${missingMarkers.join(', ')}`,
    );
    process.exit(1);
    return;
  }

  process.exit(0);
});
