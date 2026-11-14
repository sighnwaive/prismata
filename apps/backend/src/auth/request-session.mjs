const sessionCookiePrefix = 'prismata_session=';

export const getSessionIdFromCookie = (cookieHeader) => {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) {
    return null;
  }

  const cookies = cookieHeader.split(';');

  for (const cookie of cookies) {
    const trimmedCookie = cookie.trim();

    if (trimmedCookie.startsWith(sessionCookiePrefix)) {
      return trimmedCookie.slice(sessionCookiePrefix.length) || null;
    }
  }

  return null;
};

export const getAuthorizedSession = (request, authStorage) => {
  const sessionId = getSessionIdFromCookie(request.headers.cookie);

  if (sessionId === null) {
    return null;
  }

  return authStorage.getSession(sessionId);
};
