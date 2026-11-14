import type { BackendSession } from '@prismata/sync';
import { createHash, randomBytes } from 'node:crypto';

export type DesktopAuthState = 'signed-out' | 'opening-browser' | 'waiting-for-callback' | 'authenticated' | 'failure' | 'offline';
export type DesktopAuthSnapshot = {
  state: DesktopAuthState;
  userId: string | null;
  expiresAt: string | null;
  error: string | null;
};

export type CredentialStore = {
  get: (key: string) => Promise<unknown | null>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export type CallbackServer = {
  redirectUri: string;
  waitForCallback: (signal: AbortSignal) => Promise<string>;
  close: () => Promise<void>;
};

type Backend = {
  start: (input: { provider: 'joystick'; platform: 'desktop'; redirectUri: string; codeChallenge: string; codeChallengeMethod: 'S256'; codeVerifier?: string }) => Promise<{ authorizeUrl: string; state: string; redirectUri: string; codeVerifier?: string }>;
  complete: (callbackUrl: string, options: { codeVerifier: string }) => Promise<BackendSession>;
  restore: (session: BackendSession) => Promise<BackendSession | null>;
  refresh: (session: BackendSession) => Promise<BackendSession>;
  signOut: (session: BackendSession | null) => Promise<void>;
  registerDevice: (session: BackendSession) => Promise<void>;
  pullSettings: (session: BackendSession) => Promise<void>;
};

type CoordinatorOptions = {
  backend: Backend;
  browser: (url: string) => Promise<void>;
  store: CredentialStore;
  createCallbackServer: () => Promise<CallbackServer>;
  timeoutMs?: number;
  onStateChanged?: (snapshot: DesktopAuthSnapshot) => void;
};

const sessionKey = 'prismata.auth.session';
const refreshLeadWindowMs = 5 * 60_000;

export function createDesktopAuthCoordinator(options: CoordinatorOptions) {
  let snapshot: DesktopAuthSnapshot = { state: 'offline', userId: null, expiresAt: null, error: null };
  let session: BackendSession | null = null;
  let activeAbort: AbortController | null = null;
  let activeCallbackServer: CallbackServer | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshGeneration = 0;
  let closed = false;
  const closedCallbackServers = new WeakSet<object>();

  const publish = (next: DesktopAuthSnapshot) => { snapshot = next; options.onStateChanged?.(next); };
  const cancelRefresh = () => {
    refreshGeneration += 1;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
  };
  const refreshCurrentSession = async (current: BackendSession, generation: number) => {
    try {
      const next = await options.backend.refresh(current);
      if (closed || refreshGeneration !== generation || session !== current) return;
      await options.store.set(sessionKey, next);
      if (closed || refreshGeneration !== generation || session !== current) return;
      authenticated(next);
    } catch (error) {
      if (closed || refreshGeneration !== generation || session !== current) return;
      session = null;
      cancelRefresh();
      publish({ state: 'failure', userId: null, expiresAt: null, error: error instanceof Error ? error.message : 'session refresh failed' });
      try { await options.store.delete(sessionKey); } catch { /* fail closed even if credential cleanup fails */ }
    }
  };
  const scheduleRefresh = (current: BackendSession) => {
    cancelRefresh();
    if (closed) return;
    const expiresAt = Date.parse(current.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const generation = refreshGeneration;
    const delay = Math.max(0, expiresAt - Date.now() - refreshLeadWindowMs);
    refreshTimer = setTimeout(() => {
      if (closed || refreshGeneration !== generation || session !== current) return;
      refreshTimer = null;
      return refreshCurrentSession(current, generation);
    }, delay);
  };
  const authenticated = (next: BackendSession) => {
    session = next;
    publish({ state: 'authenticated', userId: next.userId, expiresAt: next.expiresAt, error: null });
    scheduleRefresh(next);
  };

  return {
    getSnapshot: () => snapshot,
    getSession: () => session,
    async signInWithJoystick() {
      activeAbort?.abort();
      const abort = new AbortController();
      activeAbort = abort;
      let callbackServer: CallbackServer | null = null;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        callbackServer = await options.createCallbackServer();
        activeCallbackServer = callbackServer;
        if (abort.signal.aborted) throw new Error('authentication cancelled');
        timeout = setTimeout(() => abort.abort(), options.timeoutMs ?? 120_000);
        const codeVerifier = randomBytes(32).toString('base64url');
        const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
        const started = await options.backend.start({ provider: 'joystick', platform: 'desktop', redirectUri: callbackServer.redirectUri, codeChallenge, codeChallengeMethod: 'S256', codeVerifier });
        publish({ ...snapshot, state: 'opening-browser', error: null });
        await options.browser(started.authorizeUrl);
        publish({ ...snapshot, state: 'waiting-for-callback', error: null });
        const callbackUrl = await waitForCallback(callbackServer, abort.signal);
        const returnedState = new URL(callbackUrl).searchParams.get('state');
        if (returnedState !== started.state) throw new Error('invalid oauth state');
        const next = await options.backend.complete(callbackUrl, { codeVerifier: started.codeVerifier ?? codeVerifier });
        await options.store.set(sessionKey, next);
        authenticated(next);
        await options.backend.registerDevice(next);
        await options.backend.pullSettings(next);
      } catch (error) {
        publish({ ...snapshot, state: abort.signal.aborted ? 'signed-out' : 'failure', error: error instanceof Error ? error.message : 'authentication failed' });
        if (abort.signal.aborted) throw new Error('authentication cancelled');
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
        if (callbackServer && !closedCallbackServers.has(callbackServer)) await callbackServer.close();
        if (activeCallbackServer === callbackServer) activeCallbackServer = null;
        if (activeAbort === abort) activeAbort = null;
      }
    },
    cancel() { activeAbort?.abort(); },
    async close() {
      closed = true;
      cancelRefresh();
      activeAbort?.abort();
      const callbackServer = activeCallbackServer;
      activeCallbackServer = null;
      if (callbackServer) {
        closedCallbackServers.add(callbackServer);
        await callbackServer.close();
      }
    },
    async restoreOnStartup() {
      publish({ ...snapshot, state: 'offline', error: null });
      try {
        const stored = await options.store.get(sessionKey) as BackendSession | null;
        if (!stored) { publish({ state: 'signed-out', userId: null, expiresAt: null, error: null }); return; }
        const restored = await options.backend.restore(stored);
        const next = restored ?? await options.backend.refresh(stored);
        await options.store.set(sessionKey, next);
        authenticated(next);
        await options.backend.registerDevice(next);
        await options.backend.pullSettings(next);
      } catch (error) {
        session = null;
        publish({ state: 'offline', userId: null, expiresAt: null, error: error instanceof Error ? error.message : 'offline' });
      }
    },
    async signOut() {
      cancelRefresh();
      await options.backend.signOut(session);
      session = null;
      await options.store.delete(sessionKey);
      publish({ state: 'signed-out', userId: null, expiresAt: null, error: null });
    },
  };
}

async function waitForCallback(server: CallbackServer, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new Error('authentication cancelled');
  return Promise.race([
    server.waitForCallback(signal),
    new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(new Error('authentication cancelled')), { once: true })),
  ]);
}
