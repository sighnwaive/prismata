// Legacy QR/deep-link support for older clients only; the active pairing flow is connection requests.
import QRCode from 'qrcode';
import { isHttpsEndpoint, parsePairingPayload as parseSharedPairingPayload } from '@prismata/sync';

export type PairingPayloadInput = { endpoint: string; challenge: string; expiresAt: string; instanceId: string; fingerprint: string };
export type PairingPayload = PairingPayloadInput & { version: 1; encoded: string; qrDataUrl: string };

export async function createPairingPayload(input: PairingPayloadInput): Promise<PairingPayload> {
  validateInput(input);
  const encoded = encodePairingPayload(input);
  return { ...input, version: 1, encoded, qrDataUrl: await QRCode.toDataURL(encoded, { errorCorrectionLevel: 'M', margin: 2, width: 280 }) };
}

export function encodePairingPayload(input: PairingPayloadInput): string {
  validateInput(input);
  const query = new URLSearchParams({ v: '1', endpoint: input.endpoint, challenge: input.challenge, expiresAt: input.expiresAt, instanceId: input.instanceId, fingerprint: input.fingerprint });
  return `prismata://pair?${query.toString()}`;
}

export function parsePairingPayload(encoded: string): PairingPayloadInput & { version: 1 } {
  return parseSharedPairingPayload(encoded);
}

function validateInput(input: PairingPayloadInput) {
  if (!isHttpsEndpoint(input.endpoint) || !input.challenge || !input.instanceId || !Number.isFinite(Date.parse(input.expiresAt)) || !/^[a-f0-9]{64}$/i.test(input.fingerprint)) throw new Error('invalid pairing payload');
}
