import { createDesktopTransport, parseMdnsService, parseManualDesktopEndpoint, parsePairingPayload, type ConnectionRequest, type DesktopEndpoint, type PairedDeviceSession, type PairingPayload, type PinnedRequest } from '@prismata/sync';
import { createNativeMobileSecureStorage, type MobileSecureStorage } from './mobile-secure-storage';
import { createNativePinnedRequest } from './certificate-pin';
import { createMdnsDiscoveryAdapter } from './mdns-discovery';

const sessionKey = 'prismata.mobile.desktop-session';
const identityKey = 'prismata.mobile.device-identity';
type StoredPairing = { endpoint: DesktopEndpoint; session: PairedDeviceSession };
type DeviceIdentity = { deviceId: string; publicKey: string };
export function createMobileDesktopRuntime(input: { storage: MobileSecureStorage; endpoint?: DesktopEndpoint; fetchImpl?: typeof fetch; verifyCertificate?: (url: string, fingerprint: string) => void | Promise<void>; pinnedRequest?: PinnedRequest; identity?: () => Promise<DeviceIdentity>; discoverForPairing?: () => Promise<DesktopEndpoint[]> }) {
  if ((input.fetchImpl || input.verifyCertificate) && !input.pinnedRequest) throw new Error('mobile transport requires a same-connection pinned request');
  const pinnedRequest = input.pinnedRequest ?? createNativePinnedRequest();
  const discoverForPairing = input.discoverForPairing ?? createMdnsDiscoveryAdapter().discover;
  let session: PairedDeviceSession | null = null;
  let connectionRequest: ConnectionRequest | null = null;
  const identity = input.identity ?? (async () => {
    const stored = await input.storage.get(identityKey);
    if (stored) return JSON.parse(stored) as DeviceIdentity;
    const random = globalThis.crypto?.getRandomValues;
    if (!random) throw new Error('secure device identity unavailable');
    const bytes = random(new Uint8Array(32));
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const generated = { deviceId: `mobile-${value.slice(0, 24)}`, publicKey: value };
    await input.storage.set(identityKey, JSON.stringify(generated));
    return generated;
  });
  const save = async () => session && input.endpoint ? input.storage.set(sessionKey, JSON.stringify({ endpoint: input.endpoint, session } satisfies StoredPairing)) : input.storage.remove(sessionKey);
  return {
    getSession: () => session,
    getConnectionRequest: () => connectionRequest,
    async restoreSession() {
      const saved = await input.storage.get(sessionKey);
      if (!saved) return session = null;
      const parsed = JSON.parse(saved) as StoredPairing;
      input.endpoint = parsed.endpoint;
      return session = parsed.session;
    },
    setPairing(endpoint: DesktopEndpoint, paired: PairedDeviceSession) { input.endpoint = endpoint; session = paired; return save(); },
    discover(advertisements: Iterable<unknown>) {
      const seen = new Set<string>();
      return Array.from(advertisements).flatMap((advertisement) => {
        try {
          const endpoint = parseMdnsService(advertisement);
          if (!endpoint.instanceId || seen.has(endpoint.instanceId)) return [];
          seen.add(endpoint.instanceId);
          return [endpoint];
        } catch { return []; }
      });
    },
    async scanForDesktops() { return discoverForPairing(); },
    async requestConnection(endpoint: DesktopEndpoint, deviceName: string) {
      if (!endpoint.fingerprint) throw new Error('desktop fingerprint required before connection request');
      const transport = createDesktopTransport({ endpoint, pinnedRequest });
       const instance = await transport.instance();
       if (instance.pairingRequired !== true) throw new Error('desktop pairing is required');
      if (instance.protocol !== 'v1' || instance.instanceId !== endpoint.instanceId || instance.fingerprint.toLowerCase() !== endpoint.fingerprint.toLowerCase()) throw new Error('desktop identity does not match discovery advertisement');
      const device = await identity();
       const created = await transport.createConnectionRequest({ deviceId: device.deviceId, publicKey: device.publicKey, deviceName: deviceName.trim() });
       connectionRequest = await transport.getConnectionRequest(created.requestId, created.requestProof);
      input.endpoint = endpoint;
      return connectionRequest;
    },
    async refreshConnectionRequest() {
      if (!input.endpoint || !connectionRequest) throw new Error('connection request required');
       connectionRequest = await createDesktopTransport({ endpoint: input.endpoint, pinnedRequest }).getConnectionRequest(connectionRequest.requestId, connectionRequest.requestProof);
      return connectionRequest;
    },
    async completeApprovedConnection() {
      if (!input.endpoint || !connectionRequest || connectionRequest.status !== 'approved') throw new Error('desktop approval required');
       const paired = await createDesktopTransport({ endpoint: input.endpoint, pinnedRequest }).issueConnectionSession(connectionRequest.requestId, connectionRequest.requestProof);
      session = { deviceId: paired.deviceId, accessToken: paired.accessToken, instanceId: paired.instanceId };
      connectionRequest = { ...connectionRequest, status: 'consumed' };
      await save();
      return { endpoint: input.endpoint, session };
    },
    setManualEndpoint(value: string) { input.endpoint = parseManualDesktopEndpoint(value); return input.endpoint; },
    parsePairingPayload,
    async startPairing(endpoint: DesktopEndpoint = input.endpoint ?? (() => { throw new Error('desktop endpoint required'); })()) {
      if (!endpoint.fingerprint) throw new Error('desktop fingerprint required before pairing');
      return createDesktopTransport({ endpoint, pinnedRequest }).startPairing();
    },
    async completePairing(payload: PairingPayload, options: { deviceName: string; confirmFingerprint: boolean; endpoint?: DesktopEndpoint }) {
      if (!options.confirmFingerprint) throw new Error('fingerprint confirmation required');
      if (Date.parse(payload.expiresAt) <= Date.now()) throw new Error('pairing challenge expired');
      const endpoint = options.endpoint ?? (await discoverForPairing()).find((candidate) => candidate.instanceId === payload.instanceId && candidate.fingerprint?.toLowerCase() === payload.fingerprint.toLowerCase());
      if (!endpoint) throw new Error('no matching discovered desktop found; verify the desktop is on the local network and try again');
      endpoint.instanceId = payload.instanceId;
      endpoint.fingerprint = payload.fingerprint;
      if (!options.deviceName.trim()) throw new Error('device name required');
      const transport = createDesktopTransport({ endpoint, pinnedRequest });
       const instance = await transport.instance();
       if (instance.pairingRequired !== true) throw new Error('desktop pairing is required');
      if (instance.protocol !== 'v1' || instance.instanceId !== payload.instanceId || instance.fingerprint.toLowerCase() !== payload.fingerprint.toLowerCase()) throw new Error('desktop identity does not match pairing payload');
      const deviceIdentity = await identity();
       const paired = await transport.completePairing({ challenge: payload.challenge, deviceId: deviceIdentity.deviceId, publicKey: deviceIdentity.publicKey, deviceName: options.deviceName.trim() });
      session = { deviceId: paired.deviceId, accessToken: paired.accessToken, instanceId: paired.instanceId };
      input.endpoint = endpoint;
      await save();
      return { endpoint, session };
    },
    async clearPairing() { session = null; await save(); },
    async pullSettings() { if (!input.endpoint || !session) throw new Error('desktop pairing required'); return createDesktopTransport({ endpoint: input.endpoint, session, pinnedRequest }).getSettings(); },
    async pushSettings(settings: Record<string, unknown>, baseRevision?: number) { if (!input.endpoint || !session) throw new Error('desktop pairing required'); return createDesktopTransport({ endpoint: input.endpoint, session, pinnedRequest }).putSettings(settings, baseRevision); },
  };
}
export const mobileDesktopRuntime = createMobileDesktopRuntime({ storage: createNativeMobileSecureStorage() });
