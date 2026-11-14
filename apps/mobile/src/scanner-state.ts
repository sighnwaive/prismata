export type ScannerPermission = 'checking' | 'granted' | 'denied' | 'unavailable';

export function getScannerPresentation(permission: ScannerPermission, hasDevice: boolean, handled = false) {
  if (permission === 'checking') return 'checking' as const;
  if (permission === 'unavailable') return 'unavailable' as const;
  if (permission !== 'granted') return 'permission' as const;
  if (!hasDevice) return 'unavailable' as const;
  if (handled) return 'handled' as const;
  return 'camera' as const;
}
