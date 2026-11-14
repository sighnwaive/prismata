import { fileURLToPath } from 'node:url';
import { desktopOAuthRedirectUri } from '../src/auth-flow';
import { normalizeReminderRecord, normalizeReminderRecords, normalizeReminderSettings, type ReminderRecord, type ReminderSettings } from '../src/reminder-settings';

export type DesktopShellContractInput = {
  appName: string;
  oauthRedirectUri: string;
};

export type DesktopShellContract = {
  windowTitle: string;
  preloadEntry: string;
  oauthRedirectUri: string;
};

export function createBrowserWindowOptions(preload: string) {
  return {
    width: 1100,
    height: 760,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  };
}

export function createDesktopShellContract(
  input: DesktopShellContractInput,
): DesktopShellContract {
  return {
    windowTitle: `${input.appName} desktop`,
    preloadEntry: fileURLToPath(new URL('./preload.mjs', import.meta.url)),
    oauthRedirectUri: input.oauthRedirectUri,
  };
}

export function getDesktopOAuthCallbackUrl(
  search: string,
): typeof desktopOAuthRedirectUri {
  return `${desktopOAuthRedirectUri}?${search}` as typeof desktopOAuthRedirectUri;
}

export function getReminderSettings(settingsResult?: { settings?: { reminder?: unknown } }): ReminderSettings {
  return normalizeReminderSettings(settingsResult?.settings?.reminder);
}

export function getReminderRecords(settingsResult?: { settings?: Record<string, unknown> }): ReminderRecord[] {
  return normalizeReminderRecords(settingsResult?.settings);
}

export function createReminderRecord(value: unknown): ReminderRecord {
  return normalizeReminderRecord(value, `reminder-${Date.now()}`);
}

export function requireReminderLifecycle<T>(lifecycle: T | undefined): T {
  if (!lifecycle) throw new Error('Cannot update reminder settings: desktop lifecycle is unavailable');
  return lifecycle;
}

export function validateTodoInput(input: unknown): { itemName: string; viewer?: string; note?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('TODO input must be an object');
  }

  const values = input as Record<string, unknown>;
  const itemName = validateTodoText(values.itemName, 'item name', 200, true)!;
  const viewer = validateTodoText(values.viewer, 'viewer', 100, false);
  const note = validateTodoText(values.note, 'note', 2_000, false);
  return { itemName, ...(viewer ? { viewer } : {}), ...(note ? { note } : {}) };
}

export function validateTodoId(id: unknown): string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 200 || !id.trim()) {
    throw new TypeError('TODO ID must be nonblank text of 200 characters or fewer');
  }
  return id.trim();
}

function validateTodoText(value: unknown, label: string, maxLength: number, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) throw new TypeError(`${label} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
  if (value.length > maxLength) throw new TypeError(`${label} must be ${maxLength} characters or fewer`);
  const normalized = value.trim();
  if (!normalized) {
    if (required) throw new TypeError(`${label} is required`);
    return undefined;
  }
  return normalized;
}

export function createDesktopLifecycleManager<T extends { stop: () => Promise<unknown> }>(
  create: (...args: any[]) => Promise<T>,
) {
  let active: T | undefined;
  return {
    async create(...args: any[]) {
      await active?.stop();
      active = await create(...args);
      return active;
    },
    async stop() {
      await active?.stop();
      active = undefined;
    },
  };
}
