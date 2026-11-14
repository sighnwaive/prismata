import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import test from 'node:test';
import { createDesktopService } from '../src/desktop-service.js';
import { createTransportIdentityStore, isTransportMaterialValid } from '../src/transport-identity.js';

function errorServer(code: string) {
  return {
    once(event: string, listener: (error: NodeJS.ErrnoException) => void) {
      if (event === 'error') queueMicrotask(() => listener(Object.assign(new Error(code), { code })));
      return this;
    },
    listen() { return this; },
    address: () => null,
    close(callback: (error?: Error) => void) { callback(); },
  };
}

test('desktop transport identity generates, persists, and exposes only certificate metadata', async () => {
  const values = new Map<string, unknown>();
  const store = createTransportIdentityStore({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
  });
  const first = await store.loadOrCreate('192.168.1.20');
  const second = await store.loadOrCreate('192.168.1.20');
  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal('key' in first.publicMetadata, false);
  assert.equal('privateKey' in first.publicMetadata, false);
});

test('desktop transport identity regenerates persisted material when its certificate identity is invalid', async () => {
  const values = new Map<string, unknown>();
  const store = createTransportIdentityStore({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
  });
  const original = await store.loadOrCreate('192.168.1.20');
  values.set('lan-transport-identity', { ...original, fingerprint: '00'.repeat(32) });
  const regenerated = await store.loadOrCreate('192.168.1.20');
  assert.notEqual(regenerated.fingerprint, original.fingerprint);
  assert.equal(regenerated.cert, (values.get('lan-transport-identity') as typeof regenerated).cert);
});

test('desktop transport identity regenerates persisted material when the private key does not match', async () => {
  const values = new Map<string, unknown>();
  const store = createTransportIdentityStore({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
  });
  const original = await store.loadOrCreate('192.168.1.20');
  const other = await createTransportIdentityStore({ get: async () => null, set: async () => {} }).loadOrCreate('192.168.1.20');
  values.set('lan-transport-identity', { ...original, key: other.key });
  const regenerated = await store.loadOrCreate('192.168.1.20');
  assert.notEqual(regenerated.key, other.key);
  assert.notEqual(regenerated.fingerprint, original.fingerprint);
});

test('desktop transport identity rejects an expired certificate', async () => {
  const values = new Map<string, unknown>();
  const store = createTransportIdentityStore({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
  });
  const original = await store.loadOrCreate('127.0.0.1');
  const expiry = Date.parse(new X509Certificate(original.cert).validTo);
  assert.equal(isTransportMaterialValid(original, expiry + 1), false);
});

test('desktop LAN service uses HTTPS and does not expose private material', async () => {
  const values = new Map<string, unknown>();
  const identity = await createTransportIdentityStore({ get: async (key) => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); } }).loadOrCreate('127.0.0.1');
  const service = await createDesktopService({
    dataFile: ':memory:',
    tls: identity,
  });
  const started = await service.start(0, '127.0.0.1');
  assert.ok(started);
  assert.equal(service.transportMetadata().fingerprint, identity.fingerprint);
  assert.equal('key' in service.transportMetadata(), false);
  await service.stop();
});

for (const code of ['EADDRINUSE', 'EACCES']) {
  test(`HTTPS startup rejects when the server emits ${code}`, async () => {
    const values = new Map<string, unknown>();
    const identity = await createTransportIdentityStore({ get: async (key) => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); } }).loadOrCreate('127.0.0.1');
    const service = await createDesktopService({ dataFile: ':memory:', tls: identity, serverFactory: (() => errorServer(code)) as any });
    await assert.rejects(service.start(48123, '127.0.0.1'), (error: NodeJS.ErrnoException) => error.code === code);
    await service.close();
  });
}
