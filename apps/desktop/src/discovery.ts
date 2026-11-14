import Bonjour from 'bonjour-service';
import { isReachableAddress } from './ip-address.js';

export type DiscoveryRecord = {
  service: '_prismata._tcp';
  host: string;
  port: number;
  instanceId: string;
  protocol: 'v1';
  displayName: string;
  fingerprint: string;
  pairingRequired: boolean;
  manualIdentityVerificationRequired?: boolean;
};
export type DiscoveryAdapter = { start: (record: Omit<DiscoveryRecord, 'service' | 'protocol'>) => Promise<void>; stop: () => Promise<void> };
export function createDiscoveryAdapter(adapter: { advertise: (record: DiscoveryRecord) => Promise<void>; unadvertise: () => Promise<void> }): DiscoveryAdapter {
  return { start: async (record) => { if (!isAdvertisableHost(record.host)) throw new Error('discovery host must be reachable, not a wildcard or loopback'); await adapter.advertise({ ...record, service: '_prismata._tcp', protocol: 'v1' }); }, stop: adapter.unadvertise };
}

function isAdvertisableHost(host: string) { return isReachableAddress(host); }

type BonjourProvider = {
  publish: (options: { name: string; host: string; type: string; protocol: 'tcp'; port: number; txt: Record<string, string> }) => { stop: (callback?: () => void) => void };
  destroy: (callback?: () => void) => void | Promise<void>;
};

export function createMdnsDiscoveryAdapter(options: { createBonjour?: () => BonjourProvider } = {}): DiscoveryAdapter {
  let provider: BonjourProvider | undefined;
  let service: ReturnType<BonjourProvider['publish']> | undefined;
  let teardown = Promise.resolve();
  const unadvertise = async () => {
    teardown = teardown.then(async () => {
      const currentService = service;
      const currentProvider = provider;
      try {
        if (currentService) await new Promise<void>((resolve) => currentService.stop(resolve));
      } finally {
        service = undefined;
        provider = undefined;
        if (currentProvider) await destroyProvider(currentProvider);
      }
    }).finally(() => {
      // A failed teardown must not poison the queue or leave stale handles looking active.
      teardown = Promise.resolve();
    });
    await teardown;
  };
  return createDiscoveryAdapter({
    async advertise(record) {
      await teardown;
      provider ??= options.createBonjour?.() ?? new Bonjour() as unknown as BonjourProvider;
      try {
        service = provider.publish({
          name: record.displayName,
          host: record.host,
          type: 'prismata',
          protocol: 'tcp',
          port: record.port,
          txt: { v: record.protocol.slice(1), instance: record.instanceId, display: record.displayName, fingerprint: record.fingerprint, pairing: record.pairingRequired ? 'required' : 'optional', ...(record.manualIdentityVerificationRequired ? { verify: 'manual' } : {}) },
        });
        const published = service as typeof service & { once?: (event: string, listener: () => void) => void; on?: (event: string, listener: () => void) => void };
        if (published.once || published.on) await new Promise<void>((resolve, reject) => {
          const listen = published.once ?? published.on!;
          listen.call(published, 'up', resolve);
          listen.call(published, 'error', () => reject(new Error('mDNS publication failed')));
        });
      } catch (error) {
        await unadvertise();
        throw error;
      }
     },
     unadvertise,
  });
}

async function destroyProvider(provider: BonjourProvider) {
  let resolveCallback!: () => void;
  const callback = new Promise<void>((resolve) => { resolveCallback = resolve; });
  const result = provider.destroy(resolveCallback);
  if (result && typeof (result as Promise<void>).then === 'function') await result;
  else if (provider.destroy.length > 0) await callback;
}
