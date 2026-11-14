export const desktopOAuthRedirectUri = 'http://127.0.0.1:43110/auth/callback';

export function handleDesktopOAuthCallback(callbackUrl: string): URL {
  const callback = new URL(callbackUrl);
  const redirect = new URL(desktopOAuthRedirectUri);
  if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname || callback.hash) {
    throw new Error('invalid desktop auth callback');
  }
  return callback;
}
