import assert from 'node:assert/strict';
import test from 'node:test';
import * as joystickOAuth from '../src/joystick-oauth.js';
import { createDesktopAuthCoordinator } from '../src/auth-coordinator.js';

type PermissionBoundary = {
  fetchJoystickGrantedPermissions(input: {
    accessToken: string;
    fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  }): Promise<string[]>;
  hasRequiredJoystickWhisperPermissions(grants: unknown): boolean;
};

const permissions = joystickOAuth as unknown as PermissionBoundary;

test('actual Joystick grants are read from GET /api/v1/me and not inferred from requested scopes', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const granted = await permissions.fetchJoystickGrantedPermissions({
    accessToken: 'session-token',
    fetch: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ data: { permissions: ['stream:read'] } }), { status: 200 });
    },
  });

  assert.equal(request?.url, 'https://api.joystick.tv/api/v1/me');
  assert.equal(new Headers(request?.init?.headers).get('authorization'), 'Bearer session-token');
  assert.deepEqual(granted, ['stream:read']);
  const requestedScopes = ['stream:read', 'chat:whisper:write'];
  assert.deepEqual(requestedScopes, ['stream:read', 'chat:whisper:write']);
  assert.equal(permissions.hasRequiredJoystickWhisperPermissions(granted), false);
  assert.equal(permissions.hasRequiredJoystickWhisperPermissions(['stream:read', 'chat:whisper:write']), true);
});

test('missing, malformed, or unknown Joystick grants fail the whisper permission gate closed', async () => {
  const missing = await permissions.fetchJoystickGrantedPermissions({
    accessToken: 'session-token',
    fetch: async () => new Response(JSON.stringify({ data: { permissions: null } }), { status: 200 }),
  });
  assert.deepEqual(missing, []);
  assert.equal(permissions.hasRequiredJoystickWhisperPermissions(missing), false);
  assert.equal(permissions.hasRequiredJoystickWhisperPermissions(['stream:read', 'chat:whisper:write:future']), false);
  assert.equal(permissions.hasRequiredJoystickWhisperPermissions({ stream: true, whisper: true }), false);
});

test('rotated credentials are persisted before the authenticated gateway consumer can use the session', async () => {
  const oldSession = {
    accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: '2026-10-25T11:00:00.000Z',
    state: 'authenticated' as const, userId: 'creator-1',
  };
  const rotatedSession = { ...oldSession, accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: '2026-10-25T16:00:00.000Z' };
  let persisted: typeof oldSession | null = null;
  const order: string[] = [];
  let coordinator!: ReturnType<typeof createDesktopAuthCoordinator>;
  coordinator = createDesktopAuthCoordinator({
    backend: {
      start: async () => { throw new Error('unused'); },
      complete: async () => { throw new Error('unused'); },
      restore: async () => null,
      refresh: async () => rotatedSession,
      signOut: async () => {},
      registerDevice: async () => {},
      pullSettings: async () => {},
    },
    browser: async () => {},
    store: {
      get: async () => oldSession,
      set: async (_key, value) => { persisted = value as typeof oldSession; order.push('persist'); },
      delete: async () => {},
    },
    createCallbackServer: async () => { throw new Error('unused'); },
    onStateChanged: (snapshot) => {
      if (snapshot.state !== 'authenticated') return;
      order.push('gateway-use');
      assert.equal(persisted?.accessToken, 'new-access');
      assert.equal(persisted?.refreshToken, 'new-refresh');
      assert.equal(coordinator.getSession()?.accessToken, 'new-access');
    },
  });

  try {
    await coordinator.restoreOnStartup();
    assert.deepEqual(order, ['persist', 'gateway-use']);
  } finally {
    await coordinator.close();
  }
});
