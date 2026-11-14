import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '@dotenvx/dotenvx';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const loadBackendEnvironment = () => config({
  path: path.join(repoRoot, '.env'),
  ignore: ['MISSING_ENV_FILE'],
  quiet: true,
  override: false,
});
