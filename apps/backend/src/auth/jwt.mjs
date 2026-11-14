import { createHmac, timingSafeEqual } from 'node:crypto';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const createJwt = (secret, { now = () => Date.now(), ttlSeconds = 900 } = {}) => ({
  sign(payload) {
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const body = encode({ ...payload, iat: Math.floor(now() / 1000), exp: Math.floor(now() / 1000) + ttlSeconds });
    const input = `${header}.${body}`;
    const signature = createHmac('sha256', secret).update(input).digest('base64url');
    return `${input}.${signature}`;
  },
  verify(token) {
    try {
      const [header, body, signature] = token.split('.');
      const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
      return claims.exp * 1000 > now() ? claims : null;
    } catch { return null; }
  },
});
