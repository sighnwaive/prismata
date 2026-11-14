import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopLifecycle } from '../src/desktop-lifecycle.js';
import { createTransportIdentityStore } from '../src/transport-identity.js';

type Advertisement = { host?: string; port: number; fingerprint: string; manualIdentityVerificationRequired?: boolean };

test('getSettings is safe before lifecycle start', async () => {
  const lifecycle = createDesktopLifecycle({ dataFile: ':memory:' });

  assert.deepEqual(await lifecycle.getSettings(), {
    settings: {},
    revision: 0,
    updatedAt: '1970-01-01T00:00:00.000Z',
    origin: 'desktop',
  });
  await assert.rejects(() => lifecycle.saveSettings({ theme: 'dark' }), /desktop service is unavailable; start lifecycle before saving settings/);

  await lifecycle.start();
  const saved = await lifecycle.saveSettings({ theme: 'dark' });
  assert.deepEqual(await lifecycle.getSettings(), saved);
  await lifecycle.stop();
});

test('NO_ADDRESS returns actionable user-facing status when no eligible advertised address exists', async () => {
  const advertised: unknown[] = [];
  const bound: unknown[] = [];
  const lifecycle = createDesktopLifecycle({ dataFile: ':memory:', networkInterfaces: () => ({ lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: '127.0.0.1/8' }] }), discovery: { start: async (record) => { advertised.push(record); }, stop: async () => {} }, serviceFactory: async () => ({ start: async (port: number, host: string) => { bound.push(host); return { port: port || 48123 }; }, stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any });
  const status = await lifecycle.enableLan();
  assert.deepEqual(status.lanError, { code: 'NO_ADDRESS', message: 'No eligible network address is available. Connect to a LAN or select an interface, then retry.', retryable: true });
  assert.deepEqual(bound, []);
  assert.deepEqual(advertised, []);
  await lifecycle.stop();
});

test('non-TLS startup failures are represented as generic retryable LAN status errors', async () => {
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    networkInterfaces: () => ({ lan: [{ address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '192.168.1.20/24' }] }),
    discovery: { start: async () => {}, stop: async () => {} },
    serviceFactory: async () => ({ start: async () => { throw new Error('address already in use'); }, stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  const status = await lifecycle.enableLan();
  assert.equal(status.lanEnabled, false);
  assert.deepEqual(status.lanError, { code: 'LAN_STARTUP_FAILED', message: 'address already in use', retryable: true });
  await lifecycle.stop();
});

test('canonical unsafe IP forms cannot be advertised even when reported by an interface', async () => {
  const unsafe = ['127.0.0.1', '::1', '0.0.0.0', '::', '::ffff:127.0.0.1', '::ffff:0:0', '::ffff:0.0.0.0', 'localhost', 'LOCALHOST', 'localhost.localdomain', 'ip6-localhost'];
  for (const address of unsafe) {
    const lifecycle = createDesktopLifecycle({
      dataFile: ':memory:',
      advertisedAddress: address,
      networkInterfaces: () => ({ lan: [{ address, netmask: '', family: address.includes(':') ? 'IPv6' : 'IPv4', mac: '', internal: false, cidr: '' }] }) as any,
      discovery: { start: async () => {}, stop: async () => {} },
      serviceFactory: async () => ({ start: async () => ({ port: 48123 }), stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
    });
    const status = await lifecycle.enableLan();
    assert.equal(status.lanEnabled, false);
    assert.ok(status.lanError);
    await lifecycle.stop();
  }
});

test('valid IPv4 and IPv6 interface addresses remain advertisable', async () => {
  for (const [address, family] of [['192.168.1.20', 'IPv4'], ['2001:db8::20', 'IPv6'], ['::ffff:192.168.1.20', 'IPv6']] as const) {
    const lifecycle = createDesktopLifecycle({
      dataFile: ':memory:',
      advertisedAddress: address,
      networkInterfaces: () => ({ lan: [{ address, netmask: '', family, mac: '', internal: false, cidr: '' }] }) as any,
      discovery: { start: async () => {}, stop: async () => {} },
      identityStore: createTransportIdentityStore({ get: async () => null, set: async () => {} }),
      serviceFactory: async () => ({ start: async () => ({ port: 48123 }), stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
    });
    const status = await lifecycle.enableLan();
    assert.equal(status.lanEnabled, true, `${address}: ${status.lanError?.message ?? 'unknown error'}`);
    assert.equal(status.advertisedHost, address);
    await lifecycle.stop();
  }
});

test('scoped IPv6 advertised addresses are rejected clearly', async () => {
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    advertisedAddress: 'fe80::20%en0',
    networkInterfaces: () => ({ lan: [{ address: 'fe80::20%en0', netmask: '', family: 'IPv6', mac: '', internal: false, cidr: '' }] }) as any,
    discovery: { start: async () => {}, stop: async () => {} },
    serviceFactory: async () => ({ start: async () => ({ port: 48123 }), stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  const status = await lifecycle.enableLan();
  assert.equal(status.lanEnabled, false);
  assert.match(status.lanError?.message ?? '', /scoped IPv6 advertised addresses are unsupported/);
  await lifecycle.stop();
});

test('address changes are rejected when the pinned certificate does not cover the address', async () => {
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    advertisedAddress: '192.168.1.20',
    networkInterfaces: () => ({ lan: [
      { address: '192.168.1.20', netmask: '', family: 'IPv4', mac: '', internal: false, cidr: '' },
      { address: '10.8.0.4', netmask: '', family: 'IPv4', mac: '', internal: false, cidr: '' },
    ] }) as any,
    discovery: { start: async () => {}, stop: async () => {} },
    identityStore: { loadOrCreate: (host: string) => createTransportIdentityStore({ get: async () => null, set: async () => {} }).loadOrCreate(host) },
    serviceFactory: async () => ({ start: async () => ({ port: 48123 }), stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  await lifecycle.enableLan();
  await assert.rejects(lifecycle.setAdvertisedAddress('10.8.0.4'), /certificate does not cover advertised address/);
  assert.equal(lifecycle.getStatus().advertisedHost, '192.168.1.20');
  await lifecycle.stop();
});

test('lifecycle shutdown closes the desktop service and its local store', async () => {
  let closed = 0;
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    networkInterfaces: () => ({ lan: [{ address: '192.168.1.20', netmask: '', family: 'IPv4', mac: '', internal: false, cidr: '' }] }),
    discovery: { start: async () => {}, stop: async () => {} },
    serviceFactory: async () => ({ start: async () => ({ port: 48123 }), stop: async () => {}, close: async () => { closed += 1; }, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  await lifecycle.start();
  await lifecycle.enableLan();
  await lifecycle.stop();
  assert.equal(closed, 2);
});

test('lifecycle recreation closes the startup service before replacing it', async () => {
  const closed: string[] = [];
  let created = 0;
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    networkInterfaces: () => ({ lan: [{ address: '192.168.1.20', netmask: '', family: 'IPv4', mac: '', internal: false, cidr: '' }] }),
    discovery: { start: async () => {}, stop: async () => {} },
    serviceFactory: async () => {
      const id = `service-${++created}`;
      return { start: async () => ({ port: 48123 }), stop: async () => {}, close: async () => { closed.push(id); }, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false } as any;
    },
  });
  await lifecycle.start();
  await lifecycle.enableLan();
  assert.deepEqual(closed, ['service-1']);
  await lifecycle.stop();
  assert.deepEqual(closed, ['service-1', 'service-2']);
});

test('LAN binds all interfaces by default but advertises the first active private IPv4 interface', async () => {
  const advertised: Advertisement[] = [];
  const bound: unknown[] = [];
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    port: 48123,
    networkInterfaces: () => ({
      loopback: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: '127.0.0.1/8' }],
      public: [{ address: '203.0.113.10', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '203.0.113.10/24' }],
      lan: [{ address: '169.254.20.4', netmask: '255.255.0.0', family: 'IPv4', mac: '', internal: false, cidr: '169.254.20.4/16' }, { address: '172.20.4.8', netmask: '255.255.0.0', family: 'IPv4', mac: '', internal: false, cidr: '172.20.4.8/16' }],
    }),
    discovery: { start: async (record) => { advertised.push(record); }, stop: async () => {} },
    serviceFactory: async () => ({ start: async (port: number, host: string) => { bound.push([port, host]); return { port }; }, stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  const status = await lifecycle.enableLan();
  assert.equal(status.host, '0.0.0.0');
  assert.deepEqual(bound, [[48123, '0.0.0.0']]);
  assert.equal(advertised[0].host, '172.20.4.8');
  assert.doesNotMatch(advertised[0].host ?? '', /^(0\.0\.0\.0|::)$/);
  await lifecycle.stop();
});

test('explicit lanHost overrides interface selection', async () => {
  const bound: unknown[] = [];
  const lifecycle = createDesktopLifecycle({ dataFile: ':memory:', lanHost: '192.168.50.7', networkInterfaces: () => ({ lan: [{ address: '10.0.0.8', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: false, cidr: '10.0.0.8/8' }] }), discovery: { start: async () => {}, stop: async () => {} }, serviceFactory: async () => ({ start: async (port: number, host: string) => { bound.push(host); return { port: port || 48123 }; }, stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any });
  const status = await lifecycle.enableLan();
  assert.equal(status.host, '192.168.50.7');
  assert.deepEqual(bound, ['192.168.50.7']);
  await lifecycle.stop();
});

test('non-private explicit lanHost is rejected', async () => {
  const lifecycle = createDesktopLifecycle({ dataFile: ':memory:', lanHost: '8.8.8.8', networkInterfaces: () => ({ lan: [{ address: '10.0.0.8', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: false, cidr: '10.0.0.8/8' }] }), discovery: { start: async () => {}, stop: async () => {} } });
  const status = await lifecycle.enableLan();
  assert.match(status.lanError?.message ?? '', /configured lanHost must be a private RFC1918 IPv4 address/);
  await lifecycle.stop();
});

test('wildcard interface addresses are never advertised', async () => {
  const advertised: Advertisement[] = [];
  const lifecycle = createDesktopLifecycle({ dataFile: ':memory:', networkInterfaces: () => ({ lan: [{ address: '0.0.0.0', netmask: '0.0.0.0', family: 'IPv4', mac: '', internal: false, cidr: '0.0.0.0/0' }] }), discovery: { start: async (record) => { advertised.push(record); }, stop: async () => {} }, serviceFactory: async () => ({ start: async (port: number) => ({ port: port || 48123 }), stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any });
  const status = await lifecycle.enableLan();
  assert.equal(status.lanError?.code, 'NO_ADDRESS');
  assert.deepEqual(advertised, []);
  await lifecycle.stop();
});

test('enabled LAN binds and advertises the configured private host and port', async () => {
  const advertised: Advertisement[] = [];
  const bound: unknown[] = [];
  const lifecycle = createDesktopLifecycle({ dataFile: ':memory:', lanHost: '192.168.1.20', port: 48123, discovery: { start: async (record) => { advertised.push(record); }, stop: async () => {} }, serviceFactory: async () => ({ start: async (port: number, host: string) => { bound.push([port, host]); return { address: host, port }; }, stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any });
  const status = await lifecycle.enableLan();
  assert.deepEqual(bound, [[48123, '192.168.1.20']]);
  assert.match(status.baseUrl ?? '', /^https:\/\//);
  assert.equal(advertised[0].host, '192.168.1.20');
  assert.equal(advertised[0].port, 48123);
  await lifecycle.stop();
});

test('missing fingerprint advertises explicit manual identity verification', async () => {
  const advertised: Advertisement[] = [];
  const lifecycle = createDesktopLifecycle({ dataFile: ':memory:', lanHost: '10.0.0.8', discovery: { start: async (record) => { advertised.push(record); }, stop: async () => {} }, serviceFactory: async () => ({ start: async (port: number) => ({ port: port || 48123 }), stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any });
  await lifecycle.enableLan();
  assert.match(advertised[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(advertised[0].manualIdentityVerificationRequired, undefined);
  await lifecycle.stop();
});

test('re-enabling LAN stops the prior advertisement before replacing the service', async () => {
  const events: string[] = [];
  let created = 0;
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    networkInterfaces: () => ({ lan: [{ address: '192.168.1.20', netmask: '', family: 'IPv4', mac: '', internal: false, cidr: '192.168.1.20/24' }] }),
    discovery: { start: async () => { events.push('advertise'); }, stop: async () => { events.push('unadvertise'); } },
    serviceFactory: async () => {
      const id = `service-${++created}`;
      return { start: async () => { events.push(`start:${id}`); return { port: 48123 }; }, stop: async () => {}, close: async () => { events.push(`close:${id}`); }, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false } as any;
    },
  });
  await lifecycle.enableLan();
  events.length = 0;
  await lifecycle.enableLan();
  assert.deepEqual(events, ['unadvertise', 'close:service-1', 'start:service-2', 'unadvertise', 'advertise']);
  await lifecycle.stop();
});

test('re-enabling LAN stops the prior advertisement when new startup fails', async () => {
  const events: string[] = [];
  let starts = 0;
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    networkInterfaces: () => ({ lan: [{ address: '192.168.1.20', netmask: '', family: 'IPv4', mac: '', internal: false, cidr: '192.168.1.20/24' }] }),
    discovery: { start: async () => { events.push('advertise'); }, stop: async () => { events.push('unadvertise'); } },
    serviceFactory: async () => ({ start: async () => { starts += 1; events.push(`start:${starts}`); if (starts === 2) throw new Error('startup failed'); return { port: 48123 }; }, stop: async () => {}, close: async () => { events.push('close'); }, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  await lifecycle.enableLan();
  events.length = 0;
  const status = await lifecycle.enableLan();
  assert.equal(status.lanEnabled, false);
  assert.deepEqual(events, ['unadvertise', 'close', 'start:2', 'close']);
  await lifecycle.stop();
});
