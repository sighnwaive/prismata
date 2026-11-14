import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { NativeModules } from 'react-native';
import { createMobileDesktopRuntime } from '../src/desktop-runtime';

test('mobile runtime preserves an explicitly injected pinned request', async () => {
  const expectedFingerprint = 'ab'.repeat(32);
  const calls: string[] = [];
  NativeModules.PrismataCertificatePin = {
    request: async () => ({ status: 200, body: JSON.stringify({ status: 'ok', protocol: 'v1' }) }),
  };
  const runtime = createMobileDesktopRuntime({
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint: expectedFingerprint },
    pinnedRequest: async (url, fingerprint) => {
      calls.push(`${url}|${fingerprint}`);
      return { status: 200, body: JSON.stringify({ status: 'ok', protocol: 'v1' }) };
    },
  });

  await runtime.startPairing();
  assert.deepEqual(calls, [`https://desktop.local:48123/api/v1/pairing/start|${expectedFingerprint}`]);
});

test('mobile runtime rejects a pin mismatch without an unpinned fallback', async () => {
  NativeModules.PrismataCertificatePin = {
    request: async () => ({ status: 200, body: '{}' }),
  };
  const runtime = createMobileDesktopRuntime({
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint: 'ab'.repeat(32) },
    pinnedRequest: async () => {
      throw new Error('certificate fingerprint mismatch');
    },
  });

  await assert.rejects(() => runtime.startPairing(), /certificate fingerprint mismatch/);
});

test('mobile settings operations use the injected pinned request', async () => {
  const expectedFingerprint = 'cd'.repeat(32);
  const verified: string[] = [];
  NativeModules.PrismataCertificatePin = {
    request: async () => ({ status: 200, body: '{}' }),
  };
  const runtime = createMobileDesktopRuntime({
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint: expectedFingerprint },
    pinnedRequest: async (url, fingerprint) => {
      verified.push(`${url}|${fingerprint}`);
      return { status: 200, body: JSON.stringify({ settings: {}, revision: 1, updatedAt: '', origin: url.toString() }) };
    },
  });
  await runtime.setPairing({ baseUrl: 'https://desktop.local:48123', fingerprint: expectedFingerprint }, { deviceId: 'device', accessToken: 'token', instanceId: 'desktop' });

  await runtime.pullSettings();
  await runtime.pushSettings({ theme: 'dark' }, 1);
  assert.deepEqual(verified, [
    `https://desktop.local:48123/api/v1/settings|${expectedFingerprint}`,
    `https://desktop.local:48123/api/v1/settings|${expectedFingerprint}`,
  ]);
});

test('production mobile requests use the native pinned connection for application data', async () => {
  const expectedFingerprint = 'ef'.repeat(32);
  const nativeRequests: Array<{ url: string; fingerprint: string; method: string }> = [];
  NativeModules.PrismataCertificatePin = {
    request: async (url: string, fingerprint: string, method: string) => {
      nativeRequests.push({ url, fingerprint, method });
      return { status: 200, body: JSON.stringify({ status: 'ok', protocol: 'v1' }) };
    },
  };
  const runtime = createMobileDesktopRuntime({
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    endpoint: { baseUrl: 'https://desktop.local:48123', fingerprint: expectedFingerprint },
  });

  await runtime.startPairing();
  assert.deepEqual(nativeRequests, [{ url: 'https://desktop.local:48123/api/v1/pairing/start', fingerprint: expectedFingerprint, method: 'POST' }]);
});

test('mobile runtime cannot select ordinary fetch with only an injected verifier', () => {
  assert.throws(() => createMobileDesktopRuntime({
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    fetchImpl: async () => new Response('{}'),
    verifyCertificate: async () => {},
  }), /same-connection pinned request/);
});

test('native request validates the peer before transmitting a request body', async () => {
  const source = await readFile(resolve(process.cwd(), 'android/app/src/main/java/com/prismata/PrismataCertificatePinModule.kt'), 'utf8');
  const connect = source.indexOf('connection.connect()');
  const verify = source.indexOf('verifyPeerCertificate(connection, expectedFingerprint)');
  const output = source.indexOf('connection.outputStream');
  assert.notEqual(connect, -1);
  assert.notEqual(verify, -1);
  assert.notEqual(output, -1);
  assert.ok(connect < verify, 'TLS connection must complete before peer validation');
  assert.ok(verify < output, 'peer validation must happen before request body transmission');
});
