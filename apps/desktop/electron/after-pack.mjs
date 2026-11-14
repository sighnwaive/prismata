import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const JOYSTICK_CONFIG_KEYS = [
  'JOYSTICK_CLIENT_ID',
  'JOYSTICK_SCOPES',
  'JOYSTICK_PROFILE_ENDPOINT',
];

function getResourcesDirectory(context) {
  if (context.electronPlatformName !== 'darwin') {
    return join(context.appOutDir, 'resources');
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appBundle = basename(context.appOutDir).endsWith('.app')
    ? context.appOutDir
    : join(context.appOutDir, `${productFilename}.app`);
  return join(appBundle, 'Contents', 'Resources');
}

export default async function afterPack(context) {
  const config = Object.fromEntries(
    JOYSTICK_CONFIG_KEYS
      .map((key) => [key, process.env[key]?.trim()])
      .filter(([, value]) => value),
  );
  const resourcesDirectory = getResourcesDirectory(context);
  await mkdir(resourcesDirectory, { recursive: true });
  await writeFile(
    join(resourcesDirectory, 'prismata-runtime-config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
}
