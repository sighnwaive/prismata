export type JoystickTrafficDiagnostic = (event: unknown) => unknown;

const REDACTED = '[REDACTED]';
const OMITTED = '[OMITTED]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return /(?:access|refresh|id|oauth)?token/.test(normalized)
    || /(?:client)?secret/.test(normalized)
    || /^(?:api|private)key$/.test(normalized)
    || /authorization|credential|password/.test(normalized)
    || /^(?:code|oauthcode|authcode|state|oauthstate|verifier|codeverifier|pkceverifier)$/.test(normalized);
}

function isHeadersKey(key: string): boolean {
  return /^(?:request|response)?headers?$/.test(normalizeKey(key));
}

function sensitiveQueryKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return /(?:access|refresh|id|bearer|oauth)?token/.test(normalized)
    || /secret|authorization|credential|password|signature|session|^auth$/.test(normalized)
    || /^(?:api|private)key$/.test(normalized)
    || /^(?:codechallenge|pkcechallenge)$/.test(normalized)
    || /^(?:code|oauthcode|authcode|state|oauthstate|verifier|codeverifier|pkceverifier)$/.test(normalized);
}

function redactUrl(value: string): string {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveQueryKey(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    return OMITTED;
  }
}

function redactValue(value: unknown, key = '', seen = new WeakSet<object>(), depth = 0): unknown {
  if (isHeadersKey(key)) {
    if (Array.isArray(value)) return value.map((item) => Array.isArray(item) ? [item[0], REDACTED] : REDACTED);
    if (isRecord(value)) return Object.fromEntries(Object.keys(value).map((headerName) => [headerName, REDACTED]));
    return REDACTED;
  }
  if (sensitiveKey(key)) return REDACTED;
  if (typeof value === 'string') {
    const urlsRedacted = value.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, (url) => redactUrl(url));
    return redactUrl(urlsRedacted);
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth > 30) return OMITTED;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => redactValue(item, '', seen, depth + 1));
    seen.delete(value);
    return result;
  }
  if (!isRecord(value)) return OMITTED;
  const result = Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    redactValue(childValue, childKey, seen, depth + 1),
  ]));
  seen.delete(value);
  return result;
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== 'string') return redactValue(value);
  if (!value) return undefined;
  try {
    return redactValue(JSON.parse(value) as unknown);
  } catch {
    if (value.includes('=')) {
      try {
        return redactValue(Object.fromEntries(new URLSearchParams(value).entries()));
      } catch { /* Fall through to omission for opaque payloads. */ }
    }
    // Unstructured payloads can contain credentials without field names.
    // Keep console diagnostics useful without copying opaque body text.
    return OMITTED;
  }
}

function headerNamesAndRedactedValues(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  try {
    if (headers instanceof Headers) return Object.fromEntries([...headers.keys()].map((name) => [name, REDACTED]));
    if (Array.isArray(headers)) return Object.fromEntries(headers.map(([name]) => [name, REDACTED]));
    return Object.fromEntries(Object.keys(headers).map((name) => [name, REDACTED]));
  } catch {
    return { headers: REDACTED };
  }
}

function report(onDiagnostic: JoystickTrafficDiagnostic | undefined, event: unknown): void {
  if (!onDiagnostic) return;
  try {
    const result = onDiagnostic(redactValue(event));
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => {});
    }
  } catch {
    // Diagnostics are best-effort and must never affect Joystick traffic.
  }
}

export async function fetchWithJoystickDiagnostics(
  fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>,
  input: string | URL,
  init: RequestInit | undefined,
  onDiagnostic?: JoystickTrafficDiagnostic,
): Promise<Response> {
  const endpoint = redactUrl(String(input));
  const method = String(init?.method ?? 'GET').toUpperCase();
  const request = {
    headers: headerNamesAndRedactedValues(init?.headers),
    payload: parsePayload(init?.body),
  };
  report(onDiagnostic, { direction: 'outbound', transport: 'http', method, endpoint, request });

  let response: Response;
  try {
    response = await fetchImpl(input, init);
  } catch (error) {
    report(onDiagnostic, { direction: 'inbound', transport: 'http', method, endpoint, outcome: 'transport_error' });
    throw error;
  }

  let payload: unknown;
  try {
    payload = parsePayload(await response.clone().text());
  } catch {
    payload = OMITTED;
  }
  report(onDiagnostic, {
    direction: 'inbound',
    transport: 'http',
    method,
    endpoint,
    status: response.status,
    headers: headerNamesAndRedactedValues(response.headers),
    response: payload,
  });
  return response;
}

export function diagnoseJoystickTraffic(onDiagnostic: JoystickTrafficDiagnostic | undefined, event: unknown): void {
  report(onDiagnostic, event);
}
