import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';

const redirectUri = 'http://127.0.0.1:43110/auth/callback';

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

const requestJson = (port, path, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
  ...options,
  headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
});

test('Joystick OAuth state is bound to platform, redirect, PKCE, expires, and is single-use', async () => {
  const { createApp } = await import('../src/app.mjs');
  const server = createServer(createApp({ now: () => 1_000 }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const start = await requestJson(port, '/auth/providers/joystick/start', {
      method: 'POST',
       body: JSON.stringify({ platform: 'desktop', redirectUri, codeChallenge: createHash('sha256').update('challenge').digest('base64url'), codeChallengeMethod: 'S256' }),
    });
    assert.equal(start.status, 200);
    const payload = await start.json();
     assert.match(payload.authorizeUrl, /code_challenge=/);
    assert.equal((await requestJson(port, `/auth/providers/joystick/callback?state=${payload.state}&code=demo-code&platform=mobile&redirect_uri=${encodeURIComponent(redirectUri)}`)).status, 400);
     assert.equal((await requestJson(port, `/auth/providers/joystick/callback?state=${payload.state}&code=demo-code&platform=desktop&redirect_uri=${encodeURIComponent(redirectUri)}`, { method: 'POST', body: JSON.stringify({ codeVerifier: 'challenge' }) })).status, 200);
    assert.equal((await requestJson(port, `/auth/providers/joystick/callback?state=${payload.state}&code=demo-code&platform=desktop&redirect_uri=${encodeURIComponent(redirectUri)}&code_verifier=challenge`)).status, 400);
  } finally {
    await closeServer(server);
  }
});

test('desktop PKCE requires S256 and rejects missing or mismatched verifiers', async () => {
  const { createApp } = await import('../src/app.mjs');
  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    for (const codeVerifier of [undefined, 'wrong']) {
      const start = await requestJson(port, '/auth/providers/joystick/start', {
        method: 'POST',
        body: JSON.stringify({ platform: 'desktop', redirectUri, codeChallenge: createHash('sha256').update('correct-challenge').digest('base64url'), codeChallengeMethod: 'S256' }),
      });
      assert.equal(start.status, 200);
      const payload = await start.json();
      const verifier = codeVerifier ? `&code_verifier=${codeVerifier}` : '';
      assert.equal((await requestJson(port, `/auth/providers/joystick/callback?state=${payload.state}&code=demo-code${verifier}`)).status, 400);
    }
  } finally {
    await closeServer(server);
  }
});

test('desktop auth start rejects missing PKCE and legacy plain PKCE', async () => {
  const { createApp } = await import('../src/app.mjs');
  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    for (const body of [
      { platform: 'desktop', redirectUri },
      { platform: 'desktop', redirectUri, codeChallenge: 'challenge', codeChallengeMethod: 'plain' },
    ]) {
      const response = await requestJson(port, '/auth/providers/joystick/start', { method: 'POST', body: JSON.stringify(body) });
      assert.equal(response.status, 400);
    }
  } finally {
    await closeServer(server);
  }
});

test('JWT access and rotating refresh sessions support restore, refresh, revoke, sign-out, and protected sync', async () => {
  const { createApp } = await import('../src/app.mjs');
  const server = createServer(createApp({ jwtSecret: 'test-secret', now: () => 1_000 }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const start = await requestJson(port, '/auth/providers/joystick/start', { method: 'POST', body: JSON.stringify({ platform: 'desktop', redirectUri, codeChallenge: createHash('sha256').update('challenge').digest('base64url'), codeChallengeMethod: 'S256' }) });
    const authStart = await start.json();
    const callback = await requestJson(port, `/auth/providers/joystick/callback?state=${authStart.state}&code=demo-code`, { method: 'POST', body: JSON.stringify({ codeVerifier: 'challenge' }) });
    assert.equal(callback.status, 200);
    const session = await callback.json();
    assert.equal(typeof session.accessToken, 'string');
    assert.equal(typeof session.refreshToken, 'string');
    assert.equal((await requestJson(port, '/auth/session', { headers: { authorization: `Bearer ${session.accessToken}` } })).status, 200);
    const refreshed = await requestJson(port, '/auth/sessions/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken }) });
    assert.equal(refreshed.status, 200);
    const next = await refreshed.json();
    assert.notEqual(next.refreshToken, session.refreshToken);
    assert.equal((await requestJson(port, '/auth/sessions/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken }) })).status, 401);
    assert.equal((await requestJson(port, '/auth/sessions/revoke', { method: 'POST', body: JSON.stringify({ refreshToken: next.refreshToken }) })).status, 204);
    assert.equal((await requestJson(port, '/sync/settings', { headers: { authorization: `Bearer ${next.accessToken}` } })).status, 401);
  } finally {
    await closeServer(server);
  }
});

test('settings push and device registration require an authenticated session', async () => {
  const { createApp } = await import('../src/app.mjs');
  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    assert.equal((await requestJson(port, '/sync/settings', { method: 'PUT', body: JSON.stringify({ settings: { theme: 'dark' } }) })).status, 401);
    assert.equal((await requestJson(port, '/sync/devices/self', { method: 'PUT', body: JSON.stringify({ deviceId: 'd', platform: 'desktop' }) })).status, 401);
  } finally {
    await closeServer(server);
  }
});
