import { createServer } from 'node:http';
import { loadBackendEnvironment } from '../../../scripts/load-backend-env.mjs';
import { createApp } from './app.mjs';
import { loadBackendConfig } from './config.mjs';
import { createPostgresAuthStorage } from './auth/postgres-auth-storage.mjs';
import { createJoystickProvider } from './providers/joystick.mjs';

loadBackendEnvironment();
const config = loadBackendConfig();
const authStorage = createPostgresAuthStorage({ databaseUrl: config.databaseUrl });
const app = createApp({
  authStorage,
  jwtSecret: config.jwtSecret,
  joystickProvider: createJoystickProvider({
    clientId: config.joystickClientId,
    clientSecret: config.joystickClientSecret,
    tokenUrl: config.joystickTokenUrl,
  }),
});

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  await app(request, response);
});

server.listen(Number(process.env.PRISMATA_API_PORT ?? 8080), '0.0.0.0');
