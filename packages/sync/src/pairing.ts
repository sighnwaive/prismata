export type PairingPayload = {
  version: 1;
  endpoint: string;
  challenge: string;
  expiresAt: string;
  instanceId: string;
  fingerprint: string;
};

export const CONFIRMATION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CONFIRMATION_CODE_LENGTH = 6;

export type ConnectionRequestStatus = 'pending' | 'approved' | 'expired' | 'rejected' | 'consumed';
export type ConnectionRequest = { requestId: string; deviceId: string; deviceName: string; instanceId: string; status: ConnectionRequestStatus; requestProof?: string; code?: string; expiresAt: string };

export function isConfirmationCode(value: string): boolean {
  return value.length === CONFIRMATION_CODE_LENGTH && [...value].every((character) => CONFIRMATION_CODE_ALPHABET.includes(character));
}

export function parsePairingPayload(encoded: string): PairingPayload {
  const value = encoded.trim();
  const prefix = 'prismata://pair?';
  if (!value.startsWith(prefix)) throw new Error('unsupported pairing payload');
  const searchParams = new URLSearchParams(value.slice(prefix.length));
  if (searchParams.get('v') !== '1') throw new Error('unsupported pairing payload');
  const payload: PairingPayload = {
    version: 1,
    endpoint: searchParams.get('endpoint') ?? '',
    challenge: searchParams.get('challenge') ?? '',
    expiresAt: searchParams.get('expiresAt') ?? '',
    instanceId: searchParams.get('instanceId') ?? '',
    fingerprint: searchParams.get('fingerprint') ?? '',
  };
  if (!isHttpsEndpoint(payload.endpoint) || !payload.challenge || !payload.instanceId || !Number.isFinite(Date.parse(payload.expiresAt)) || !/^[a-f0-9]{64}$/i.test(payload.fingerprint)) throw new Error('invalid pairing payload');
  return payload;
}

export function isHttpsEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0];
    const explicitPort = /^\[[^\]]+\]:\d+$/.test(authority) || /^[^:]+:\d+$/.test(authority);
    return url.protocol === 'https:' && Boolean(url.hostname) && explicitPort && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}
