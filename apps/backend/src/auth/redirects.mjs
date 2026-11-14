const parseRedirectUri = (redirectUri) => {
  try {
    return new URL(redirectUri);
  } catch {
    return null;
  }
};

const isLoopbackHostname = (hostname) => (
  hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
);

export const isValidDesktopRedirectUri = (redirectUri) => {
  const url = parseRedirectUri(redirectUri);

  return url !== null && url.protocol === 'http:' && isLoopbackHostname(url.hostname);
};

export const isValidMobileRedirectUri = (redirectUri) => {
  const url = parseRedirectUri(redirectUri);

  return url !== null && url.protocol === 'prismata:';
};

export const isValidPlatformRedirectUri = ({ platform, redirectUri }) => {
  if (platform === 'desktop') {
    return isValidDesktopRedirectUri(redirectUri);
  }

  if (platform === 'mobile') {
    return isValidMobileRedirectUri(redirectUri);
  }

  return false;
};
