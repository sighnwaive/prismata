import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import {
  AUTHORIZE_ENDPOINT,
  JOYSTICK_REQUIRED_SCOPES,
  PROFILE_ENDPOINT,
  TOKEN_ENDPOINT,
  createJoystickAuthorizeRequest,
  createDesktopJoystickBackend,
  exchangeJoystickCode,
  normalizeJoystickProfile,
  refreshJoystickSession,
  validateJoystickCallback,
} from '../src/joystick-oauth.js';
import { desktopOAuthRedirectUri } from '../src/auth-flow.js';

const redirectUri = 'http://127.0.0.1:43110/auth/callback';
const randomBytes = (size: number) => Buffer.alloc(size, 7);

test('desktop Joystick OAuth uses the registered loopback callback URI', () => {
  assert.equal(desktopOAuthRedirectUri, 'http://127.0.0.1:43110/auth/callback');
});

test('authorize URL uses a 32-byte verifier and S256 challenge', () => {
  const request = createJoystickAuthorizeRequest({ clientId: 'public-client', redirectUri, randomBytes });
  const expectedChallenge = createHash('sha256').update(request.codeVerifier).digest('base64url');
  const url = new URL(request.authorizeUrl);

  assert.equal(url.origin + url.pathname, AUTHORIZE_ENDPOINT);
  assert.equal(request.codeVerifier.length, 43);
  assert.equal(url.searchParams.get('code_challenge'), expectedChallenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('client_id'), 'public-client');
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
});

test('authorize URL uses Mochi required scopes in the registered order', () => {
  const request = createJoystickAuthorizeRequest({ clientId: 'public-client', redirectUri, randomBytes });
  const url = new URL(request.authorizeUrl);

  assert.equal(
    url.searchParams.get('scope'),
    'identity:read stream:read chat:read chat:write followers:read moderators:read subscribers:read chat:whisper:write',
  );
  assert.deepEqual([...JOYSTICK_REQUIRED_SCOPES], [
    'identity:read',
    'stream:read',
    'chat:read',
    'chat:write',
    'followers:read',
    'moderators:read',
    'subscribers:read',
    'chat:whisper:write',
  ]);
  assert.equal(Object.isFrozen(JOYSTICK_REQUIRED_SCOPES), true);
});

test('JOYSTICK_SCOPES explicitly overrides the default scope string', () => {
  const previous = process.env.JOYSTICK_SCOPES;
  process.env.JOYSTICK_SCOPES = 'chat:read chat:write';
  try {
    const request = createJoystickAuthorizeRequest({ clientId: 'public-client', redirectUri, randomBytes });
    assert.equal(new URL(request.authorizeUrl).searchParams.get('scope'), 'chat:read chat:write');
  } finally {
    if (previous === undefined) delete process.env.JOYSTICK_SCOPES;
    else process.env.JOYSTICK_SCOPES = previous;
  }
});

test('authorization code exchange is secretless and normalizes /api/v1/me/identity', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url) === TOKEN_ENDPOINT) {
      return new Response(JSON.stringify({ data: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: 'identity:read' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { id: 42, username: 'creator', display_name: 'Creator Name' } }), { status: 200 });
  };

  const session = await exchangeJoystickCode({ clientId: 'public-client', code: 'auth-code', codeVerifier: 'verifier', redirectUri, fetch, now: () => 1_000 });
  const tokenBody = new URLSearchParams(String(calls[0]?.init?.body));

  assert.equal(calls[0]?.url, TOKEN_ENDPOINT);
  assert.equal(tokenBody.get('client_secret'), null);
  assert.equal(tokenBody.get('grant_type'), 'authorization_code');
  assert.deepEqual(session.identity, { id: '42', login: 'creator', displayName: 'Creator Name' });
  assert.equal(session.accessToken, 'access-1');
  assert.equal(session.expiresAt, 3_601_000);
  assert.equal(calls[1]?.url, 'https://api.joystick.tv/api/v1/me/identity');
  assert.equal(PROFILE_ENDPOINT, 'https://api.joystick.tv/api/v1/me/identity');
});

test('desktop OAuth session carries actual /api/v1/me grants through refresh and restore, not requested scopes', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const actualGrants = ['identity:read', 'stream:read'];
  const fetch = async (url: string | URL, init?: RequestInit) => {
    const urlText = String(url);
    calls.push({ url: urlText, init });
    if (urlText === TOKEN_ENDPOINT) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('grant_type') === 'refresh_token') {
        return new Response(JSON.stringify({
          access_token: 'refreshed-access',
          refresh_token: 'refreshed-refresh',
          expires_in: 3600,
          scope: JOYSTICK_REQUIRED_SCOPES.join(' '),
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        access_token: 'initial-access',
        refresh_token: 'initial-refresh',
        expires_in: 3600,
        scope: JOYSTICK_REQUIRED_SCOPES.join(' '),
      }), { status: 200 });
    }
    if (urlText === PROFILE_ENDPOINT) {
      return new Response(JSON.stringify({ id: 'creator-1', username: 'creator' }), { status: 200 });
    }
    if (urlText === 'https://api.joystick.tv/api/v1/me') {
      return new Response(JSON.stringify({ data: { permissions: actualGrants } }), { status: 200 });
    }
    throw new Error(`unexpected fake fetch URL: ${urlText}`);
  };
  const backend = createDesktopJoystickBackend({ clientId: 'public-client', fetch, redirectUri });

  const started = await backend.start({ codeVerifier: 'desktop-test-verifier' });
  const completed = await backend.complete(
    `${redirectUri}?code=auth-code&state=${encodeURIComponent(started.state)}`,
    { codeVerifier: started.codeVerifier! },
  );
  const refreshed = await backend.refresh(completed);
  const restored = await backend.restore(refreshed);
  const permissionsRequests = calls
    .filter((call) => call.url === 'https://api.joystick.tv/api/v1/me')
    .map((call) => ({
      method: call.init?.method ?? 'GET',
      authorization: new Headers(call.init?.headers).get('authorization'),
    }));

  assert.deepEqual({
    completed: completed.grantedPermissions,
    refreshed: refreshed.grantedPermissions,
    restored: restored?.grantedPermissions,
    permissionsRequests,
  }, {
    completed: actualGrants,
    refreshed: actualGrants,
    restored: actualGrants,
    permissionsRequests: [{ method: 'GET', authorization: 'Bearer initial-access' }],
  });
});

test('refresh retains the actual grants on a session instead of substituting requested token scopes', async () => {
  const actualGrants = ['identity:read', 'stream:read'];
  const backend = createDesktopJoystickBackend({
    clientId: 'public-client',
    redirectUri,
    fetch: async (url) => {
      assert.equal(String(url), TOKEN_ENDPOINT);
      return new Response(JSON.stringify({
        access_token: 'refreshed-access',
        refresh_token: 'refreshed-refresh',
        expires_in: 3600,
        scope: JOYSTICK_REQUIRED_SCOPES.join(' '),
      }), { status: 200 });
    },
  });
  const refreshed = await backend.refresh({
    accessToken: 'prior-access',
    refreshToken: 'prior-refresh',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    identity: { id: 'creator-1', login: 'creator', displayName: 'creator' },
    state: 'authenticated',
    userId: 'creator-1',
    provider: 'joystick',
    grantedPermissions: actualGrants,
  });
  const restored = await backend.restore(refreshed);

  assert.deepEqual({
    refreshed: refreshed.grantedPermissions,
    restored: restored?.grantedPermissions,
  }, {
    refreshed: actualGrants,
    restored: actualGrants,
  });
});

test('callback validation requires exact loopback origin, path, code, and state', () => {
  const valid = `${redirectUri}?code=auth-code&state=state-1`;
  assert.deepEqual(validateJoystickCallback(valid, { state: 'state-1', redirectUri }), { code: 'auth-code', state: 'state-1' });
  assert.throws(() => validateJoystickCallback(`${redirectUri}/extra?code=x&state=state-1`, { state: 'state-1', redirectUri }), /callback/);
  assert.throws(() => validateJoystickCallback(`${redirectUri}?code=x&state=wrong`, { state: 'state-1', redirectUri }), /state/);
  assert.throws(() => validateJoystickCallback(`http://localhost:43110/auth/callback?code=x&state=state-1`, { state: 'state-1', redirectUri }), /callback/);
});

test('refresh sends only public client credentials and preserves refreshed identity', async () => {
  let saved: unknown;
  const fetch = async (url: string | URL, init?: RequestInit) => {
    assert.equal(String(url), TOKEN_ENDPOINT);
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('client_secret'), null);
    return new Response(JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 120 }), { status: 200 });
  };
  const next = await refreshJoystickSession({
    clientId: 'public-client',
    refreshToken: 'refresh-1',
    previous: { identity: { id: '42', login: 'creator', displayName: 'Creator Name' } },
    fetch,
    now: () => 5_000,
    save: async (session) => { saved = session; },
  });

  assert.equal(next.refreshToken, 'refresh-2');
  assert.deepEqual(next.identity, { id: '42', login: 'creator', displayName: 'Creator Name' });
  assert.deepEqual(saved, next);
});

test('profile normalization rejects an unusable provider identity', () => {
  assert.throws(() => normalizeJoystickProfile({}), /identity/);
});

test('profile normalization supports the current Mochi profile shape', () => {
  assert.deepEqual(normalizeJoystickProfile({
    data: {
      user: {
        id: 'mochi-user-1',
        username: 'creator',
        display_name: 'Creator Name',
      },
    },
  }), { id: 'mochi-user-1', login: 'creator', displayName: 'Creator Name' });
});

test('profile normalization supports the live Joystick identity shape', () => {
  assert.deepEqual(normalizeJoystickProfile({
    channel_id: 'channel-live-42',
    username: 'live-creator',
    nickname: 'Live Creator',
    photo_url: 'https://cdn.example.test/avatar.png',
    live: true,
  }), { id: 'channel-live-42', login: 'live-creator', displayName: 'Live Creator' });
});

test('profile normalization supports nested and alternate identity fields', () => {
  assert.deepEqual(normalizeJoystickProfile({
    user: { user_id: 42, handle: 'handle-name', displayName: 'Handle Name' },
  }), { id: '42', login: 'handle-name', displayName: 'Handle Name' });
  assert.deepEqual(normalizeJoystickProfile({ uuid: 'uuid-1', name: 'Named User' }), {
    id: 'uuid-1', login: 'Named User', displayName: 'Named User',
  });
});

test('profile normalization rejects installation metadata as a user identity response', () => {
  assert.throws(() => normalizeJoystickProfile({
    channel: { id: 'channel-42', login: 'channel-user' },
    bot: { id: 'bot-42', login: 'prismata-bot' },
    permissions: ['identity:read'],
  }), /identity.*profileEndpoint/);
});

test('profile exchange supports a configurable identity endpoint', async () => {
  const calls: string[] = [];
  const fetch = async (url: string | URL) => {
    calls.push(String(url));
    if (String(url) === TOKEN_ENDPOINT) {
      return new Response(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1' }), { status: 200 });
    }
    return new Response(JSON.stringify({ user: { id: 'user-1', login: 'user-name' } }), { status: 200 });
  };

  const session = await exchangeJoystickCode({
    clientId: 'public-client',
    code: 'auth-code',
    codeVerifier: 'verifier',
    redirectUri,
    profileEndpoint: 'https://identity.example.test/me',
    fetch,
  });

  assert.deepEqual(session.identity, { id: 'user-1', login: 'user-name', displayName: 'user-name' });
  assert.deepEqual(calls, [TOKEN_ENDPOINT, 'https://identity.example.test/me']);
});

test('profile normalization accepts a stable ID with only a display name', () => {
  assert.deepEqual(normalizeJoystickProfile({ id: 'id-only', display_name: 'Display User' }), {
    id: 'id-only', login: 'Display User', displayName: 'Display User',
  });
});

test('profile normalization rejects missing stable IDs and unusable payloads', () => {
  assert.throws(() => normalizeJoystickProfile({ username: 'no-id' }), /identity/);
  assert.throws(() => normalizeJoystickProfile({ access_token: 'secret', refresh_token: 'secret-2' }), /identity/);
});

test('profile identity errors include sanitized context without profile secrets', () => {
  assert.throws(
    () => normalizeJoystickProfile({ data: { access_token: 'secret', refresh_token: 'secret-2' } }),
    (error: unknown) => error instanceof Error
      && /identity/.test(error.message)
      && /data/.test(error.message)
      && !error.message.includes('secret'),
  );
});
