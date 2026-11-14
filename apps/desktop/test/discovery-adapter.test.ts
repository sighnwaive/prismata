import test from 'node:test';
import assert from 'node:assert/strict';
import { createMdnsDiscoveryAdapter } from '../src/discovery.js';

test('mDNS teardown resets failed state so a later publication can recover', async () => {
  let stopCalls = 0;
  let publishCalls = 0;
  const adapter = createMdnsDiscoveryAdapter({
    createBonjour: () => ({
      publish: () => {
        publishCalls += 1;
        return { stop: () => { stopCalls += 1; if (stopCalls === 1) throw new Error('stop failed'); } };
      },
      destroy: () => {},
    }),
  });
  const record = { host: '192.168.1.20', port: 48123, instanceId: 'desktop', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true };
  await adapter.start(record);
  await assert.rejects(adapter.stop, /stop failed/);
  await adapter.start(record);
  assert.equal(publishCalls, 2);
});

test('mDNS provider destroy rejection does not poison the next publication', async () => {
  let destroyCalls = 0;
  let publishCalls = 0;
  const adapter = createMdnsDiscoveryAdapter({
    createBonjour: () => ({
      publish: () => { publishCalls += 1; return { stop: (callback?: () => void) => callback?.() }; },
      destroy: () => { destroyCalls += 1; if (destroyCalls === 1) return Promise.reject(new Error('destroy failed')); },
    }),
  });
  const record = { host: '192.168.1.20', port: 48123, instanceId: 'desktop', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true };
  await adapter.start(record);
  await assert.rejects(adapter.stop, /destroy failed/);
  await adapter.start(record);
  assert.equal(publishCalls, 2);
});
import { createDiscoveryAdapter } from '../src/discovery.js';

test('discovery adapter is injectable and advertises no credentials', async () => {
  const calls: unknown[] = [];
  const discovery = createDiscoveryAdapter({ advertise: async (record) => { calls.push(record); }, unadvertise: async () => { calls.push('stop'); } });
  await discovery.start({ host: '192.168.1.20', port: 48123, instanceId: 'desktop-1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true });
  assert.deepEqual(calls[0], { service: '_prismata._tcp', host: '192.168.1.20', port: 48123, instanceId: 'desktop-1', protocol: 'v1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true });
  await discovery.stop();
  assert.equal(calls[1], 'stop');
});

test('discovery adapter rejects wildcard hosts', async () => {
  const discovery = createDiscoveryAdapter({ advertise: async () => {}, unadvertise: async () => {} });
  await assert.rejects(() => discovery.start({ host: '0.0.0.0', port: 48123, instanceId: 'desktop-1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true }), /reachable, not a wildcard/);
});

test('discovery adapter rejects IPv4 and IPv6 loopback hosts', async () => {
  const discovery = createDiscoveryAdapter({ advertise: async () => {}, unadvertise: async () => {} });
  for (const host of ['127.0.0.1', '::1']) {
    await assert.rejects(() => discovery.start({ host, port: 48123, instanceId: 'desktop-1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true }), /reachable, not a wildcard or loopback/);
  }
});

test('mDNS adapter publishes and stops a DNS-SD service through an injectable provider', async () => {
  const calls: unknown[] = [];
  const discovery = createMdnsDiscoveryAdapter({
    createBonjour: () => ({
       publish: (options) => { calls.push(['publish', options]); return { stop: (callback) => { calls.push('stop'); callback?.(); } }; },
      destroy: () => { calls.push('destroy'); },
    }),
  });
  await discovery.start({ host: '192.168.1.20', port: 48123, instanceId: 'desktop-1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true });
  assert.deepEqual(calls[0], ['publish', { name: 'Studio', host: '192.168.1.20', type: 'prismata', protocol: 'tcp', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }]);
  await discovery.stop();
  assert.deepEqual(calls.slice(1), ['stop', 'destroy']);
});

test('mDNS publication failure stops the partial service and destroys the provider', async () => {
  const calls: string[] = [];
  const discovery = createMdnsDiscoveryAdapter({
    createBonjour: () => ({
      publish: () => ({
        once(event: string, listener: () => void) { if (event === 'error') queueMicrotask(listener); },
        stop: (callback?: () => void) => { calls.push('stop'); callback?.(); },
      }),
      destroy: () => { calls.push('destroy'); },
    }),
  });
  await assert.rejects(() => discovery.start({ host: '192.168.1.20', port: 48123, instanceId: 'desktop-1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true }), /mDNS publication failed/);
  assert.deepEqual(calls, ['stop', 'destroy']);
});

test('mDNS provider destruction is awaited before a new publication', async () => {
  const calls: string[] = [];
  let releaseDestroy!: () => void;
  const destroyStarted = new Promise<void>((resolve) => { releaseDestroy = resolve; });
  const discovery = createMdnsDiscoveryAdapter({
    createBonjour: () => ({
      publish: () => { calls.push('publish'); return { stop: (callback?: () => void) => { calls.push('stop'); callback?.(); } }; },
      destroy: (callback?: () => void) => {
        calls.push('destroy-start');
        void destroyStarted.then(() => { calls.push('destroy-done'); callback?.(); });
      },
    }),
  });

  await discovery.start({ host: '192.168.1.20', port: 48123, instanceId: 'desktop-1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true });
  const stopping = discovery.stop();
  await Promise.resolve();
  const starting = discovery.start({ host: '192.168.1.21', port: 48123, instanceId: 'desktop-1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true });
  await Promise.resolve();
  assert.deepEqual(calls, ['publish', 'stop', 'destroy-start']);
  releaseDestroy();
  await stopping;
  await starting;
  assert.deepEqual(calls, ['publish', 'stop', 'destroy-start', 'destroy-done', 'publish']);
});

test('mDNS adapter awaits promise-returning provider destruction', async () => {
  const calls: string[] = [];
  let releaseDestroy!: () => void;
  const discovery = createMdnsDiscoveryAdapter({
    createBonjour: () => ({
      publish: () => { calls.push('publish'); return { stop: (callback?: () => void) => { calls.push('stop'); callback?.(); } }; },
      destroy: () => new Promise<void>((resolve) => { calls.push('destroy-start'); releaseDestroy = () => { calls.push('destroy-done'); resolve(); }; }),
    }),
  });
  await discovery.start({ host: '192.168.1.20', port: 48123, instanceId: 'desktop-1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true });
  const stopping = discovery.stop();
  await Promise.resolve();
  const starting = discovery.start({ host: '192.168.1.21', port: 48123, instanceId: 'desktop-1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true });
  await Promise.resolve();
  assert.deepEqual(calls, ['publish', 'stop', 'destroy-start']);
  releaseDestroy();
  await stopping;
  await starting;
  assert.deepEqual(calls, ['publish', 'stop', 'destroy-start', 'destroy-done', 'publish']);
});
