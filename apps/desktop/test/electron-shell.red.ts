import { appName } from '@prismata/core';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  desktopOAuthRedirectUri,
  handleDesktopOAuthCallback,
} from '../src/auth-flow';
import {
  createDesktopShellContract,
  getDesktopOAuthCallbackUrl,
  createDesktopLifecycleManager,
} from '../electron/main';

const contract = createDesktopShellContract({
  appName,
  oauthRedirectUri: desktopOAuthRedirectUri,
});

const windowTitle: string = contract.windowTitle;
const preloadEntry: string = contract.preloadEntry;
const callbackUrl: typeof desktopOAuthRedirectUri = getDesktopOAuthCallbackUrl(
  'code=test&state=test',
);

void handleDesktopOAuthCallback;
void windowTitle;
void preloadEntry;
void callbackUrl;

test('desktop lifecycle manager stops the existing lifecycle on recreation and shutdown', async () => {
  const events: string[] = [];
  const manager = createDesktopLifecycleManager(async (label: string) => ({ stop: async () => { events.push(`stop:${label}`); } }));
  await manager.create('first');
  await manager.create('second');
  await manager.stop();
  assert.deepEqual(events, ['stop:first', 'stop:second']);
});
