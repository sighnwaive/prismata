import { createAuthClient } from '../src/auth';
import { createBackendRuntime } from '../src/backend';

const client = createAuthClient(createBackendRuntime({ backendUrl: 'https://api.prismata.test' }));
void client;
