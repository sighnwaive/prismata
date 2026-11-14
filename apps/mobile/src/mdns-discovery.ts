import { parseMdnsService, type DesktopEndpoint } from '@prismata/sync';

type ZeroconfLike = {
  on(event: string, listener: (service: unknown) => void): ZeroconfLike;
  scan(type: string, protocol: string, domain: string): void;
  stop(): void;
  removeListener?: (event: string, listener: (service: unknown) => void) => void;
};

type NsdLike = {
  discover(): Promise<unknown[]>;
  stop?: () => void;
};

export type MdnsDiscoveryAdapter = {
  available: boolean;
  discover(): Promise<DesktopEndpoint[]>;
};

export function createMdnsDiscoveryAdapter(input: { zeroconf?: ZeroconfLike; nsd?: NsdLike; nativeAvailable?: boolean; timeoutMs?: number } = {}): MdnsDiscoveryAdapter {
  const zeroconf = input.zeroconf;
  const nsd = !zeroconf && input.nativeAvailable !== false ? input.nsd ?? loadNsd() : undefined;
  return {
    available: Boolean(zeroconf ?? nsd),
    discover: async () => {
      if (nsd) return parseServices(await nsd.discover());
      if (!zeroconf) return [];
      const results = new Map<string, DesktopEndpoint>();
      const onResolved = (service: unknown) => {
        try {
          const endpoint = parseMdnsService(service);
          if (endpoint.instanceId) results.set(endpoint.instanceId, endpoint);
        } catch {
          // Ignore other services and malformed/stale advertisements.
        }
      };
      zeroconf.on('resolved', onResolved);
      zeroconf.scan('prismata', 'tcp', 'local.');
      await new Promise<void>((resolve) => setTimeout(resolve, input.timeoutMs ?? 1500));
      zeroconf.removeListener?.('resolved', onResolved);
      zeroconf.stop();
      return [...results.values()];
    },
  };
}

function parseServices(services: unknown[]): DesktopEndpoint[] {
  const results = new Map<string, DesktopEndpoint>();
  for (const service of services) {
    try {
      const endpoint = parseMdnsService(service);
      if (endpoint.instanceId) results.set(endpoint.instanceId, endpoint);
    } catch {
      // Ignore other services and malformed/stale advertisements.
    }
  }
  return [...results.values()];
}

function loadNsd(): NsdLike | undefined {
  try {
    const loaded = (eval('require') as (name: string) => { NativeModules?: { PrismataNsd?: NsdLike } })('react-native');
    return loaded.NativeModules?.PrismataNsd;
  } catch {
    return undefined;
  }
}
