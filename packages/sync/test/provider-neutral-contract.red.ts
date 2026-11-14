import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAuthClient,
  createBackendRuntime,
  createAuthenticatedRequest,
  pullSettings,
  pushSettings,
  type BackendSession,
} from '../src/index.js';

const session: BackendSession = {
  accessToken: 'access-token',
  expiresAt: '2026-09-24T01:00:00.000Z',
  refreshToken: 'refresh-token',
  state: 'authenticated',
  userId: 'user-123',
};

test('provider-neutral auth uses backend endpoints and publishes snapshots', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const runtime = createBackendRuntime({
    backendUrl: 'https://api.prismata.test/v1',
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ session }), { status: 200 });
    },
  });
  const auth = createAuthClient(runtime);
  const snapshots: string[] = [];
  const unsubscribe = auth.subscribe((snapshot) => snapshots.push(snapshot.state));

  await auth.start({ provider: 'joystick', platform: 'desktop', redirectUri: 'http://127.0.0.1:1/callback' });
  await auth.restore();
  unsubscribe();

  assert.equal(calls[0]?.url, 'https://api.prismata.test/v1/auth/providers/joystick/start');
  assert.deepEqual(snapshots, ['unavailable', 'authenticated']);
});

test('authenticated requests and settings sync carry backend session and sync metadata', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const runtime = createBackendRuntime({
    backendUrl: 'https://api.prismata.test',
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ settings: { theme: 'dark' }, updatedAt: '2026-09-24T00:00:00.000Z', version: 3 }), { status: 200 });
    },
  });
  const request = createAuthenticatedRequest(runtime, () => session);

  await request('/sync/devices/self', { method: 'PUT' });
  await pullSettings(request);
  await pushSettings(request, { settings: { theme: 'dark' }, version: 3, updatedAt: '2026-09-24T00:00:00.000Z' });

  const requestHeaders = new Headers(calls[0]?.init?.headers);
  assert.equal(requestHeaders.get('authorization'), 'Bearer access-token');
  assert.equal(calls[2]?.init?.body, JSON.stringify({ settings: { theme: 'dark' }, version: 3, updatedAt: '2026-09-24T00:00:00.000Z' }));
});
