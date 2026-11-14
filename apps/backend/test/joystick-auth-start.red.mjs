import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createHash } from 'node:crypto';

const desktopLoopbackRedirectUri = 'http://127.0.0.1:43110/auth/callback';
const mobileDeepLinkRedirectUri = 'prismata://auth/callback';
const nonLoopbackRedirectUri = 'https://prismata.app/auth/callback';
const nonDeepLinkRedirectUri = 'https://m.prismata.app/auth/callback';
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

test('POST /auth/providers/joystick/start returns backend-generated auth-start payload for desktop loopback clients', async () => {
  const { createApp } = await import('../src/app.mjs');

  assert.equal(typeof createApp, 'function');

  const server = createServer(createApp());

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/providers/joystick/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'desktop',
        redirectUri: desktopLoopbackRedirectUri,
        codeChallenge,
        codeChallengeMethod: 'S256',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');

    const body = await response.json();

    assert.equal(typeof body.authorizeUrl, 'string');
    assert.match(body.authorizeUrl, /^https?:\/\//);
    assert.equal(typeof body.state, 'string');
    assert.notEqual(body.state.length, 0);
    assert.equal(body.redirectUri, desktopLoopbackRedirectUri);
  } finally {
    await closeServer(server);
  }
});

test('POST /auth/providers/joystick/start returns backend-generated auth-start payload for mobile deep-link clients', async () => {
  const { createApp } = await import('../src/app.mjs');

  assert.equal(typeof createApp, 'function');

  const server = createServer(createApp());

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/providers/joystick/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'mobile',
        redirectUri: mobileDeepLinkRedirectUri,
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');

    const body = await response.json();

    assert.equal(typeof body.authorizeUrl, 'string');
    assert.match(body.authorizeUrl, /^https?:\/\//);
    assert.equal(typeof body.state, 'string');
    assert.notEqual(body.state.length, 0);
    assert.equal(body.redirectUri, mobileDeepLinkRedirectUri);
  } finally {
    await closeServer(server);
  }
});

test('POST /auth/providers/joystick/start rejects desktop clients with non-loopback redirect URIs', async () => {
  const { createApp } = await import('../src/app.mjs');

  assert.equal(typeof createApp, 'function');

  const server = createServer(createApp());

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/providers/joystick/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'desktop',
        redirectUri: nonLoopbackRedirectUri,
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), {
      error: 'invalid_auth_start_request',
    });
  } finally {
    await closeServer(server);
  }
});

test('POST /auth/providers/joystick/start rejects mobile clients with non-deep-link redirect URIs', async () => {
  const { createApp } = await import('../src/app.mjs');

  assert.equal(typeof createApp, 'function');

  const server = createServer(createApp());

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/providers/joystick/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'mobile',
        redirectUri: nonDeepLinkRedirectUri,
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), {
      error: 'invalid_auth_start_request',
    });
  } finally {
    await closeServer(server);
  }
});

test('POST /auth/providers/joystick/start rejects unsupported platforms cleanly', async () => {
  const { createApp } = await import('../src/app.mjs');

  assert.equal(typeof createApp, 'function');

  const server = createServer(createApp());

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/providers/joystick/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'web',
        redirectUri: desktopLoopbackRedirectUri,
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), {
      error: 'invalid_auth_start_request',
    });
  } finally {
    await closeServer(server);
  }
});
