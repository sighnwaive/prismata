import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import {
  diagnoseJoystickTraffic,
  fetchWithJoystickDiagnostics,
  type JoystickTrafficDiagnostic,
} from './joystick-traffic-diagnostics.js';

export const AUTHORIZE_ENDPOINT = 'https://joystick.tv/api/oauth/authorize';
export const TOKEN_ENDPOINT = 'https://api.joystick.tv/api/oauth/token';
export const PROFILE_ENDPOINT = 'https://api.joystick.tv/api/v1/me/identity';
export const JOYSTICK_REQUIRED_SCOPES = Object.freeze([
  'identity:read',
  'stream:read',
  'chat:read',
  'chat:write',
  'followers:read',
  'moderators:read',
  'subscribers:read',
  'chat:whisper:write',
]);
const JOYSTICK_KNOWN_PERMISSIONS = new Set<string>(JOYSTICK_REQUIRED_SCOPES);

export type JoystickIdentity = { id: string; login: string; displayName: string };
export type JoystickSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  identity: JoystickIdentity;
  grantedPermissions?: string[];
};

export type JoystickBackendSession = Omit<JoystickSession, 'expiresAt' | 'grantedPermissions'> & {
  expiresAt: string;
  grantedPermissions: string[];
  state: 'authenticated';
  userId: string;
  provider: 'joystick';
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function required(value: unknown, name: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

function configuredJoystickScopes(): readonly string[] {
  const configured = process.env.JOYSTICK_SCOPES?.trim();
  return configured ? configured.split(/\s+/) : JOYSTICK_REQUIRED_SCOPES;
}

export function createJoystickAuthorizeRequest({
  clientId,
  redirectUri,
  randomBytes = nodeRandomBytes,
  scopes = configuredJoystickScopes(),
  codeVerifier,
}: {
  clientId: string;
  redirectUri: string;
  randomBytes?: (size: number) => Buffer;
  scopes?: readonly string[];
  codeVerifier?: string;
}) {
  const verifier = codeVerifier ?? base64Url(randomBytes(32));
  const state = base64Url(randomBytes(24));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', required(clientId, 'clientId'));
  url.searchParams.set('redirect_uri', required(redirectUri, 'redirectUri'));
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '));
  return { authorizeUrl: url.toString(), state, codeVerifier: verifier, codeChallenge: challenge };
}

export function validateJoystickCallback(callbackUrl: string, expected: { state: string; redirectUri: string }) {
  const callback = new URL(callbackUrl);
  const redirect = new URL(expected.redirectUri);
  if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname || callback.hash) {
    throw new Error('invalid Joystick OAuth callback');
  }
  const state = required(callback.searchParams.get('state'), 'OAuth state');
  const code = required(callback.searchParams.get('code'), 'OAuth code');
  if (state !== required(expected.state, 'state')) throw new Error('invalid OAuth state');
  if (callback.searchParams.has('error')) throw new Error('Joystick authorization failed');
  return { code, state };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapJsonEnvelope(value: unknown): Record<string, unknown> {
  let current = value;
  while (isRecord(current) && isRecord(current.data)) current = current.data;
  if (!isRecord(current)) throw new Error('Joystick response was not a JSON object');
  return current;
}

async function jsonResponse(response: Response, context: string): Promise<Record<string, unknown>> {
  const body = unwrapJsonEnvelope(await response.json());
  if (!response.ok) throw new Error(`${context} failed with HTTP ${response.status}`);
  return body;
}

function fetchRequired(fetchImpl?: FetchLike): FetchLike {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (typeof resolved !== 'function') throw new TypeError('fetch is required for Joystick OAuth');
  return resolved as FetchLike;
}

export async function fetchJoystickGrantedPermissions({
  accessToken,
  fetch,
  onDiagnostic,
}: {
  accessToken: string;
  fetch?: FetchLike;
  onDiagnostic?: JoystickTrafficDiagnostic;
}): Promise<string[]> {
  const response = await fetchWithJoystickDiagnostics(fetchRequired(fetch), 'https://api.joystick.tv/api/v1/me', {
    method: 'GET',
    headers: { authorization: `Bearer ${required(accessToken, 'accessToken')}` },
  }, onDiagnostic);
  if (!response.ok) throw new Error(`Joystick permissions failed with HTTP ${response.status}`);

  let body: Record<string, unknown>;
  try {
    body = unwrapJsonEnvelope(await response.json());
  } catch {
    return [];
  }
  const permissions = body.permissions;
  if (!Array.isArray(permissions) || !permissions.every((permission: unknown) => (
    typeof permission === 'string' && permission.trim().length > 0
  ))) return [];
  return permissions as string[];
}

export function hasRequiredJoystickWhisperPermissions(grants: unknown): boolean {
  if (!Array.isArray(grants) || !grants.every((grant: unknown) => (
    typeof grant === 'string' && JOYSTICK_KNOWN_PERMISSIONS.has(grant)
  ))) return false;
  return grants.includes('stream:read') && grants.includes('chat:whisper:write');
}

export function normalizeJoystickProfile(profile: Record<string, unknown>): JoystickIdentity {
  const sources: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth: number) => {
    if (!isRecord(value) || depth > 2 || sources.includes(value)) return;
    sources.push(value);
    visit(value.data, depth + 1);
    visit(value.user, depth + 1);
  };
  visit(profile, 0);

  const valueFrom = (fields: string[]) => sources
    .flatMap((source) => fields.map((field) => source[field]))
    .map((value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '')
    .find(Boolean) ?? '';
  // Only account/user profile fields are identity sources. Installation
  // metadata such as channel, bot, and permissions must not become a user.
  const id = valueFrom([
    'channel_id', 'channelId', 'user_id', 'userId', 'id', 'uuid', 'account_id', 'accountId',
  ]);
  const login = valueFrom([
    'login', 'username', 'handle', 'user_name', 'userName', 'display_name',
    'displayName', 'name', 'screen_name', 'screenName',
  ]);
  const displayName = valueFrom(['display_name', 'displayName', 'nickname', 'name']) || login;
  if (!id || !login) {
    const paths = sources.map((source) => Object.keys(source)
      .filter((key) => !/token|secret/i.test(key))
      .join(','))
      .filter(Boolean)
      .join(' | ');
    throw new Error(`Joystick profile has no usable identity (shape: ${paths || 'empty'}). Configure profileEndpoint/JOYSTICK_PROFILE_ENDPOINT to an identity profile endpoint; permissions and capability metadata are not identity.`);
  }
  return { id, login, displayName };
}

async function fetchProfile(
  fetchImpl: FetchLike,
  accessToken: string,
  profileEndpoint: string,
  onDiagnostic?: JoystickTrafficDiagnostic,
): Promise<JoystickIdentity> {
  const response = await fetchWithJoystickDiagnostics(fetchImpl, profileEndpoint, {
    headers: { authorization: `Bearer ${required(accessToken, 'accessToken')}` },
  }, onDiagnostic);
  return normalizeJoystickProfile(await jsonResponse(response, 'Joystick profile'));
}

function tokenRequest(body: Record<string, string>): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() };
}

export async function exchangeJoystickCode({
  clientId,
  code,
  codeVerifier,
  redirectUri,
  fetch,
  profileEndpoint = process.env.JOYSTICK_PROFILE_ENDPOINT ?? PROFILE_ENDPOINT,
  now = Date.now,
  onDiagnostic,
}: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetch?: FetchLike;
  profileEndpoint?: string;
  now?: () => number;
  onDiagnostic?: JoystickTrafficDiagnostic;
}): Promise<JoystickSession> {
  const response = await fetchWithJoystickDiagnostics(fetchRequired(fetch), TOKEN_ENDPOINT, tokenRequest({
    grant_type: 'authorization_code',
    client_id: required(clientId, 'clientId'),
    code: required(code, 'code'),
    code_verifier: required(codeVerifier, 'codeVerifier'),
    redirect_uri: required(redirectUri, 'redirectUri'),
  }), onDiagnostic);
  const token = await jsonResponse(response, 'Joystick token exchange');
  const accessToken = required(token.access_token, 'Joystick access token');
  const refreshToken = required(token.refresh_token, 'Joystick refresh token');
  return {
    accessToken,
    refreshToken,
    expiresAt: now() + Number(token.expires_in ?? 0) * 1000,
    identity: await fetchProfile(fetchRequired(fetch), accessToken, required(profileEndpoint, 'profileEndpoint'), onDiagnostic),
  };
}

export async function refreshJoystickSession({
  clientId,
  refreshToken,
  previous,
  fetch,
  now = Date.now,
  save,
  onDiagnostic,
}: {
  clientId: string;
  refreshToken: string;
  previous: Pick<JoystickSession, 'identity'> & Pick<JoystickSession, 'grantedPermissions'>;
  fetch?: FetchLike;
  now?: () => number;
  save?: (session: JoystickSession) => Promise<void>;
  onDiagnostic?: JoystickTrafficDiagnostic;
}): Promise<JoystickSession> {
  const response = await fetchWithJoystickDiagnostics(fetchRequired(fetch), TOKEN_ENDPOINT, tokenRequest({
    grant_type: 'refresh_token',
    client_id: required(clientId, 'clientId'),
    refresh_token: required(refreshToken, 'refreshToken'),
  }), onDiagnostic);
  const token = await jsonResponse(response, 'Joystick token refresh');
  const next = {
    accessToken: required(token.access_token, 'Joystick access token'),
    refreshToken: String(token.refresh_token ?? refreshToken),
    expiresAt: now() + Number(token.expires_in ?? 0) * 1000,
    identity: previous.identity,
    grantedPermissions: previous.grantedPermissions ?? [],
  };
  await save?.(next);
  return next;
}

export function createDesktopJoystickBackend({
  clientId,
  fetch,
  redirectUri,
  onDiagnostic,
}: {
  clientId: string;
  fetch?: FetchLike;
  redirectUri: string;
  onDiagnostic?: JoystickTrafficDiagnostic;
}) {
  let authorization: ReturnType<typeof createJoystickAuthorizeRequest> | null = null;
  const toBackendSession = (session: JoystickSession): JoystickBackendSession => ({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: new Date(session.expiresAt).toISOString(),
    identity: session.identity,
    grantedPermissions: session.grantedPermissions ?? [],
    state: 'authenticated',
    userId: session.identity.id,
    provider: 'joystick',
  });

  return {
    async start(input: { codeVerifier?: string } = {}) {
      authorization = createJoystickAuthorizeRequest({ clientId, redirectUri, codeVerifier: input.codeVerifier });
      diagnoseJoystickTraffic(onDiagnostic, {
        direction: 'outbound',
        transport: 'oauth',
        method: 'BROWSER_HANDOFF',
        endpoint: AUTHORIZE_ENDPOINT,
        request: { authorizeUrl: authorization.authorizeUrl, redirectUri },
      });
      return { authorizeUrl: authorization.authorizeUrl, state: authorization.state, redirectUri, codeVerifier: authorization.codeVerifier };
    },
    async complete(callbackUrl: string, options: { codeVerifier: string }) {
      if (!authorization) throw new Error('Joystick authorization was not started');
      diagnoseJoystickTraffic(onDiagnostic, {
        direction: 'inbound',
        transport: 'oauth',
        method: 'LOOPBACK_CALLBACK',
        endpoint: redirectUri,
        request: { callbackUrl },
      });
      const callback = validateJoystickCallback(callbackUrl, { state: authorization.state, redirectUri });
      diagnoseJoystickTraffic(onDiagnostic, {
        direction: 'inbound',
        transport: 'oauth',
        method: 'LOOPBACK_CALLBACK',
        endpoint: redirectUri,
        outcome: 'validated',
      });
      const session = await exchangeJoystickCode({
        clientId,
        code: callback.code,
        codeVerifier: options.codeVerifier,
        redirectUri,
        fetch,
        onDiagnostic,
      });
      let grantedPermissions: string[] = [];
      try {
        grantedPermissions = await fetchJoystickGrantedPermissions({ accessToken: session.accessToken, fetch, onDiagnostic });
      } catch {
        // A permissions lookup must not invalidate otherwise successful sign-in.
        // Empty grants keep capability-gated delivery fail-closed.
      }
      authorization = null;
      return toBackendSession({ ...session, grantedPermissions });
    },
    async restore(session: JoystickBackendSession) {
      if (Date.parse(session.expiresAt) <= Date.now()) return null;
      return { ...session, grantedPermissions: session.grantedPermissions ?? [] };
    },
    async refresh(session: JoystickBackendSession) {
      return toBackendSession(await refreshJoystickSession({
        clientId,
        refreshToken: session.refreshToken,
        previous: { identity: session.identity, grantedPermissions: session.grantedPermissions },
        fetch,
        onDiagnostic,
      }));
    },
    async signOut() {},
    async registerDevice() {},
    async pullSettings() {},
  };
}
