import {
  createAuthenticatedRequest,
  type BackendRuntime,
  type BackendSession,
  type BackendSessionResponse,
} from './backend';

export type AuthSessionState = 'unavailable' | 'anonymous' | 'authenticated';

export type DeviceRecordResult =
  | { state: 'registered' }
  | { state: 'skipped'; error?: string };

export type AuthBootstrapResult = {
  state: AuthSessionState;
  snapshot: AuthStateSnapshot;
  deviceRecord: DeviceRecordResult;
};

export type AuthStateSnapshot = {
  state: AuthSessionState;
  isAnonymous: boolean;
  userId: string | null;
  expiresAt: string | number | null;
};

export type SharedAuthSession = BackendSession | null;

export type AuthStartInput = {
  provider: string;
  platform: 'desktop' | 'mobile';
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

export type AuthStartResponse = {
  authorizeUrl: string;
  state: string;
  redirectUri: string;
};

export type AuthSnapshotListener = (snapshot: AuthStateSnapshot) => void;

export type AuthClient = {
  start: (input: AuthStartInput) => Promise<AuthStartResponse>;
  complete: (callbackUrl: string, options?: { provider?: string; codeVerifier?: string }) => Promise<BackendSession>;
  restore: (storedSession?: BackendSession) => Promise<BackendSession | null>;
  refresh: () => Promise<BackendSession>;
  revoke: () => Promise<void>;
  signOut: () => Promise<void>;
  getSession: () => BackendSession | null;
  subscribe: (listener: AuthSnapshotListener) => () => void;
};

export function createAuthClient(runtime: BackendRuntime, initialSession: BackendSession | null = null): AuthClient {
  let session: BackendSession | null = initialSession;
  const listeners = new Set<AuthSnapshotListener>();
  const notify = () => {
    const snapshot = toAuthStateSnapshot(session);
    for (const listener of listeners) listener(snapshot);
  };
  const setSession = (next: BackendSession | null) => {
    session = next;
    notify();
    return next;
  };
  const request = (path: string, init?: RequestInit) =>
    createAuthenticatedRequest(runtime, () => session)(path, init);

  return {
    async start(input) {
      const response = await runtime.request<AuthStartResponse>(`/auth/providers/${input.provider}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: input.platform,
          redirectUri: input.redirectUri,
          ...(input.codeChallenge ? { codeChallenge: input.codeChallenge } : {}),
          ...(input.codeChallengeMethod ? { codeChallengeMethod: input.codeChallengeMethod } : {}),
        }),
      });
      return response;
    },
    async complete(callbackUrl, options = {}) {
      const callback = new URL(callbackUrl);
      const provider = options.provider ?? 'joystick';
      const next = await runtime.request<BackendSession>(`/auth/providers/${provider}/callback${callback.search}`, options.codeVerifier ? {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codeVerifier: options.codeVerifier }),
      } : undefined);
      const result = setSession(next);
      if (!result) throw new Error('backend auth callback returned no session');
      return result;
    },
    async restore(storedSession) {
      if (storedSession) session = storedSession;
      try {
        const body = storedSession
          ? await (await request('/auth/session')).json() as BackendSessionResponse
          : await runtime.request<BackendSessionResponse>('/auth/session');
        return setSession(body.session);
      } catch {
        notify();
        return null;
      }
    },
    async refresh() {
      if (!session?.refreshToken) throw new Error('refresh token required');
      const next = await runtime.request<BackendSession>('/auth/sessions/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      const result = setSession(next);
      if (!result) throw new Error('backend refresh returned no session');
      return result;
    },
    async revoke() {
      await request('/auth/sessions/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(session?.refreshToken ? { refreshToken: session.refreshToken } : {}),
      });
      setSession(null);
    },
    async signOut() {
      await request('/auth/sign-out', { method: 'POST' });
      setSession(null);
    },
    getSession: () => session,
    subscribe(listener) {
      listeners.add(listener);
      listener(toAuthStateSnapshot(session));
      return () => listeners.delete(listener);
    },
  };
}

export function describeAuthState(session: SharedAuthSession | AuthStateSnapshot): string {
  const snapshot = toAuthStateSnapshot(session);
  if (snapshot.state === 'unavailable') return 'auth unavailable';
  return snapshot.isAnonymous ? 'anonymous session ready' : 'account session ready';
}

function toAuthStateSnapshot(session: SharedAuthSession | AuthStateSnapshot): AuthStateSnapshot {
  if (session && 'isAnonymous' in session) return session;
  if (!session) return { state: 'unavailable', isAnonymous: false, userId: null, expiresAt: null };
  return {
    state: session.state,
    isAnonymous: session.state === 'anonymous',
    userId: session.userId,
    expiresAt: session.expiresAt,
  };
}
