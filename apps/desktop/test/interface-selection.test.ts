import assert from 'node:assert/strict';
import test from 'node:test';
import { enumerateEligibleInterfaces, createDesktopLifecycle, type NetworkInterfaceChoice } from '../src/desktop-lifecycle.js';
import { createAuthPreloadApi, type DesktopAdminPreloadApi } from '../electron/preload-api.js';

const interfaces = () => ({
  lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: '127.0.0.1/8' }],
  wifi: [{ address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '192.168.1.20/24' }],
  vpn: [{ address: '10.8.0.4', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '10.8.0.4/24' }],
  wildcard: [{ address: '0.0.0.0', netmask: '0.0.0.0', family: 'IPv4', mac: '', internal: false, cidr: '0.0.0.0/0' }],
});

test('enumerates only eligible non-loopback, non-internal, non-wildcard addresses', () => {
  assert.deepEqual(enumerateEligibleInterfaces(interfaces as any), [
    { name: 'wifi', address: '192.168.1.20', family: 'IPv4' },
    { name: 'vpn', address: '10.8.0.4', family: 'IPv4' },
  ]);
});

test('rejects broadcast and multicast addresses but accepts unicast addresses', () => {
  const addresses = [
    ['224.0.0.1', false],
    ['192.168.1.255', false],
    ['ff02::1', false],
    ['ff00::', false],
    ['2001:db8::20', true],
    ['192.168.1.20', true],
  ] as const;
  for (const [address, eligible] of addresses) {
    const result = enumerateEligibleInterfaces(() => ({ lan: [{ address, netmask: address === '192.168.1.255' ? '255.255.255.0' : '', family: address.includes(':') ? 'IPv6' : 'IPv4', mac: '', internal: false, cidr: '' }] }));
    assert.equal(result.length > 0, eligible, address);
  }
});

test('uses interface netmasks for directed broadcast rejection without rejecting valid .255 unicast addresses', () => {
  const directedBroadcast = () => ({ lan: [{ address: '10.0.1.255', netmask: '255.255.255.128', family: 'IPv4', mac: '', internal: false, cidr: '10.0.1.255/25' }] });
  assert.deepEqual(enumerateEligibleInterfaces(directedBroadcast as any), []);

  const validUnicast = () => ({ lan: [{ address: '10.0.1.255', netmask: '255.255.255.254', family: 'IPv4', mac: '', internal: false, cidr: '10.0.1.255/31' }] });
  assert.deepEqual(enumerateEligibleInterfaces(validUnicast as any), [{ name: 'lan', address: '10.0.1.255', family: 'IPv4' }]);
});

test('explicit advertised address is independent from the all-interface HTTPS bind', async () => {
  const bound: string[] = [];
  const advertised: string[] = [];
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    networkInterfaces: interfaces as any,
    advertisedAddress: '10.8.0.4',
    discovery: { start: async (record) => { advertised.push(record.host); }, stop: async () => {} },
    serviceFactory: async () => ({ start: async (port: number, host: string) => { bound.push(host); return { port: port || 48123 }; }, stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  const status = await lifecycle.enableLan();
  assert.equal(status.host, '0.0.0.0');
  assert.equal(status.advertisedHost, '10.8.0.4');
  assert.deepEqual(bound, ['0.0.0.0']);
  assert.deepEqual(advertised, ['10.8.0.4']);
  await lifecycle.stop();
});

test('advertising status follows successful publication and exposes retryable errors', async () => {
  let fail = true;
  let starts = 0;
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    networkInterfaces: interfaces as any,
    discovery: { start: async () => { starts += 1; if (fail) throw new Error('Bonjour unavailable'); }, stop: async () => {} },
    serviceFactory: async () => ({ start: async (port: number) => ({ port: port || 48123 }), stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  const failed = await lifecycle.enableLan();
  assert.equal(failed.discovery, 'error');
  assert.equal(failed.discoveryError, 'Bonjour unavailable');
  assert.notEqual(failed.discovery, 'advertising');
  fail = false;
  const retried = await lifecycle.retryAdvertising();
  assert.equal(retried.discovery, 'advertising');
  assert.equal(retried.discoveryError, null);
  assert.equal(starts, 2);
  await lifecycle.stop();
});

test('reselection stops the stale record before publishing exactly one current record', async () => {
  const events: string[] = [];
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    networkInterfaces: interfaces as any,
    discovery: { start: async (record) => { events.push(`start:${record.host}`); }, stop: async () => { events.push('stop'); } },
    serviceFactory: async () => ({ start: async (port: number) => ({ port: port || 48123 }), stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  await lifecycle.enableLan();
  await lifecycle.setAdvertisedAddress('10.8.0.4');
  assert.deepEqual(events, ['stop', 'start:192.168.1.20', 'stop', 'start:10.8.0.4']);
  await lifecycle.stop();
});

test('reselection recomputes the endpoint and publishes the selected address', async () => {
  const advertised: Array<{ host: string; port: number }> = [];
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    networkInterfaces: interfaces as any,
    advertisedAddress: '192.168.1.20',
    discovery: { start: async (record) => { advertised.push(record); }, stop: async () => {} },
    serviceFactory: async () => ({ start: async (port: number) => ({ port: port || 48123 }), stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  await lifecycle.enableLan();
  const selected = await lifecycle.setAdvertisedAddress('10.8.0.4');
  assert.equal(selected.baseUrl, 'https://10.8.0.4:48123');
  assert.deepEqual(advertised.map(({ host, port }) => ({ host, port })), [
    { host: '192.168.1.20', port: 48123 },
    { host: '10.8.0.4', port: 48123 },
  ]);
  await lifecycle.stop();
});

test('retry stops the prior adapter before republishing', async () => {
  const events: string[] = [];
  let fail = true;
  const lifecycle = createDesktopLifecycle({
    dataFile: ':memory:',
    networkInterfaces: interfaces as any,
    discovery: { start: async () => { events.push('start'); if (fail) throw new Error('unavailable'); }, stop: async () => { events.push('stop'); } },
    serviceFactory: async () => ({ start: async (port: number) => ({ port: port || 48123 }), stop: async () => {}, request: async () => ({ status: 200 }), listDevices: async () => [], revokeDevice: async () => false }) as any,
  });
  await lifecycle.enableLan();
  fail = false;
  await lifecycle.retryAdvertising();
  assert.deepEqual(events, ['stop', 'start', 'stop', 'start']);
  await lifecycle.stop();
});

test('typed admin preload surface exposes interface selection and advertising retry', () => {
  const api: DesktopAdminPreloadApi = {
    getStatus: async () => ({}) as never,
    setLanEnabled: async () => ({}) as never,
    listNetworkInterfaces: async (): Promise<NetworkInterfaceChoice[]> => [],
    setAdvertisedAddress: async () => ({}) as never,
    retryAdvertising: async () => ({}) as never,
    listDevices: async () => [], revokeDevice: async () => {}, listConnectionRequests: async () => [], approveConnectionRequest: async () => undefined,
  };
  assert.ok(api.listNetworkInterfaces);
  assert.ok(createAuthPreloadApi);
});
