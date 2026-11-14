import { isHttpsEndpoint, type ConnectionRequest } from './pairing';
export { parsePairingPayload } from './pairing';
export type DesktopEndpoint = { baseUrl: string; instanceId?: string; fingerprint?: string; displayName?: string; pairingRequired?: boolean; manualIdentityVerificationRequired?: boolean };
export type DiscoveryAdvertisement = { service: '_prismata._tcp'; port: number; instanceId: string; protocol: 'v1'; displayName: string; fingerprint: string; pairingRequired: boolean; host?: string; manualIdentityVerificationRequired?: boolean };
export type PairedDeviceSession = { deviceId: string; accessToken: string; instanceId: string };
export type DesktopSettings = { settings: Record<string, unknown>; revision: number; updatedAt: string; origin: string };
export type PairingCompletion = { challenge: string; deviceId: string; publicKey: string; deviceName: string };
export type PinnedResponse = { status: number; body: string };
export type PinnedRequest = (url: string, fingerprint: string, init: RequestInit) => Promise<PinnedResponse>;
export type ConnectionRequestInput = { deviceId: string; publicKey: string; deviceName: string };

export function parseDiscoveryAdvertisement(value: unknown): DesktopEndpoint {
  if (!value || typeof value !== 'object') throw new Error('invalid discovery advertisement');
  const record = value as Partial<DiscoveryAdvertisement>;
  if (record.service !== '_prismata._tcp' || record.protocol !== 'v1' || !Number.isInteger(record.port) || record.port! < 1 || record.port! > 65535 || !isNonEmptyString(record.instanceId) || !isNonEmptyString(record.displayName) || (!isFingerprint(record.fingerprint) && !(record.manualIdentityVerificationRequired === true && record.fingerprint === '')) || typeof record.pairingRequired !== 'boolean') throw new Error('invalid discovery advertisement');
  const host = record.host ?? `${record.instanceId}.local`;
  const urlHost = formatHost(host);
  return { baseUrl: `https://${urlHost}:${record.port}`, instanceId: record.instanceId, fingerprint: record.fingerprint, displayName: record.displayName, pairingRequired: record.pairingRequired, ...(record.manualIdentityVerificationRequired ? { manualIdentityVerificationRequired: true } : {}) };
}

export function parseMdnsService(value: unknown): DesktopEndpoint {
  if (!value || typeof value !== 'object') throw new Error('invalid mDNS service');
  const service = value as { type?: unknown; protocol?: unknown; port?: unknown; host?: unknown; txt?: Record<string, unknown>; name?: unknown };
  const txt = service.txt;
  if (service.type !== 'prismata' || service.protocol !== 'tcp' || !txt || typeof txt !== 'object' || !['required', 'optional'].includes(String(txt.pairing))) throw new Error('invalid mDNS service');
  return parseDiscoveryAdvertisement({ service: '_prismata._tcp', port: service.port, instanceId: txt.instance, protocol: `v${txt.v}`, displayName: txt.display, fingerprint: txt.fingerprint, pairingRequired: txt.pairing === 'required', manualIdentityVerificationRequired: txt.verify === 'manual', host: service.host });
}

export function parseManualDesktopEndpoint(value: string): DesktopEndpoint {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('invalid desktop endpoint'); }
  if (!isHttpsEndpoint(value)) throw new Error('invalid desktop endpoint');
  return { baseUrl: url.toString().replace(/\/$/, '') };
}

function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128; }
function isFingerprint(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
function formatHost(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) throw new Error('invalid discovery advertisement');
  if (value.startsWith('[') || value.endsWith(']')) {
    if (!value.startsWith('[') || !value.endsWith(']') || !isIpv6(value.slice(1, -1))) throw new Error('invalid discovery advertisement');
    return `[${formatIpv6(value.slice(1, -1))}]`;
  }
  if (value.includes(':')) {
    if (!isIpv6(value)) throw new Error('invalid discovery advertisement');
    return `[${formatIpv6(value)}]`;
  }
  if (!/^[a-z0-9.-]+$/i.test(value)) throw new Error('invalid discovery advertisement');
  return value;
}
function isIpv6(value: string): boolean {
  const normalized = normalizeIpv6Scope(value);
  if (!normalized) return false;
  value = normalized.address;
  const groups = value.split('::');
  if (groups.length > 2 || !value.includes(':')) return false;
  const parts = groups.flatMap((side) => side ? side.split(':') : []);
  if (parts.some((part) => !/^[a-f0-9]{1,4}$/i.test(part))) return false;
  const count = parts.length;
  return groups.length === 2 ? count < 8 : count === 8;
}
function formatIpv6(value: string): string {
  const normalized = normalizeIpv6Scope(value);
  if (!normalized) throw new Error('invalid discovery advertisement');
  return normalized.scope ? `${normalized.address}%25${normalized.scope}` : normalized.address;
}
function normalizeIpv6Scope(value: string): { address: string; scope?: string } | undefined {
  const separator = value.indexOf('%');
  if (separator < 0) return { address: value };
  const scope = value.slice(separator + (value.slice(separator, separator + 3) === '%25' ? 3 : 1));
  if (value.indexOf('%', separator + 1) >= 0 || !/^[a-z0-9._~-]+$/i.test(scope)) return undefined;
  return { address: value.slice(0, separator), scope };
}

export function createDesktopTransport(input: { endpoint: DesktopEndpoint; session?: PairedDeviceSession; fetchImpl?: typeof fetch; verifyCertificate?: (url: string, fingerprint: string) => void | Promise<void>; pinnedRequest?: PinnedRequest }) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl && !input.pinnedRequest) throw new Error('fetch or pinned request is required for desktop transport');
  const baseUrl = normalizeDesktopBaseUrl(input.endpoint.baseUrl);
  if (!isFingerprint(input.endpoint.fingerprint)) throw new Error('desktop transport requires a certificate fingerprint');
  if (!input.verifyCertificate && !input.pinnedRequest) throw new Error('desktop transport requires a certificate pin verifier or pinned request');
  const request = async <T>(pathname: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (input.session) headers.set('authorization', `Bearer ${input.session.accessToken}`);
    const url = `${baseUrl}${pathname}`;
    if (input.pinnedRequest) {
      const response = await input.pinnedRequest(url, input.endpoint.fingerprint!, { ...init, headers, redirect: 'error' });
      if (response.status < 200 || response.status >= 300) throw new Error(`desktop request failed with status ${response.status}`);
      return response.status === 204 ? undefined as T : JSON.parse(response.body) as T;
    }
    await input.verifyCertificate!(url, input.endpoint.fingerprint!);
    const response = await fetchImpl!(url, { ...init, headers, redirect: 'error' });
    if (!response.ok) throw new Error(`desktop request failed with status ${response.status}`);
    return response.status === 204 ? undefined as T : await response.json() as T;
  };
  return {
    health: () => request<{ status: string; protocol: string }>('/api/v1/health'),
    instance: () => request<{ protocol: string; instanceId: string; fingerprint: string; pairingRequired: boolean }>('/api/v1/instance'),
    getSettings: () => request<DesktopSettings>('/api/v1/settings'),
    putSettings: (settings: Record<string, unknown>, baseRevision?: number) => request<DesktopSettings>('/api/v1/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings, baseRevision }) }),
    listDevices: () => request<{ devices: Array<{ deviceId: string; deviceName: string }> }>('/api/v1/devices'),
    heartbeat: () => request<{ deviceId: string; lastSeenAt: string }>('/api/v1/devices/heartbeat', { method: 'POST' }),
    refreshSession: (refreshToken: string) => request<{ accessToken: string; refreshToken: string }>('/api/v1/session/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) }),
    revokeSession: () => request<void>('/api/v1/session/revoke', { method: 'POST' }),
     startPairing: () => request<{ challenge: string; expiresAt: string; instanceId: string }>('/api/v1/pairing/start', { method: 'POST' }),
     completePairing: (pairing: PairingCompletion) => request<{ deviceId: string; accessToken: string; refreshToken: string; expiresAt: string; instanceId: string; fingerprint: string }>('/api/v1/pairing/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pairing) }),
     createConnectionRequest: async (connection: ConnectionRequestInput) => { const response = await request<ConnectionRequest & { code?: unknown }>('/api/v1/connection-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(connection) }); const { code: _code, ...safe } = response; return safe; },
      getConnectionRequest: (requestId: string, requestProof?: string) => request<ConnectionRequest>(`/api/v1/connection-requests/${encodeURIComponent(requestId)}`, requestProof ? { headers: { 'x-prismata-request-proof': requestProof } } : {}),
     approveConnectionRequest: (requestId: string, code: string) => request<ConnectionRequest>(`/api/v1/connection-requests/${encodeURIComponent(requestId)}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }),
     issueConnectionSession: (requestId: string, requestProof?: string) => request<{ deviceId: string; accessToken: string; refreshToken: string; expiresAt: string; instanceId: string; fingerprint: string }>(`/api/v1/connection-requests/${encodeURIComponent(requestId)}/session`, { method: 'POST', headers: requestProof ? { 'x-prismata-request-proof': requestProof } : {} }),
    listConnectionRequests: () => request<{ requests: ConnectionRequest[] }>('/api/v1/connection-requests'),
  };
}

function normalizeDesktopBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('desktop transport requires HTTPS');
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    const match = /^https:\/\/\[([^\]]+)\]:(\d+)\/?$/.exec(value);
    if (!match || !match[1].includes('%25') || !isIpv6(match[1]) || Number(match[2]) < 1 || Number(match[2]) > 65535) {
      throw error instanceof Error && error.message === 'desktop transport requires HTTPS' ? error : new Error('invalid desktop endpoint');
    }
    return value.replace(/\/$/, '');
  }
}
