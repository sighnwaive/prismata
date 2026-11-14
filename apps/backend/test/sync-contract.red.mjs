import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

const validSessionId = 'session-123';
const sessionCookie = `prismata_session=${validSessionId}`;

const canonicalSettings = {
  settings: {
    locale: 'en-US',
    theme: 'system',
  },
  updatedAt: '2026-08-27T00:00:00.000Z',
  version: 7,
};

const canonicalDevice = {
  appInstanceId: 'desktop-instance-123',
  deviceId: 'desktop-device-123',
  deviceName: 'Workstation',
  lastSeenAt: '2026-08-27T00:00:00.000Z',
  platform: 'desktop',
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

const createSyncStorage = () => {
  const upsertedDevices = [];

  return {
    persistAuthState() {},
    consumeAuthState() {
      return true;
    },
    createSession() {
      return {
        id: validSessionId,
      };
    },
    getSession(sessionId) {
      if (sessionId !== validSessionId) {
        return null;
      }

      return {
        id: validSessionId,
        userId: 'user-123',
      };
    },
    getUserSettings(userId) {
      assert.equal(userId, 'user-123');
      return canonicalSettings;
    },
    upsertDevice({ userId, device }) {
      assert.equal(userId, 'user-123');
      upsertedDevices.push(device);
      return canonicalDevice;
    },
    getUpsertedDevices() {
      return upsertedDevices;
    },
  };
};

test('GET /sync/settings with a valid prismata_session cookie returns the canonical settings payload', async () => {
  const { createApp } = await import('../src/app.mjs');
  const authStorage = createSyncStorage();
  const server = createServer(createApp({ authStorage }));

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/sync/settings`, {
      headers: {
        cookie: sessionCookie,
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), canonicalSettings);
  } finally {
    await closeServer(server);
  }
});

test('PUT /sync/devices/self with a valid prismata_session cookie returns canonical device data', async () => {
  const { createApp } = await import('../src/app.mjs');
  const authStorage = createSyncStorage();
  const server = createServer(createApp({ authStorage }));

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/sync/devices/self`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
      },
      body: JSON.stringify({
        appInstanceId: canonicalDevice.appInstanceId,
        deviceId: canonicalDevice.deviceId,
        deviceName: canonicalDevice.deviceName,
        platform: canonicalDevice.platform,
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), canonicalDevice);
    assert.deepEqual(authStorage.getUpsertedDevices(), [
      {
        appInstanceId: canonicalDevice.appInstanceId,
        deviceId: canonicalDevice.deviceId,
        deviceName: canonicalDevice.deviceName,
        platform: canonicalDevice.platform,
      },
    ]);
  } finally {
    await closeServer(server);
  }
});

test('GET /sync/settings without a prismata_session cookie returns 401', async () => {
  const { createApp } = await import('../src/app.mjs');
  const authStorage = createSyncStorage();
  const server = createServer(createApp({ authStorage }));

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/sync/settings`);

    assert.equal(response.status, 401);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), {
      error: 'unauthorized',
    });
  } finally {
    await closeServer(server);
  }
});
