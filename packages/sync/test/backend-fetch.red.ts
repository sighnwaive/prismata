import assert from 'node:assert/strict';
import test from 'node:test';

import { getBackendSettings } from '../src/backend.ts';

test('getBackendSettings joins sync path onto backendUrl without dropping its base path', async () => {
  let requestUrl: URL | null = null;

  await getBackendSettings({
    backendUrl: 'https://api.prismata.test/backend/',
    sessionCookie: 'sb-access-token=abc123',
    fetchImpl: async (input) => {
      requestUrl = input as URL;

      return new Response(
        JSON.stringify({
          settings: {},
          updatedAt: '2026-08-27T00:00:00.000Z',
          version: 1,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    },
  });

  assert.notEqual(requestUrl, null);
  assert.equal(requestUrl?.toString(), 'https://api.prismata.test/backend/sync/settings');
});
