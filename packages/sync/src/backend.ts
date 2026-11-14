export type BackendRuntime = {
  backendUrl: string;
  fetchImpl?: typeof fetch;
  request: <ResponseBody>(pathname: string, init?: RequestInit) => Promise<ResponseBody>;
};

export type BackendSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt: string;
  state: 'anonymous' | 'authenticated';
  userId: string;
  grantedPermissions?: string[];
};

export type BackendSessionResponse = { session: BackendSession };

export type BackendSettingsResponse = {
  settings: Record<string, unknown>;
  updatedAt: string;
  version: number;
};

export type BackendSettingsPush = {
  settings: Record<string, unknown>;
  version?: number;
  updatedAt?: string;
};

export type UpsertBackendDeviceSelfRequest = {
  appInstanceId: string;
  deviceId: string;
  deviceName: string;
  platform: 'desktop' | 'mobile';
};

export type UpsertBackendDeviceSelfResponse = UpsertBackendDeviceSelfRequest & { lastSeenAt: string };

export type BackendAnonymousSession = BackendSession & { state: 'anonymous' };
export type BackendAnonymousSessionResponse = { session: BackendAnonymousSession };
export type BootstrapBackendAnonymousSessionResult = {
  device: UpsertBackendDeviceSelfResponse;
  session: BackendAnonymousSession;
  sessionCookie: string;
};

export type AuthenticatedRequest = (pathname: string, init?: RequestInit) => Promise<Response>;

export function createBackendRuntime(input: { backendUrl: string; fetchImpl?: typeof fetch }): BackendRuntime {
  const backendUrl = new URL(input.backendUrl).toString().replace(/\/$/, '');
  const runtime: BackendRuntime = {
    backendUrl,
    fetchImpl: input.fetchImpl,
    request: async <ResponseBody>(pathname: string, init: RequestInit = {}) => {
      const response = await getFetchImpl(input.fetchImpl)(joinBackendUrl(backendUrl, pathname), init);
      if (!response.ok) throw new Error(`Backend request failed with status ${response.status}`);
      if (response.status === 204) return undefined as ResponseBody;
      return await response.json() as ResponseBody;
    },
  };
  return runtime;
}

export function createAuthenticatedRequest(
  runtime: BackendRuntime,
  getSession: () => BackendSession | null,
): AuthenticatedRequest {
  return async (pathname, init = {}) => {
    const session = getSession();
    if (!session) throw new Error('authenticated backend session required');
    const headers = new Headers(init.headers);
    if (session.accessToken) headers.set('authorization', `Bearer ${session.accessToken}`);
    const response = await getFetchImpl(runtime.fetchImpl)(joinBackendUrl(runtime.backendUrl, pathname), { ...init, headers });
    if (!response.ok) throw new Error(`Backend request failed with status ${response.status}`);
    return response;
  };
}

export async function getBackendSettings(input: {
  backendUrl: string;
  sessionCookie?: string;
  accessToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<BackendSettingsResponse> {
  return requestBackendJson(input, '/sync/settings', { headers: authenticatedHeaders(input) });
}

export async function pullSettings(request: AuthenticatedRequest): Promise<BackendSettingsResponse> {
  const response = await request('/sync/settings');
  return readJson<BackendSettingsResponse>(response);
}

export async function pushSettings(
  request: AuthenticatedRequest,
  payload: BackendSettingsPush,
): Promise<BackendSettingsResponse> {
  const response = await request('/sync/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJson<BackendSettingsResponse>(response);
}

export async function pushBackendSettings(input: {
  backendUrl: string;
  sessionCookie?: string;
  accessToken?: string;
  settings: BackendSettingsPush;
  fetchImpl?: typeof fetch;
}): Promise<BackendSettingsResponse> {
  return requestBackendJson(input, '/sync/settings', {
    method: 'PUT',
    headers: { ...authenticatedHeaders(input), 'content-type': 'application/json' },
    body: JSON.stringify(input.settings),
  });
}

export async function upsertBackendDeviceSelf(input: {
  backendUrl: string;
  sessionCookie?: string;
  accessToken?: string;
  device: UpsertBackendDeviceSelfRequest;
  fetchImpl?: typeof fetch;
}): Promise<UpsertBackendDeviceSelfResponse> {
  return requestBackendJson(input, '/sync/devices/self', {
    method: 'PUT',
    headers: { ...authenticatedHeaders(input), 'content-type': 'application/json' },
    body: JSON.stringify(input.device),
  });
}

export async function registerBackendDevice(
  request: AuthenticatedRequest,
  device: UpsertBackendDeviceSelfRequest,
): Promise<UpsertBackendDeviceSelfResponse> {
  const response = await request('/sync/devices/self', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(device),
  });
  return readJson<UpsertBackendDeviceSelfResponse>(response);
}

/** Migration-only compatibility. New clients must authenticate before registering devices. */
export async function bootstrapBackendAnonymousSession(input: {
  backendUrl: string;
  device: UpsertBackendDeviceSelfRequest;
  fetchImpl?: typeof fetch;
}): Promise<BootstrapBackendAnonymousSessionResult> {
  const response = await getFetchImpl(input.fetchImpl)(joinBackendUrl(input.backendUrl, '/auth/sessions/anonymous'), { method: 'POST' });
  if (!response.ok) throw new Error(`Backend anonymous session bootstrap failed with status ${response.status}`);
  const sessionCookie = getSessionCookie(response.headers);
  if (!sessionCookie) throw new Error('Backend anonymous session bootstrap did not return a prismata_session cookie');
  const body = await readJson<BackendAnonymousSessionResponse>(response);
  const device = await upsertBackendDeviceSelf({ ...input, sessionCookie });
  return { device, session: body.session, sessionCookie };
}

async function requestBackendJson<ResponseBody>(
  input: { backendUrl: string; fetchImpl?: typeof fetch },
  pathname: string,
  init: RequestInit,
): Promise<ResponseBody> {
  const response = await getFetchImpl(input.fetchImpl)(joinBackendUrl(input.backendUrl, pathname), init);
  if (!response.ok) throw new Error(`Backend request failed with status ${response.status}`);
  return readJson<ResponseBody>(response);
}

function authenticatedHeaders(input: { sessionCookie?: string; accessToken?: string }): Record<string, string> {
  if (input.accessToken) return { authorization: `Bearer ${input.accessToken}` };
  if (input.sessionCookie) return { cookie: input.sessionCookie };
  throw new Error('authenticated backend session required');
}

function readJson<ResponseBody>(response: Response): Promise<ResponseBody> {
  return response.json() as Promise<ResponseBody>;
}

function getFetchImpl(fetchImpl?: typeof fetch): typeof fetch {
  const resolvedFetch = fetchImpl ?? globalThis.fetch;
  if (!resolvedFetch) throw new Error('fetch is required for backend sync requests');
  return resolvedFetch;
}

function joinBackendUrl(backendUrl: string, pathname: string): URL {
  const url = new URL(backendUrl);
  const [path, search = ''] = pathname.split('?', 2);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`;
  url.search = search ? `?${search}` : '';
  return url;
}

function getSessionCookie(headers: Headers): string | null {
  const maybeHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof maybeHeaders.getSetCookie === 'function' ? maybeHeaders.getSetCookie() : [headers.get('set-cookie') ?? ''];
  const cookie = values.find((value) => value.startsWith('prismata_session='));
  return cookie ? cookie.split(';', 1)[0] ?? null : null;
}
