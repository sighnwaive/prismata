import assert from 'node:assert/strict';
import test from 'node:test';

import { createLoopbackCallbackServer } from '../electron/loopback.js';

test('loopback callback listener uses the registered port and path', async () => {
  const server = await createLoopbackCallbackServer();
  const callback = server.waitForCallback(new AbortController().signal);
  const response = await fetch(`${server.redirectUri}?code=code-1&state=state-1`);
  assert.equal(response.status, 200);
  assert.deepEqual(new URL(await callback).searchParams.get('code'), 'code-1');
  assert.equal(server.redirectUri, 'http://127.0.0.1:43110/auth/callback');
  await server.close();
});
