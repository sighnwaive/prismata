import { createJoystickAuthStart } from '../providers/joystick.mjs';
import { isValidPlatformRedirectUri } from './redirects.mjs';

export const isValidAuthStartRequest = (body) => {
  if (body.platform !== 'desktop' && body.platform !== 'mobile') {
    return false;
  }

  if (typeof body.redirectUri !== 'string' || body.redirectUri.length === 0) {
    return false;
  }

  if (body.codeChallenge !== undefined && (typeof body.codeChallenge !== 'string' || body.codeChallenge.length < 8)) return false;
  if (body.codeChallengeMethod !== undefined && !['plain', 'S256'].includes(body.codeChallengeMethod)) return false;
  if (body.platform === 'desktop' && (typeof body.codeChallenge !== 'string' || body.codeChallengeMethod !== 'S256')) return false;
  return isValidPlatformRedirectUri(body);
};

export const issueJoystickAuthStart = ({ authStorage, platform, redirectUri, codeChallenge, codeChallengeMethod = 'S256' }) => {
  const authStart = createJoystickAuthStart({ redirectUri, codeChallenge, codeChallengeMethod });

  const persistedState = {
    provider: 'joystick',
    redirectUri,
    state: authStart.state,
  };
  if (platform !== undefined) Object.defineProperty(persistedState, 'platform', { value: platform, enumerable: false });
  if (codeChallenge !== undefined) {
    Object.defineProperty(persistedState, 'codeChallenge', { value: codeChallenge, enumerable: false });
    Object.defineProperty(persistedState, 'codeChallengeMethod', { value: codeChallengeMethod, enumerable: false });
  }
  authStorage.persistAuthState(persistedState);
  return authStart;
};

export const consumeJoystickCallbackState = async ({ authStorage, state, platform, redirectUri, codeVerifier }) => (
  typeof state === 'string' && state.length !== 0 && (codeVerifier === undefined || typeof codeVerifier === 'string') && await authStorage.consumeAuthState(state, {
    platform,
    redirectUri,
    codeVerifier,
  })
);
