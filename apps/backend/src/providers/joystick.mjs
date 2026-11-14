import { randomUUID } from 'node:crypto';

const joystickAuthorizeUrlOrigin = 'https://joystick.tv/api/oauth/authorize';

const createAuthorizeUrl = ({ redirectUri, state }) => {
  const url = new URL(joystickAuthorizeUrlOrigin);

  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);

  return url.toString();
};

export const createJoystickAuthStart = ({ redirectUri, codeChallenge, codeChallengeMethod }) => {
  const state = randomUUID();

  const result = {
    authorizeUrl: createAuthorizeUrl({ redirectUri, state }),
    state,
    redirectUri,
  };

  if (codeChallenge) {
    result.authorizeUrl += `&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=${encodeURIComponent(codeChallengeMethod)}`;
  }

  return result;
};

export const createJoystickProvider = ({ exchange, clientId = process.env.JOYSTICK_CLIENT_ID, clientSecret = process.env.JOYSTICK_CLIENT_SECRET, tokenUrl = process.env.JOYSTICK_TOKEN_URL } = {}) => ({
  async exchangeCode(input) {
    if (exchange) return exchange(input);
    if (clientId && clientSecret && tokenUrl) {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: input.redirectUri ?? '',
          client_id: clientId,
          client_secret: clientSecret,
          ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
        }),
      });
      if (!response.ok) {
        const error = new Error('Joystick token exchange failed');
        error.code = 'provider_exchange_failed';
        throw error;
      }
      const tokens = await response.json();
      return { subject: tokens.user_id ?? tokens.sub ?? tokens.username, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
    }
    return { subject: `joystick:${input.code}`, accessToken: null, refreshToken: null };
  },
});
