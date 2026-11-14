import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopAuthCoordinator,
  type CredentialStore,
  type DesktopAuthSnapshot,
} from '../src/auth-coordinator.js';

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: '2026-09-24T01:00:00.000Z',
  state: 'authenticated' as const,
  userId: 'user-123',
};

test('sign-in starts the provider, opens the browser, validates callback state, and stores no renderer secret', async () => {
  const opened: string[] = [];
  const store = memoryStore();
  const coordinator = createDesktopAuthCoordinator({
    backend: {
      start: async (input) => {
        assert.equal(input.codeChallengeMethod, 'S256');
        assert.match(input.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
        return { authorizeUrl: 'https://joystick.test/authorize', state: 'state-123', redirectUri: '' };
      },
      complete: async (callbackUrl, options) => {
        assert.equal(new URL(callbackUrl).searchParams.get('state'), 'state-123');
        assert.equal(new URL(callbackUrl).searchParams.get('code_verifier'), null);
        assert.equal(typeof options?.codeVerifier, 'string');
        return session;
      },
      restore: async () => null,
      refresh: async () => session,
      signOut: async () => undefined,
      registerDevice: async () => undefined,
      pullSettings: async () => undefined,
    },
    browser: async (url) => { opened.push(url); },
    store,
    createCallbackServer: async () => ({
      redirectUri: 'http://127.0.0.1:43110/auth/callback',
      waitForCallback: async () => 'http://127.0.0.1:43110/auth/callback?code=code-123&state=state-123',
      close: async () => undefined,
    }),
  });

  await coordinator.signInWithJoystick();

  assert.deepEqual(opened, ['https://joystick.test/authorize']);
  assert.deepEqual(await store.get('prismata.auth.session'), session);
  assert.equal(coordinator.getSnapshot().state, 'authenticated');
});

test('startup restore is non-blocking and secure-store failures become offline state', async () => {
  let releaseRestore!: () => void;
  const restore = new Promise<null>((resolve) => { releaseRestore = () => resolve(null); });
  const snapshots: DesktopAuthSnapshot[] = [];
  const coordinator = createDesktopAuthCoordinator({
    backend: {
      start: async () => { throw new Error('unused'); },
      complete: async () => { throw new Error('unused'); },
      restore: async () => restore,
      refresh: async () => session,
      signOut: async () => undefined,
      registerDevice: async () => undefined,
      pullSettings: async () => undefined,
    },
    browser: async () => undefined,
    store: { get: async () => { throw new Error('credential store unavailable'); }, set: async () => undefined, delete: async () => undefined },
    createCallbackServer: async () => { throw new Error('unused'); },
    onStateChanged: (snapshot) => snapshots.push(snapshot),
  });

  const startup = coordinator.restoreOnStartup();
  assert.equal(coordinator.getSnapshot().state, 'offline');
  releaseRestore();
  await startup;
  assert.equal(snapshots[snapshots.length - 1]?.state, 'offline');
});

test('callback state mismatch and timeout never complete authentication', async () => {
  const coordinator = createDesktopAuthCoordinator({
    timeoutMs: 5,
    backend: {
      start: async () => ({ authorizeUrl: 'https://joystick.test/authorize', state: 'expected', redirectUri: '' }),
      complete: async () => { throw new Error('must not complete'); },
      restore: async () => null,
      refresh: async () => session,
      signOut: async () => undefined,
      registerDevice: async () => undefined,
      pullSettings: async () => undefined,
    },
    browser: async () => undefined,
    store: memoryStore(),
    createCallbackServer: async () => ({
      redirectUri: 'http://127.0.0.1:43110/auth/callback',
      waitForCallback: async () => new Promise<string>(() => undefined),
      close: async () => undefined,
    }),
  });

  await assert.rejects(coordinator.signInWithJoystick(), /authentication cancelled/);
  assert.equal(coordinator.getSnapshot().state, 'signed-out');
});

test('shutdown cancels pending authentication and closes its callback server', async () => {
  let closed = 0;
  let rejectCallback!: (error: Error) => void;
  const coordinator = createDesktopAuthCoordinator({
    backend: {
      start: async () => ({ authorizeUrl: 'https://joystick.test/authorize', state: 'expected', redirectUri: '' }),
      complete: async () => { throw new Error('must not complete'); },
      restore: async () => null,
      refresh: async () => session,
      signOut: async () => undefined,
      registerDevice: async () => undefined,
      pullSettings: async () => undefined,
    },
    browser: async () => undefined,
    store: memoryStore(),
    createCallbackServer: async () => ({
      redirectUri: 'http://127.0.0.1:43110/auth/callback',
      waitForCallback: async () => new Promise<string>((_resolve, reject) => { rejectCallback = reject; }),
      close: async () => { closed += 1; },
    }),
  });
  const signIn = coordinator.signInWithJoystick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await coordinator.close();
  rejectCallback(new Error('closed'));
  await assert.rejects(signIn, /authentication cancelled|closed/);
  assert.equal(closed, 1);
});

function memoryStore(): CredentialStore & { get(key: string): Promise<unknown> } {
  const values = new Map<string, unknown>();
  return {
    get: async (key) => values.get(key),
    set: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  };
}
