import { randomUUID } from 'node:crypto';

const sessionCookieName = 'prismata_session';

export const createSessionCookie = (sessionId = randomUUID()) => (
  `${sessionCookieName}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`
);
