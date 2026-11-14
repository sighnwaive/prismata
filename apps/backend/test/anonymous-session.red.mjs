import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

const expectedSession = {
  expiresAt: '2026-08-28T00:00:00.000Z',
  id: 'anonymous-session-123',
  state: 'anonymous',
  userId: 'anonymous-user-123',
};

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

test('POST /auth/sessions/anonymous returns a backend anonymous session payload and prismata_session cookie', async () => {
  const { createApp } = await import('../src/app.mjs');

  const createSessionCalls = [];
  const authStorage = {
    persistAuthState() {},
    consumeAuthState() {
      return true;
    },
    createSession(sessionInput) {
      createSessionCalls.push(sessionInput);
      return expectedSession;
    },
    getSession() {
      return null;
    },
    getUserSettings() {
      throw new Error('getUserSettings should not be called during anonymous session bootstrap');
    },
    upsertDevice() {
      throw new Error('upsertDevice should not be called during anonymous session bootstrap');
    },
  };

  const server = createServer(createApp({ authStorage }));

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/sessions/anonymous`, {
      method: 'POST',
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(
      response.headers.get('set-cookie')?.includes(`prismata_session=${expectedSession.id}`),
      true,
    );
    assert.deepEqual(await response.json(), {
      session: expectedSession,
    });
    assert.deepEqual(createSessionCalls, [
      {
        provider: 'anonymous',
      },
    ]);
  } finally {
    await closeServer(server);
  }
});
