import { appName } from '@prismata/core';

export const desktopDevice = {
  deviceId: 'desktop-local-device',
  platform: 'desktop' as const,
  deviceName: 'Prismata desktop',
};

export async function startDesktopApp() {
  return `${appName} desktop (local mode; mobile access is opt-in)`;
}
