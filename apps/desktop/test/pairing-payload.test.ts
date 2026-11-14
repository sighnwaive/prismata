import assert from 'node:assert/strict';
import test from 'node:test';
import { createPairingPayload, parsePairingPayload } from '../src/pairing-payload.js';

test('pairing payload is versioned, validates, and contains only public short-lived data', async () => {
  const payload = await createPairingPayload({
    endpoint: 'https://192.168.1.20:48123',
    challenge: 'challenge-value',
    expiresAt: '2026-09-27T12:02:00.000Z',
    instanceId: 'desktop-1',
    fingerprint: 'ab'.repeat(32),
  });

  assert.equal(payload.version, 1);
  assert.equal(parsePairingPayload(payload.encoded).challenge, 'challenge-value');
  assert.match(payload.encoded, /^prismata:\/\/pair\?/);
  assert.doesNotMatch(payload.encoded, /accessToken|refreshToken|privateKey|secret/i);
  assert.throws(() => parsePairingPayload(payload.encoded.replace('v=1', 'v=2')), /unsupported pairing payload/);
});

test('desktop pairing payload creation enforces the shared strict endpoint contract', async () => {
  const valid = {
    challenge: 'challenge-value',
    expiresAt: '2026-09-27T12:02:00.000Z',
    instanceId: 'desktop-1',
    fingerprint: 'ab'.repeat(32),
  };
  for (const endpoint of [
    'http://desktop.local:48123',
    'https://desktop.local',
    'https://desktop.local:48123/settings',
    'https://desktop.local:48123?token=secret',
    'https://desktop.local:48123#secret',
    'https://user:secret@desktop.local:48123',
  ]) {
    await assert.rejects(() => createPairingPayload({ ...valid, endpoint }), /invalid pairing payload/);
  }
});

test('desktop-generated QR payload parses when custom URL construction is unavailable', async () => {
  const generated = await createPairingPayload({
    endpoint: 'https://desktop.local:48123',
    challenge: 'challenge-value',
    expiresAt: '2099-01-01T00:00:00.000Z',
    instanceId: 'desktop-1',
    fingerprint: 'ab'.repeat(32),
  });
  const nativeURL = globalThis.URL;
  const hermesURL = function (this: unknown, input: string | URL, base?: string | URL) {
    if (String(input).startsWith('prismata://')) throw new TypeError('URL.protocol is not implemented');
    return new nativeURL(input, base);
  } as unknown as typeof URL;
  Object.defineProperty(globalThis, 'URL', { configurable: true, value: hermesURL });
  try {
    assert.equal(parsePairingPayload(generated.encoded).challenge, 'challenge-value');
  } finally {
    Object.defineProperty(globalThis, 'URL', { configurable: true, value: nativeURL });
  }
});
