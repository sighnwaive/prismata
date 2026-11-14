import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopAuthCoordinator } from '../src/auth-coordinator.js';

test('auth shutdown closes a callback server created after shutdown begins', async () => {
  let releaseCallbackServer!: () => void;
  let closed = 0;
  const callbackServer = {
    redirectUri: 'http://127.0.0.1:43110/auth/callback',
    waitForCallback: async () => new Promise<string>(() => {}),
    close: async () => { closed += 1; },
  };
  const coordinator = createDesktopAuthCoordinator({
    backend: { start: async () => ({ authorizeUrl: 'https://example.test', state: 'state', redirectUri: callbackServer.redirectUri }), complete: async () => { throw new Error('unused'); }, restore: async () => null, refresh: async () => { throw new Error('unused'); }, signOut: async () => {}, registerDevice: async () => {}, pullSettings: async () => {} },
    browser: async () => {},
    store: { get: async () => null, set: async () => {}, delete: async () => {} },
    createCallbackServer: async () => new Promise((resolve) => { releaseCallbackServer = () => resolve(callbackServer); }),
  });
  const signIn = coordinator.signInWithJoystick();
  await coordinator.close();
  releaseCallbackServer();
  await assert.rejects(signIn, /authentication cancelled/);
  assert.equal(closed, 1);
});

test('auth coordinator exposes only the current session to main-process consumers', () => {
  const coordinator = createDesktopAuthCoordinator({
    backend: { start: async () => { throw new Error('unused'); }, complete: async () => { throw new Error('unused'); }, restore: async () => null, refresh: async () => { throw new Error('unused'); }, signOut: async () => {}, registerDevice: async () => {}, pullSettings: async () => {} },
    browser: async () => {},
    store: { get: async () => null, set: async () => {}, delete: async () => {} },
    createCallbackServer: async () => { throw new Error('unused'); },
  });
  assert.equal(coordinator.getSession(), null);
});
