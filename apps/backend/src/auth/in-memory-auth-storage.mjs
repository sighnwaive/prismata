import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { createAuthStateStore } from './state-store.mjs';

export const createInMemoryAuthStorage = ({ now = () => Date.now(), jwt = null } = {}) => {
  const authStateStore = createAuthStateStore({ now });
  const sessions = new Map();
  let jwtSigner = jwt;

  const userId = 'user-in-memory';
  const settings = {
    settings: {},
    updatedAt: '1970-01-01T00:00:00.000Z',
    version: 1,
  };
  const devices = new Map();

  return {
    persistAuthState(authState) {
      authStateStore.issue(authState.state, {
        provider: authState.provider,
        redirectUri: authState.redirectUri,
        state: authState.state,
        platform: authState.platform,
        codeChallenge: authState.codeChallenge,
        codeChallengeMethod: authState.codeChallengeMethod,
      });
    },
    consumeAuthState(state, expected = {}) {
      const record = authStateStore.consume(state, {
        platform: expected.platform,
        redirectUri: expected.redirectUri,
      });
      if (!record) return false;
      if (expected.platform && record.platform !== expected.platform) return false;
      if (expected.redirectUri && record.redirectUri !== expected.redirectUri) return false;
      if (record.codeChallenge) {
        if (!expected.codeVerifier) return false;
        const actual = record.codeChallengeMethod === 'S256'
          ? createHash('sha256').update(expected.codeVerifier).digest('base64url')
          : expected.codeVerifier;
        if (actual !== record.codeChallenge) return false;
      }
      return true;
    },
    createSession({ provider = 'anonymous' } = {}) {
      const session = {
        id: randomUUID(),
        userId: provider === 'anonymous' ? 'anonymous-user' : userId,
        state: provider,
        expiresAt: new Date(now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

      sessions.set(session.id, session);

      return session;
    },
    async createAuthenticatedSession({ provider = 'joystick', subject = 'unknown' }) {
      const session = this.createSession({ provider });
      const refreshToken = randomBytes(32).toString('base64url');
      const accessToken = jwtSigner?.sign({ sid: session.id, sub: session.userId }) ?? session.id;
      sessions.set(session.id, { ...session, subject, refreshTokenHash: hash(refreshToken), revokedAt: null });
      return { id: session.id, userId: session.userId, accessToken, refreshToken, expiresAt: session.expiresAt };
    },
    configureJwt(nextJwt) {
      jwtSigner = nextJwt;
    },
    getSession(sessionId) {
      const session = sessions.get(sessionId) ?? null;
      return session?.revokedAt ? null : session;
    },
    rotateRefreshSession(refreshToken) {
      const old = [...sessions.values()].find((session) => session.refreshTokenHash === hash(refreshToken) && !session.revokedAt);
      if (!old) return null;
      old.revokedAt = new Date(now()).toISOString();
      return this.createAuthenticatedSession({ provider: old.state, subject: old.subject });
    },
    revokeSession(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return false;
      session.revokedAt = new Date(now()).toISOString();
      return true;
    },
    revokeRefreshToken(refreshToken) {
      const session = [...sessions.values()].find((candidate) => candidate.refreshTokenHash === hash(refreshToken));
      return session ? this.revokeSession(session.id) : false;
    },
    getUserSettings(sessionUserId) {
      if (sessionUserId !== userId) {
        return null;
      }

      return settings;
    },
    saveUserSettings({ userId: sessionUserId, settings: nextSettings }) {
      if (sessionUserId !== userId) return null;
      settings.settings = nextSettings;
      settings.version += 1;
      settings.updatedAt = new Date(now()).toISOString();
      return settings;
    },
    upsertDevice({ userId: sessionUserId, device }) {
      if (sessionUserId !== userId) {
        return null;
      }

      const persistedDevice = {
        ...device,
        lastSeenAt: '1970-01-01T00:00:00.000Z',
      };

      devices.set(device.deviceId, persistedDevice);

      return persistedDevice;
    },
  };
};

const hash = (value) => createHash('sha256').update(value).digest('hex');
