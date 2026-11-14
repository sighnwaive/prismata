import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopEndpoint } from '@prismata/sync';
import { createMobileDesktopRuntime } from '../src/desktop-runtime';
import { createMdnsDiscoveryAdapter } from '../src/mdns-discovery';

const storage = { get: async () => null, set: async () => {}, remove: async () => {} };
const fingerprint = 'ab'.repeat(32);
const payload = {
  endpoint: 'https://qr-host.local:48123',
  challenge: 'challenge',
  expiresAt: '2099-01-01T00:00:00.000Z',
  instanceId: 'desktop-1',
  fingerprint,
  version: 1 as const,
};

function endpoint(baseUrl: string, advertisedFingerprint = fingerprint): DesktopEndpoint {
  return { baseUrl, instanceId: 'desktop-1', fingerprint: advertisedFingerprint };
}

test('requires explicit fingerprint confirmation before completing pairing', async () => {
  const runtime = createMobileDesktopRuntime({
    storage,
    pinnedRequest: async (url) => ({ status: 200, body: JSON.stringify(url.toString().endsWith('/instance') ? { protocol: 'v1', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32), pairingRequired: true } : { challenge: 'unused' }) }),
  });
  await assert.rejects(() => runtime.completePairing(payload, { deviceName: 'Phone', confirmFingerprint: false }), /fingerprint confirmation required/);
});

test('QR pairing uses the fresh matching discovery host and port, not the QR endpoint', async () => {
  const calls: string[] = [];
  const runtime = createMobileDesktopRuntime({
    storage,
    discoverForPairing: async () => [endpoint('https://192.168.1.20:49152')],
    identity: async () => ({ deviceId: 'device-1', publicKey: 'public-key' }),
    pinnedRequest: async (url, pinnedFingerprint) => {
      calls.push(`${url}|${pinnedFingerprint}`);
      return { status: 200, body: JSON.stringify(url.endsWith('/instance')
        ? { protocol: 'v1', instanceId: 'desktop-1', fingerprint, pairingRequired: true }
        : { deviceId: 'device-1', accessToken: 'token', refreshToken: 'refresh', expiresAt: '2099-01-01T00:00:00.000Z', instanceId: 'desktop-1', fingerprint }) };
    },
  });

  const result = await runtime.completePairing(payload, { deviceName: 'Phone', confirmFingerprint: true });

  assert.equal(result.endpoint.baseUrl, 'https://192.168.1.20:49152');
  assert.deepEqual(calls, [
    `https://192.168.1.20:49152/api/v1/instance|${fingerprint}`,
    `https://192.168.1.20:49152/api/v1/pairing/complete|${fingerprint}`,
  ]);
});

test('pairs through an NSD-shaped IPv6 discovery result with matching identity', async () => {
  const runtime = createMobileDesktopRuntime({
    storage,
    discoverForPairing: () => createMdnsDiscoveryAdapter({ nsd: {
      discover: async () => [{ type: 'prismata', protocol: 'tcp', host: 'fe80::1234', port: 49152, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint, pairing: 'required' } }],
    } }).discover(),
    identity: async () => ({ deviceId: 'device-1', publicKey: 'public-key' }),
    pinnedRequest: async (url, pinnedFingerprint) => ({ status: 200, body: JSON.stringify(url.endsWith('/instance')
      ? { protocol: 'v1', instanceId: 'desktop-1', fingerprint: pinnedFingerprint, pairingRequired: true }
      : { deviceId: 'device-1', accessToken: 'token', refreshToken: 'refresh', expiresAt: '2099-01-01T00:00:00.000Z', instanceId: 'desktop-1', fingerprint: pinnedFingerprint }) }),
  });

  const result = await runtime.completePairing(payload, { deviceName: 'Phone', confirmFingerprint: true });
  assert.equal(result.endpoint.baseUrl, 'https://[fe80::1234]:49152');
});

test('pairs through a scoped NSD IPv6 result without using the QR host', async () => {
  const runtime = createMobileDesktopRuntime({
    storage,
    discoverForPairing: () => createMdnsDiscoveryAdapter({ nsd: {
      discover: async () => [{ type: 'prismata', protocol: 'tcp', host: 'fe80::1234%wlan0', port: 49152, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint, pairing: 'required' } }],
    } }).discover(),
    identity: async () => ({ deviceId: 'device-1', publicKey: 'public-key' }),
    pinnedRequest: async (url, pinnedFingerprint) => ({ status: 200, body: JSON.stringify(url.endsWith('/instance')
      ? { protocol: 'v1', instanceId: 'desktop-1', fingerprint: pinnedFingerprint, pairingRequired: true }
      : { deviceId: 'device-1', accessToken: 'token', refreshToken: 'refresh', expiresAt: '2099-01-01T00:00:00.000Z', instanceId: 'desktop-1', fingerprint: pinnedFingerprint }) }),
  });

  const result = await runtime.completePairing(payload, { deviceName: 'Phone', confirmFingerprint: true });
  assert.equal(result.endpoint.baseUrl, 'https://[fe80::1234%25wlan0]:49152');
});

test('QR pairing fails without a matching discovery result and never uses the QR host', async () => {
  const calls: string[] = [];
  const runtime = createMobileDesktopRuntime({
    storage,
    discoverForPairing: async () => [endpoint('https://other-host.local:48123', 'cd'.repeat(32))],
    pinnedRequest: async (url) => {
      calls.push(url);
      return { status: 200, body: '{}' };
    },
  });

  await assert.rejects(
    () => runtime.completePairing(payload, { deviceName: 'Phone', confirmFingerprint: true }),
    /matching discovered desktop/,
  );
  assert.deepEqual(calls, []);
});

test('an explicitly supplied manual endpoint does not trigger QR discovery', async () => {
  const runtime = createMobileDesktopRuntime({
    storage,
    discoverForPairing: async () => { throw new Error('QR discovery should not run'); },
    identity: async () => ({ deviceId: 'device-1', publicKey: 'public-key' }),
    pinnedRequest: async (url) => ({ status: 200, body: JSON.stringify(url.endsWith('/instance')
      ? { protocol: 'v1', instanceId: 'desktop-1', fingerprint, pairingRequired: true }
      : { deviceId: 'device-1', accessToken: 'token', refreshToken: 'refresh', expiresAt: '2099-01-01T00:00:00.000Z', instanceId: 'desktop-1', fingerprint }) }),
  });

  const result = await runtime.completePairing(payload, {
    deviceName: 'Phone',
    confirmFingerprint: true,
    endpoint: endpoint('https://manual-host.local:48123'),
  });

  assert.equal(result.endpoint.baseUrl, 'https://manual-host.local:48123');
});
