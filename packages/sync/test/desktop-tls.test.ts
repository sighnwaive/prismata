import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopTransport, parseDiscoveryAdvertisement } from '../src/desktop.js';

test('discovery produces an HTTPS endpoint and preserves the pinned fingerprint', () => {
  const endpoint = parseDiscoveryAdvertisement({ service: '_prismata._tcp', port: 48123, host: 'desktop.local', instanceId: 'desktop-1', protocol: 'v1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true });
  assert.equal(endpoint.baseUrl, 'https://desktop.local:48123');
  assert.equal(endpoint.fingerprint, 'ab'.repeat(32));
});

test('transport requires a pin verifier and rejects a changed fingerprint', async () => {
  const calls: string[] = [];
  const transport = createDesktopTransport({
    endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint: 'ab'.repeat(32) },
    fetchImpl: async () => new Response(JSON.stringify({ status: 'ok', protocol: 'v1' }), { status: 200 }),
    verifyCertificate: async (_url, fingerprint) => { calls.push(fingerprint); },
  });
  await transport.health();
  assert.deepEqual(calls, ['ab'.repeat(32)]);
  assert.throws(() => createDesktopTransport({ endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint: 'cd'.repeat(32) }, fetchImpl: async () => new Response('{}') }), /certificate pin verifier/);
  const changed = createDesktopTransport({ endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint: 'cd'.repeat(32) }, fetchImpl: async () => new Response('{}'), verifyCertificate: async (_url, fingerprint) => { if (fingerprint !== 'ab'.repeat(32)) throw new Error('certificate fingerprint changed'); } });
  await assert.rejects(() => changed.health(), /certificate fingerprint changed/);
});

test('pinned request owns the application response and disables redirects', async () => {
  let request: { url: string; init: RequestInit } | undefined;
  const transport = createDesktopTransport({
    endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint: 'ab'.repeat(32) },
    pinnedRequest: async (url, fingerprint, init) => {
      assert.equal(fingerprint, 'ab'.repeat(32));
      request = { url, init };
      return { status: 200, body: JSON.stringify({ status: 'ok', protocol: 'v1' }) };
    },
  });

  assert.deepEqual(await transport.health(), { status: 'ok', protocol: 'v1' });
  assert.deepEqual(request, {
    url: 'https://desktop.local:48123/api/v1/health',
    init: { headers: new Headers(), redirect: 'error' },
  });
});
