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

test('joystick auth delegates auth state and session persistence through injected storage', async () => {
  const { createApp } = await import('../src/app.mjs');

  assert.equal(typeof createApp, 'function');

  const persistedAuthStates = [];
  const consumedAuthStates = [];
  const createdSessions = [];

  const authStorage = {
    persistAuthState(authState) {
      persistedAuthStates.push(authState);
    },
    consumeAuthState(state) {
      consumedAuthStates.push(state);
      return true;
    },
    createSession(session) {
      createdSessions.push(session);
      return {
        id: 'persisted-session-id',
      };
    },
    getSession() {
      return null;
    },
    getUserSettings() {
      return null;
    },
    upsertDevice() {
      return null;
    },
  };

  const server = createServer(createApp({ authStorage }));

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

    const callbackResponse = await fetch(
      `http://127.0.0.1:${address.port}/auth/providers/joystick/callback?code=demo-code&state=${encodeURIComponent(authStart.state)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codeVerifier }) },
    );

    assert.equal(callbackResponse.status, 200);
    assert.equal(persistedAuthStates.length, 1);
    assert.deepEqual(persistedAuthStates[0], {
      provider: 'joystick',
      redirectUri: desktopLoopbackRedirectUri,
      state: authStart.state,
    });
    assert.deepEqual(consumedAuthStates, [authStart.state]);
    assert.equal(createdSessions.length, 1);
    assert.equal(
      callbackResponse.headers.get('set-cookie')?.includes('prismata_session=persisted-session-id'),
      true,
    );
  } finally {
    await closeServer(server);
  }
});
