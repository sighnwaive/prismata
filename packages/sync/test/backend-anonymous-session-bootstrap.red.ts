import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootstrapBackendAnonymousSession,
  type BackendAnonymousSessionResponse,
  type UpsertBackendDeviceSelfRequest,
  type UpsertBackendDeviceSelfResponse,
} from '../src/backend.ts';

const backendUrl = 'https://prismata.example.test/api';

const device: UpsertBackendDeviceSelfRequest = {
  appInstanceId: 'app-instance-123',
  deviceId: 'device-123',
  deviceName: 'desktop dev shell',
  platform: 'desktop',
};

const expectedSession: BackendAnonymousSessionResponse = {
  session: {
    expiresAt: '2026-08-27T00:00:00.000Z',
    id: 'session-123',
    state: 'anonymous',
    userId: 'user-123',
  },
};

const expectedDevice: UpsertBackendDeviceSelfResponse = {
  ...device,
  lastSeenAt: '2026-08-27T00:00:00.000Z',
};

const expectedCookie = 'prismata_session=session-token-123';

test('bootstrapBackendAnonymousSession returns backend anonymous session and device registration payloads', async () => {
  const result = await bootstrapBackendAnonymousSession({
    backendUrl,
    device,
    fetchImpl: (async (input, init) => {
      const url = String(input);

      if (url === `${backendUrl}/auth/sessions/anonymous`) {
        if (init?.method !== 'POST') {
          throw new Error(`expected POST /auth/sessions/anonymous, received ${init?.method ?? 'GET'}`);
        }

        return new Response(JSON.stringify(expectedSession), {
          headers: {
            'content-type': 'application/json',
            'set-cookie': `${expectedCookie}; Path=/; HttpOnly; SameSite=Lax`,
          },
          status: 200,
        });
      }

      if (url === `${backendUrl}/sync/devices/self`) {
        if (init?.method !== 'PUT') {
          throw new Error(`expected PUT /sync/devices/self, received ${init?.method ?? 'GET'}`);
        }

        if (init.headers instanceof Headers) {
          if (init.headers.get('cookie') !== expectedCookie) {
            throw new Error(`expected backend session cookie during device registration, received ${init.headers.get('cookie') ?? 'null'}`);
          }
        } else if ((init.headers as Record<string, string> | undefined)?.cookie !== expectedCookie) {
          throw new Error('expected backend session cookie during device registration');
        }

        if (init.body !== JSON.stringify(device)) {
          throw new Error(`expected backend device registration payload ${JSON.stringify(device)}, received ${String(init.body)}`);
        }

        return new Response(JSON.stringify(expectedDevice), {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        });
      }

      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch,
  });

  assert.equal(result.sessionCookie, expectedCookie);
  assert.deepEqual(result.session, expectedSession.session);
  assert.deepEqual(result.device, expectedDevice);
});

test('bootstrapBackendAnonymousSession fails before device registration when prismata_session cookie is missing', async () => {
  let deviceRegistrationAttempted = false;
  let thrownError: unknown = null;

  try {
    await bootstrapBackendAnonymousSession({
      backendUrl,
      device,
      fetchImpl: (async (input, init) => {
        const url = String(input);

        if (url === `${backendUrl}/auth/sessions/anonymous`) {
          if (init?.method !== 'POST') {
            throw new Error(`expected POST /auth/sessions/anonymous, received ${init?.method ?? 'GET'}`);
          }

          return new Response(JSON.stringify(expectedSession), {
            headers: {
              'content-type': 'application/json',
              'set-cookie': 'other_cookie=session-token-123; Path=/; HttpOnly; SameSite=Lax',
            },
            status: 200,
          });
        }

        if (url === `${backendUrl}/sync/devices/self`) {
          deviceRegistrationAttempted = true;
          throw new Error('device registration should not be attempted when prismata_session is missing');
        }

        throw new Error(`unexpected request: ${url}`);
      }) as typeof fetch,
    });
  } catch (error) {
    thrownError = error;
  }

  assert.equal(deviceRegistrationAttempted, false);
  assert.match(
    thrownError instanceof Error ? thrownError.message : String(thrownError),
    /prismata_session/i,
  );
});
