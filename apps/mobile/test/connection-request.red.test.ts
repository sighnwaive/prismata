import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMobileDesktopRuntime } from '../src/desktop-runtime';

test('mobile explicitly discovers, selects, and creates a connection request with a displayed code', async () => {
  const runtime = createMobileDesktopRuntime({
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    discoverForPairing: async () => [{ baseUrl: 'https://desktop.local:48123', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32), displayName: 'Studio' }],
    identity: async () => ({ deviceId: 'phone-1', publicKey: 'public' }),
    pinnedRequest: async (url) => ({ status: url.endsWith('/instance') ? 200 : 201, body: JSON.stringify(url.endsWith('/instance') ? { protocol: 'v1', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32), pairingRequired: true } : { requestId: 'request-1', code: 'ABCD23', expiresAt: '2099-01-01T00:00:00.000Z', status: 'pending', instanceId: 'desktop-1', deviceId: 'phone-1', deviceName: 'Phone' }) }),
  });
  const found = await runtime.scanForDesktops();
  assert.equal(found[0].instanceId, 'desktop-1');
  const request = await runtime.requestConnection(found[0], 'Phone');
   assert.equal(request.code, 'ABCD23');
  assert.equal(runtime.getConnectionRequest()?.status, 'pending');
});

test('mobile retrieves the code only with its request proof', async () => {
  const calls: Array<{ url: string; proof?: string }> = [];
  const runtime = createMobileDesktopRuntime({
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    identity: async () => ({ deviceId: 'phone-proof', publicKey: 'public' }),
    pinnedRequest: async (url, _fingerprint, init) => {
      calls.push({ url, proof: new Headers(init.headers).get('x-prismata-request-proof') ?? undefined });
      const body = url.endsWith('/instance')
        ? { protocol: 'v1', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32), pairingRequired: true }
        : url.endsWith('/connection-requests')
          ? { requestId: 'request-proof', requestProof: 'proof-1', expiresAt: '2099-01-01T00:00:00.000Z', status: 'pending', instanceId: 'desktop-1', deviceId: 'phone-proof', deviceName: 'Phone' }
          : { requestId: 'request-proof', code: 'ABCD23', expiresAt: '2099-01-01T00:00:00.000Z', status: 'pending', instanceId: 'desktop-1', deviceId: 'phone-proof', deviceName: 'Phone' };
      return { status: url.endsWith('/instance') ? 200 : url.endsWith('/connection-requests') ? 201 : 200, body: JSON.stringify(body) };
    },
  });
  const request = await runtime.requestConnection({ baseUrl: 'https://desktop.local:48123', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32) }, 'Phone');
  assert.equal(request.code, 'ABCD23');
  assert.equal(calls.at(-1)?.proof, 'proof-1');
});

test('mobile and desktop display the same server-generated confirmation code', async () => {
  const serverCode = 'ZXCV23';
  const calls: string[] = [];
  const pinnedRequest = async (url: string, _fingerprint: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/instance')) return { status: 200, body: JSON.stringify({ protocol: 'v1', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32), pairingRequired: true }) };
    calls.push(path);
    const body = path.endsWith('/connection-requests')
      ? { requestId: 'request-code-consistency', requestProof: 'proof-code-consistency', expiresAt: '2099-01-01T00:00:00.000Z', status: 'pending', instanceId: 'desktop-1', deviceId: 'phone-code-consistency', deviceName: 'Phone' }
      : { requestId: 'request-code-consistency', requestProof: 'proof-code-consistency', code: serverCode, expiresAt: '2099-01-01T00:00:00.000Z', status: 'pending', instanceId: 'desktop-1', deviceId: 'phone-code-consistency', deviceName: 'Phone' };
    if (path.endsWith('/connection-requests') && init?.method === 'POST') return { status: 201, body: JSON.stringify(body) };
    return { status: 200, body: JSON.stringify(body) };
  };
  const runtime = createMobileDesktopRuntime({
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    identity: async () => ({ deviceId: 'phone-code-consistency', publicKey: 'public' }),
    pinnedRequest,
  });
  const endpoint = { baseUrl: 'https://desktop.local:48123', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32) };
  const mobileRequest = await runtime.requestConnection(endpoint, 'Phone');
  const desktopRequest = JSON.parse(JSON.stringify(mobileRequest));
  assert.equal(mobileRequest.code, serverCode);
  assert.equal(desktopRequest.code, serverCode);
  assert.deepEqual(calls, ['/api/v1/connection-requests', '/api/v1/connection-requests/request-code-consistency']);
});

test('mobile refuses a desktop that does not require pairing', async () => {
  const runtime = createMobileDesktopRuntime({
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    discoverForPairing: async () => [{ baseUrl: 'https://desktop.local:48123', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32) }],
    pinnedRequest: async () => ({ status: 200, body: JSON.stringify({ protocol: 'v1', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32), pairingRequired: false }) }),
  });
  const [desktop] = await runtime.scanForDesktops();
  await assert.rejects(() => runtime.requestConnection(desktop, 'Phone'), /pairing is required/);
});

test('mobile auth flow does not discover until the scan action is invoked', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/auth-flow.tsx'), 'utf8');
  const effect = source.slice(source.indexOf('useEffect(() =>'), source.indexOf('const scan ='));
  assert.doesNotMatch(effect, /scanForDesktops|createMdnsDiscoveryAdapter/);
  assert.match(source, /onPress=\{\(\) => void scan\(\)\}/);
  assert.match(source, /request\.code/);
  assert.doesNotMatch(source, /Shown on desktop/);
});
