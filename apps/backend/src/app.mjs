import { consumeJoystickCallbackState, isValidAuthStartRequest, issueJoystickAuthStart } from './auth/joystick-flow.mjs';
import { createInMemoryAuthStorage } from './auth/in-memory-auth-storage.mjs';
import { getAuthorizedSession } from './auth/request-session.mjs';
import { createSessionCookie } from './auth/session-cookie.mjs';
import { assertValidAuthStorage } from './auth/storage.mjs';
import { assertValidSyncStorage } from './sync/storage.mjs';
import { createJoystickProvider } from './providers/joystick.mjs';
import { createJwt } from './auth/jwt.mjs';

const json = (response, statusCode, body) => {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(body === undefined ? '' : JSON.stringify(body));
};

const readJsonBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
};

const bearer = (request) => request.headers.authorization?.startsWith('Bearer ')
  ? request.headers.authorization.slice(7) : null;

export const createApp = ({ authStorage: providedAuthStorage, now = () => Date.now(), jwtSecret = process.env.PRISMATA_JWT_SECRET ?? 'development-only-secret', joystickProvider = createJoystickProvider() } = {}) => {
  const authStorage = providedAuthStorage ?? createInMemoryAuthStorage({ now });
  const jwt = createJwt(jwtSecret, { now });
  if (authStorage.configureJwt) authStorage.configureJwt(jwt);
  assertValidAuthStorage(authStorage);
  assertValidSyncStorage(authStorage);

  const authorized = async (request) => {
    const token = bearer(request);
    if (token) {
      const claims = jwt.verify(token);
      return claims ? authStorage.getSession(claims.sid) : null;
    }
    return await getAuthorizedSession(request, authStorage);
  };

  return async (request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    try {
      if (request.method === 'POST' && requestUrl.pathname === '/auth/providers/joystick/start') {
        const body = await readJsonBody(request);
        if (!isValidAuthStartRequest(body)) return json(response, 400, { error: 'invalid_auth_start_request' });
        return json(response, 200, issueJoystickAuthStart({ authStorage, ...body }));
      }

      if ((request.method === 'GET' || request.method === 'POST') && requestUrl.pathname === '/auth/providers/joystick/callback') {
        const body = request.method === 'POST' ? await readJsonBody(request) : {};
        const platform = requestUrl.searchParams.get('platform') ?? undefined;
        const redirectUri = requestUrl.searchParams.get('redirect_uri') ?? undefined;
        const codeVerifier = body.codeVerifier;
        const validState = await consumeJoystickCallbackState({
          authStorage,
          state: requestUrl.searchParams.get('state'),
          platform,
          redirectUri,
          codeVerifier,
        });
        if (!validState) return json(response, 400, { error: 'invalid_auth_state' });
        const providerIdentity = await joystickProvider.exchangeCode({
          code: requestUrl.searchParams.get('code'),
          redirectUri,
          codeVerifier,
        });
        const session = authStorage.createAuthenticatedSession
          ? await authStorage.createAuthenticatedSession({ provider: 'joystick', subject: providerIdentity.subject })
          : await authStorage.createSession({ provider: 'joystick' });
        response.setHeader('set-cookie', createSessionCookie(session.id));
        return json(response, 200, session.accessToken ? session : { ok: true });
      }

      if (request.method === 'POST' && requestUrl.pathname === '/auth/sessions/anonymous') {
        const session = await authStorage.createSession({ provider: 'anonymous' });
        response.setHeader('set-cookie', createSessionCookie(session.id));
        return json(response, 200, { session });
      }

      if (request.method === 'GET' && requestUrl.pathname === '/auth/session') {
        const session = await authorized(request);
        return session ? json(response, 200, { session }) : json(response, 401, { error: 'unauthorized' });
      }

      if (request.method === 'POST' && requestUrl.pathname === '/auth/sessions/refresh') {
        const body = await readJsonBody(request);
        const session = await authStorage.rotateRefreshSession?.(body.refreshToken);
        return session ? json(response, 200, session) : json(response, 401, { error: 'invalid_refresh_token' });
      }

      if (request.method === 'POST' && ['/auth/sessions/revoke', '/auth/sign-out'].includes(requestUrl.pathname)) {
        const body = await readJsonBody(request);
        const claims = body.refreshToken ? null : (bearer(request) ? jwt.verify(bearer(request)) : null);
        const revoked = body.refreshToken ? await authStorage.revokeRefreshToken?.(body.refreshToken) : await authStorage.revokeSession?.(claims?.sid);
        if (requestUrl.pathname === '/auth/sign-out') response.setHeader('set-cookie', `${createSessionCookie('')}; Max-Age=0`);
        return revoked === false ? json(response, 401, { error: 'unauthorized' }) : json(response, 204);
      }

      if (requestUrl.pathname === '/sync/settings' && (request.method === 'GET' || request.method === 'PUT')) {
        const session = await authorized(request);
        if (!session) return json(response, 401, { error: 'unauthorized' });
        if (request.method === 'GET') return json(response, 200, authStorage.getUserSettings(session.userId));
        const body = await readJsonBody(request);
        return json(response, 200, authStorage.saveUserSettings({ userId: session.userId, settings: body.settings ?? body }));
      }

      if (request.method === 'PUT' && requestUrl.pathname === '/sync/devices/self') {
        const session = await authorized(request);
        if (!session) return json(response, 401, { error: 'unauthorized' });
        const body = await readJsonBody(request);
        return json(response, 200, authStorage.upsertDevice({ userId: session.userId, device: body }));
      }
    } catch (error) {
      return json(response, error.code === 'provider_exchange_failed' ? 502 : 500, { error: error.code ?? 'internal_error' });
    }
    response.statusCode = 404;
    response.end();
  };
};
