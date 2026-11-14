import { createServer } from 'node:http';
import { desktopOAuthRedirectUri, handleDesktopOAuthCallback } from '../src/auth-flow';

export async function createLoopbackCallbackServer(): Promise<{
  redirectUri: string;
  waitForCallback: (signal: AbortSignal) => Promise<string>;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    try {
      const callbackUrl = `http://127.0.0.1:${port}${request.url ?? '/'}`;
      handleDesktopOAuthCallback(callbackUrl);
      response.end('Authentication received. You can return to Prismata.');
      callback?.(callbackUrl);
    } catch {
      response.writeHead(404).end();
    }
  });
  let callback: ((url: string) => void) | null = null;
  let port = 0;
  let closed = false;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
  server.listen(Number(new URL(desktopOAuthRedirectUri).port), '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
  return {
    redirectUri: desktopOAuthRedirectUri,
    waitForCallback: (signal) => new Promise((resolve, reject) => {
      const onAbort = () => { callback = null; reject(new Error('authentication cancelled')); };
      signal.addEventListener('abort', onAbort, { once: true });
      callback = (url) => { signal.removeEventListener('abort', onAbort); resolve(url); };
    }),
     close: () => new Promise((resolve) => { if (closed) { resolve(); return; } closed = true; server.close(() => resolve()); }),
  };
}
