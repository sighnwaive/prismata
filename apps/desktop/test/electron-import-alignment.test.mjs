import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const mainPath = path.resolve(import.meta.dirname, '../electron/main.mjs');

test('Electron main-process destructuring stays aligned with Promise.all imports', async () => {
  const source = await readFile(mainPath, 'utf8');
  const destructuring = source.match(/const \[([\s\S]*?)\n\] = await Promise\.all\(/)?.[1];
  const imports = source.match(/await Promise\.all\(\[([\s\S]*?)\n\]\);/)?.[1];

  assert.ok(destructuring, 'main.mjs should destructure the startup modules');
  assert.ok(imports, 'main.mjs should load startup modules with Promise.all');

  const names = [...destructuring.matchAll(/\{\s*([^}\s,]+)[^}]*\}/g)].map((match) => match[1]);
  const paths = [...imports.matchAll(/import\('([^']+)'\)/g)].map((match) => match[1]);

  assert.deepEqual(names, [
    'appName',
    'desktopOAuthRedirectUri',
    'startDesktopApp',
    'createDesktopLifecycle',
    'parseJoystickTodoEvent',
    'createDesktopAuthCoordinator',
    'createElectronCredentialStore',
    'createLoopbackCallbackServer',
    'createDesktopJoystickBackend',
    'createDesktopShellContract',
    'createFlipACoinScheduler',
    'createAuthenticatedJoystickChatSender',
    'createDirectMessageSender',
    'normalizeReminderSettings',
    'renderShellPage',
    'createJoystickActionCableGateway',
    'createJoystickWhisperClient',
    'createJoystickWhisperRuntime',
    'createJoystickEventLogger',
  ]);
  assert.deepEqual(paths, [
    '@prismata/core',
    '../src/auth-flow.ts',
    '../src/main.ts',
    '../src/desktop-lifecycle.ts',
    '../src/desktop-service.ts',
    '../src/auth-coordinator.ts',
    './credential-store.ts',
    './loopback.ts',
    '../src/joystick-oauth.ts',
    './main.ts',
    '../src/flip-a-coin-scheduler.ts',
    '../src/joystick-chat.ts',
    '../src/direct-message.ts',
    '../src/reminder-settings.ts',
    './shell-page.ts',
    '../src/joystick-gateway.ts',
    '../src/joystick-whispers.ts',
    './joystick-whisper-runtime.ts',
    '../src/joystick-event-log.ts',
  ]);
});
