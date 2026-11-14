import assert from 'node:assert/strict';
import test from 'node:test';

import type { DesktopAuthSnapshot, DesktopAuthState } from '../src/auth-coordinator.js';
import { createAuthPreloadApi } from '../electron/preload-api.js';

test('preload API exposes typed auth commands and state subscription without tokens', () => {
  const calls: string[] = [];
  const snapshot: DesktopAuthSnapshot = { state: 'signed-out', userId: null, expiresAt: null, error: null };
  const api = createAuthPreloadApi({
    getSnapshot: async () => snapshot,
    signInWithJoystick: async () => undefined,
    cancel: async () => undefined,
    signOut: async () => undefined,
    onStateChanged: (listener) => { listener(snapshot); return () => undefined; },
  });

  assert.deepEqual(Object.keys(api).sort(), ['cancel', 'getSnapshot', 'onStateChanged', 'signInWithJoystick', 'signOut']);
  assert.equal((api as Record<string, unknown>).accessToken, undefined);
  assert.equal((api as Record<string, unknown>).refreshToken, undefined);
  void calls;
});

const desktopAuthStates: DesktopAuthState[] = ['signed-out', 'opening-browser', 'waiting-for-callback', 'authenticated', 'failure', 'offline'];
void desktopAuthStates;
