import { isIP } from 'node:net';

export function isReachableAddress(address: string): boolean {
  if (typeof address !== 'string' || address.trim() !== address) return false;
  const bytes = parseAddress(address);
  if (!bytes) return false;
  if (bytes.every((byte) => byte === 0)) return false;
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return false;
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    const mapped = bytes.slice(12);
    if (mapped[0] === 127 || mapped.every((byte) => byte === 0)) return false;
  }
  if (bytes.length === 4 && bytes[0] === 127) return false;
  if (bytes.length === 4 && bytes[0] >= 224) return false;
  if (bytes.length === 16 && bytes[0] === 0xff) return false;
  return true;
}

function parseAddress(address: string): number[] | undefined {
  const unscoped = address.split('%', 1)[0];
  const version = isIP(unscoped);
  if (version === 4) {
    const octets = unscoped.split('.').map(Number);
    return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : undefined;
  }
  if (version !== 6) return undefined;
  const halves = unscoped.split('::');
  if (halves.length > 2) return undefined;
  const left = parseIpv6Half(halves[0]);
  const right = halves.length === 2 ? parseIpv6Half(halves[1]) : [];
  if (!left || !right || (halves.length === 1 && left.length !== 8) || (halves.length === 2 && left.length + right.length >= 8)) return undefined;
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right].flatMap((part) => [part >> 8, part & 0xff]);
}

function parseIpv6Half(value: string): number[] | undefined {
  if (!value) return [];
  const parts = value.split(':');
  const result: number[] = [];
  for (const part of parts) {
    if (part.includes('.')) {
      const octets = part.split('.').map(Number);
      if (octets.length !== 4 || !octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) return undefined;
      result.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
    } else if (/^[0-9a-f]{1,4}$/i.test(part)) result.push(Number.parseInt(part, 16));
    else return undefined;
  }
  return result;
}
