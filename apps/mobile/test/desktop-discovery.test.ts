import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDiscoveryAdvertisement, parseManualDesktopEndpoint, parseMdnsService } from '@prismata/sync';
import { createMdnsDiscoveryAdapter } from '../src/mdns-discovery';

test('strictly parses a Prismata DNS-SD advertisement into a desktop endpoint', () => {
  assert.deepEqual(parseDiscoveryAdvertisement({
    service: '_prismata._tcp', port: 48123, instanceId: 'desktop-1', protocol: 'v1', displayName: 'Studio', fingerprint: 'ab'.repeat(32), pairingRequired: true,
  }), { baseUrl: 'https://desktop-1.local:48123', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32), displayName: 'Studio', pairingRequired: true });
  assert.throws(() => parseDiscoveryAdvertisement({ service: '_prismata._tcp', port: 48123, instanceId: 'desktop-1', protocol: 'v1', displayName: '', fingerprint: 'not-a-fingerprint', pairingRequired: true }));
});

test('manual endpoint fallback accepts only a strict HTTP(S) endpoint', () => {
  assert.deepEqual(parseManualDesktopEndpoint('https://192.168.1.20:48123'), { baseUrl: 'https://192.168.1.20:48123' });
  assert.throws(() => parseManualDesktopEndpoint('file:///tmp/prismata'));
  assert.throws(() => parseManualDesktopEndpoint('http://desktop.local'));
});

test('consumes only the Prismata mDNS service and its allowlisted TXT fields', () => {
  assert.deepEqual(parseMdnsService({ type: 'prismata', protocol: 'tcp', host: 'desktop.local', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required', secret: 'ignored' } }), { baseUrl: 'https://desktop.local:48123', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32), displayName: 'Studio', pairingRequired: true });
  assert.throws(() => parseMdnsService({ type: 'other', protocol: 'tcp', port: 48123, txt: {} }));
});

test('formats discovered IPv6 hosts without falling back to the QR endpoint', () => {
  assert.equal(parseMdnsService({ type: 'prismata', protocol: 'tcp', host: 'fe80::1234', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }).baseUrl, 'https://[fe80::1234]:48123');
  assert.equal(parseMdnsService({ type: 'prismata', protocol: 'tcp', host: '[fe80::1234]', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }).baseUrl, 'https://[fe80::1234]:48123');
  assert.equal(parseMdnsService({ type: 'prismata', protocol: 'tcp', host: 'fe80::1234%wlan0', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }).baseUrl, 'https://[fe80::1234%25wlan0]:48123');
  assert.equal(parseMdnsService({ type: 'prismata', protocol: 'tcp', host: 'fe80::1234%25wlan0', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }).baseUrl, 'https://[fe80::1234%25wlan0]:48123');
  assert.equal(parseMdnsService({ type: 'prismata', protocol: 'tcp', host: '[fe80::1234%25wlan0]', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }).baseUrl, 'https://[fe80::1234%25wlan0]:48123');
  assert.throws(() => parseMdnsService({ type: 'prismata', protocol: 'tcp', host: 'fe80::1234%', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }));
  assert.throws(() => parseMdnsService({ type: 'prismata', protocol: 'tcp', host: 'fe80::1234%25', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }));
  assert.throws(() => parseMdnsService({ type: 'prismata', protocol: 'tcp', host: 'fe80::1234%25wlan0%25bad', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }));
  assert.throws(() => parseMdnsService({ type: 'prismata', protocol: 'tcp', host: 'studio%wlan0.local', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }));
  assert.throws(() => parseMdnsService({ type: 'other', protocol: 'tcp', host: 'fe80::1234', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }));
});

test('accepts an unauthenticated HTTP advertisement only when manual identity verification is explicit', () => {
  assert.deepEqual(parseMdnsService({ type: 'prismata', protocol: 'tcp', host: '192.168.1.20', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: '', pairing: 'required', verify: 'manual' } }), { baseUrl: 'https://192.168.1.20:48123', instanceId: 'desktop-1', fingerprint: '', displayName: 'Studio', pairingRequired: true, manualIdentityVerificationRequired: true });
  assert.throws(() => parseMdnsService({ type: 'prismata', protocol: 'tcp', host: '192.168.1.20', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: '', pairing: 'required' } }));
});

test('native mDNS adapter resolves only Prismata services and preserves injectable fallback', async () => {
  const events: string[] = [];
  const zeroconf = {
    on(event: string, listener: (service: unknown) => void) { events.push(event); this.listener = listener; return this; },
    listener: (_service: unknown) => {},
    scan(type: string, protocol: string, domain: string) { events.push(`${type}/${protocol}/${domain}`); queueMicrotask(() => this.listener({ type: 'prismata', protocol: 'tcp', host: 'studio.local', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } })); },
    stop() { events.push('stop'); },
  };
  const adapter = createMdnsDiscoveryAdapter({ zeroconf: zeroconf as never, timeoutMs: 5 });
  assert.deepEqual(await adapter.discover(), [{ baseUrl: 'https://studio.local:48123', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32), displayName: 'Studio', pairingRequired: true }]);
  assert.deepEqual(events, ['resolved', 'prismata/tcp/local.', 'stop']);
  assert.equal(createMdnsDiscoveryAdapter({ nativeAvailable: false }).available, false);
});

test('Android NSD-shaped discovery remains injectable and uses the same strict parser', async () => {
  const adapter = createMdnsDiscoveryAdapter({ nsd: {
    discover: async () => [{ type: 'prismata', protocol: 'tcp', host: 'studio.local', port: 48123, txt: { v: '1', instance: 'desktop-1', display: 'Studio', fingerprint: 'ab'.repeat(32), pairing: 'required' } }],
  } });
  assert.deepEqual(await adapter.discover(), [{ baseUrl: 'https://studio.local:48123', instanceId: 'desktop-1', fingerprint: 'ab'.repeat(32), displayName: 'Studio', pairingRequired: true }]);
});
