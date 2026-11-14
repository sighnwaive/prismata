import { NativeModules } from 'react-native';
import type { PinnedRequest } from '@prismata/sync';

type NativeCertificatePin = {
  request: (url: string, fingerprint: string, method: string, headers: Record<string, string>, body?: string) => Promise<{ status: number; body: string }>;
};

const unavailable = () => new Error('native certificate pin verifier unavailable');

export function createNativePinnedRequest(): PinnedRequest {
  return async (url, fingerprint, init) => {
    const request = (NativeModules as { PrismataCertificatePin?: NativeCertificatePin }).PrismataCertificatePin;
    if (!request?.request) throw unavailable();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    return request.request(url, fingerprint, init.method ?? 'GET', headers, typeof init.body === 'string' ? init.body : undefined);
  };
}
