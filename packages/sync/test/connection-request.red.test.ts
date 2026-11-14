import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIRMATION_CODE_LENGTH, isConfirmationCode } from '../src/pairing.js';
import { createDesktopTransport } from '../src/desktop.js';

const fingerprint = 'ab'.repeat(32);

test('connection confirmation codes are exactly six characters from the unambiguous alphabet', () => {
  assert.equal(CONFIRMATION_CODE_LENGTH, 6);
  assert.equal(isConfirmationCode('ABCDEFGH234567'), false);
  assert.equal(isConfirmationCode('ABCD23'), true);
  assert.equal(isConfirmationCode('O0IL1S'), false);
});

test('typed desktop transport exposes connection request create/status/approve methods', async () => {
  const paths: string[] = [];
  const transport = createDesktopTransport({
    endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint },
    pinnedRequest: async (url) => {
      paths.push(new URL(url).pathname);
      const path = new URL(url).pathname;
       return { status: path.endsWith('/connection-requests') ? 201 : path.endsWith('/approve') ? 404 : 200, body: JSON.stringify({ requestId: 'request-1', expiresAt: '2099-01-01T00:00:00.000Z', status: 'pending' }) };
    },
  });
  assert.equal((await transport.createConnectionRequest({ deviceId: 'phone-1', publicKey: 'public', deviceName: 'Phone' })).requestId, 'request-1');
  assert.equal((await transport.getConnectionRequest('request-1')).status, 'pending');
  await assert.rejects(() => transport.approveConnectionRequest('request-1', 'ABCD23'), /status 404/);
  assert.deepEqual(paths, ['/api/v1/connection-requests', '/api/v1/connection-requests/request-1', '/api/v1/connection-requests/request-1/approve']);
});

test('legacy pairing endpoints cannot issue sessions in the primary transport', async () => {
  const transport = createDesktopTransport({ endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint }, pinnedRequest: async () => ({ status: 404, body: '{}' }) });
  await assert.rejects(() => transport.startPairing(), /status 404/);
});
