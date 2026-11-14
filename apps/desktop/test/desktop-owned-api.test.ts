import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopService } from '../src/desktop-service.js';

test('LAN API exposes metadata but legacy QR endpoints cannot issue sessions', async () => {
  const service = await createDesktopService({ dataFile: ':memory:' });
  assert.equal((await service.request('/api/v1/health')).status, 200);
  const instance = await service.request('/api/v1/instance');
  assert.equal(instance.status, 200);
  const instanceBody = instance.body as { pairingRequired: boolean; accessToken?: string };
  assert.equal(instanceBody.pairingRequired, true);
  assert.equal('accessToken' in instanceBody, false);

  const challenge = await service.request('/api/v1/pairing/start', { method: 'POST', body: { deviceName: 'Phone' } });
  const pairing = await service.request('/api/v1/pairing/complete', {
    method: 'POST',
    body: { challenge: (challenge.body as { challenge: string }).challenge, deviceId: 'phone-1', publicKey: 'phone-key' },
  });
  assert.equal(challenge.status, 404);
  assert.equal(pairing.status, 404);
});

test('legacy device deletion flow has no bearer token to use', async () => {
  const service = await createDesktopService({ dataFile: ':memory:' });
  const challenge = await service.request('/api/v1/pairing/start', { method: 'POST' });
  const pairing = await service.request('/api/v1/pairing/complete', {
    method: 'POST',
    body: { challenge: (challenge.body as { challenge: string }).challenge, deviceId: 'phone-1', publicKey: 'phone-key' },
  });
  assert.equal(challenge.status, 404);
  assert.equal(pairing.status, 404);
});

test('legacy pairing challenge issuance is disabled at the API boundary', async () => {
  let clock = Date.parse('2026-09-27T12:00:00.000Z');
  const service = await createDesktopService({ dataFile: ':memory:', now: () => clock });
  assert.equal((await service.request('/api/v1/pairing/start', { method: 'POST' })).status, 404);
  assert.equal((await service.request('/api/v1/pairing/complete', { method: 'POST', body: { challenge: 'legacy' } })).status, 404);
});
