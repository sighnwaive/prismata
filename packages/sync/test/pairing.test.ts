import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopTransport, parsePairingPayload } from '../src/desktop.js';
import { isHttpsEndpoint } from '../src/pairing.js';

const fingerprint = 'ab'.repeat(32);

test('parses and validates the versioned pairing deep link', () => {
  const payload = parsePairingPayload(`prismata://pair?v=1&endpoint=${encodeURIComponent('https://desktop.local:48123')}&challenge=one-use&expiresAt=2099-01-01T00%3A00%3A00.000Z&instanceId=desktop-1&fingerprint=${fingerprint}`);
  assert.equal(payload.instanceId, 'desktop-1');
  assert.throws(() => parsePairingPayload('prismata://pair?v=2'), /unsupported pairing payload/);
  assert.throws(() => parsePairingPayload('prismata://pair?v=1&endpoint=http%3A%2F%2Fdesktop.local%3A1&challenge=x&expiresAt=2099-01-01T00%3A00%3A00.000Z&instanceId=x&fingerprint=' + fingerprint), /invalid pairing payload/);
});

test('parses the desktop QR payload when the runtime rejects custom URL schemes', () => {
  const nativeURL = globalThis.URL;
  const hermesURL = function (this: unknown, input: string | URL, base?: string | URL) {
    if (String(input).trim().toLowerCase().startsWith('prismata://')) throw new TypeError('URL.protocol is not implemented');
    return new nativeURL(input, base);
  } as unknown as typeof URL;
  Object.defineProperty(globalThis, 'URL', { configurable: true, value: hermesURL });
  try {
    const payload = parsePairingPayload(`prismata://pair?v=1&endpoint=${encodeURIComponent('https://desktop.local:48123')}&challenge=one-use&expiresAt=2099-01-01T00%3A00%3A00.000Z&instanceId=desktop-1&fingerprint=${fingerprint}`);
    assert.equal(payload.endpoint, 'https://desktop.local:48123');
  } finally {
    Object.defineProperty(globalThis, 'URL', { configurable: true, value: nativeURL });
  }
});

test('shared endpoint validation requires an explicit HTTPS host port and root path', () => {
  assert.equal(isHttpsEndpoint('https://desktop.local:443'), true);
  for (const endpoint of [
    'http://desktop.local:48123',
    'https://desktop.local',
    'https://desktop.local:48123/settings',
    'https://desktop.local:48123?token=secret',
    'https://desktop.local:48123#secret',
    'https://user:secret@desktop.local:48123',
  ]) assert.equal(isHttpsEndpoint(endpoint), false, endpoint);
});

test('pairing transport keeps unauthenticated calls pinned and returns a session', async () => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const transport = createDesktopTransport({
    endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint },
    fetchImpl: async (url, init) => {
      requests.push({ path: new URL(url).pathname, body: init?.body ? JSON.parse(String(init.body)) : {} });
      return new Response(JSON.stringify({ challenge: 'next', expiresAt: '2099-01-01T00:00:00.000Z', instanceId: 'desktop-1', deviceId: 'phone', accessToken: 'access', refreshToken: 'refresh' }), { status: 201 });
    },
    verifyCertificate: async (_url, actual) => assert.equal(actual, fingerprint),
  });
  assert.equal((await transport.startPairing()).challenge, 'next');
  const session = await transport.completePairing({ challenge: 'challenge', deviceId: 'phone', publicKey: 'public', deviceName: 'Phone' });
  assert.equal(session.accessToken, 'access');
  assert.deepEqual(requests.map(({ path }) => path), ['/api/v1/pairing/start', '/api/v1/pairing/complete']);
});
