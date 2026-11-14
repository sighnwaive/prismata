import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createHash } from 'node:crypto';

const desktopLoopbackRedirectUri = 'http://127.0.0.1:43110/auth/callback';
const codeVerifier = 'desktop-code-verifier';
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const startJoystickAuth = async ({ port, redirectUri }) => {
  const response = await fetch(`http://127.0.0.1:${port}/auth/providers/joystick/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      platform: 'desktop',
      redirectUri,
      codeChallenge,
      codeChallengeMethod: 'S256',
    }),
  });

  assert.equal(response.status, 200);

  return response.json();
};

test('POST /auth/providers/joystick/callback accepts a known state and establishes a backend session cookie', async () => {
  const { createApp } = await import('../src/app.mjs');

  assert.equal(typeof createApp, 'function');

  const server = createServer(createApp());

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const authStart = await startJoystickAuth({
      port: address.port,
      redirectUri: desktopLoopbackRedirectUri,
    });

    assert.equal(typeof authStart.state, 'string');
    assert.notEqual(authStart.state.length, 0);

    const response = await fetch(
      `http://127.0.0.1:${address.port}/auth/providers/joystick/callback?code=demo-code&state=${encodeURIComponent(authStart.state)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codeVerifier }),
      },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie')?.includes('prismata_session='), true);
  } finally {
    await closeServer(server);
  }
});

test('GET /auth/providers/joystick/callback rejects unknown state values with 400', async () => {
  const { createApp } = await import('../src/app.mjs');

  assert.equal(typeof createApp, 'function');

  const server = createServer(createApp());

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    await startJoystickAuth({
      port: address.port,
      redirectUri: desktopLoopbackRedirectUri,
    });

    const response = await fetch(
      `http://127.0.0.1:${address.port}/auth/providers/joystick/callback?code=demo-code&state=unknown-state`,
      {
        method: 'GET',
      },
    );

    assert.equal(response.status, 400);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), {
      error: 'invalid_auth_state',
    });
  } finally {
    await closeServer(server);
  }
});
