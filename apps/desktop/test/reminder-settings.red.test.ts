import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultReminderSettings, normalizeReminderSettings, type ReminderSettings } from '../src/reminder-settings.js';
import { createReminderPreloadApi } from '../electron/preload-api.js';
import { getReminderSettings, requireReminderLifecycle } from '../electron/main.js';

test('reminder defaults are enabled, hourly, and use Flip a Coin', () => {
  assert.deepEqual(defaultReminderSettings, { enabled: true, task: 'custom-message', message: 'Flip a Coin', schedule: 'hourly', intervalMinutes: 5, dailyTime: '09:00' });
});

test('reminder settings normalize persisted values and round-trip through the preload contract', async () => {
  const settings = normalizeReminderSettings({ enabled: false, message: 'Choose', schedule: 'daily', dailyTime: '18:30' });
  assert.deepEqual(settings, { enabled: false, task: 'custom-message', message: 'Choose', schedule: 'daily', intervalMinutes: 5, dailyTime: '18:30' });
  const api = createReminderPreloadApi({ get: async () => settings, update: async (next: ReminderSettings) => next });
  assert.deepEqual(await api.get(), settings);
  assert.deepEqual(await api.update({ ...settings, enabled: true }), { ...settings, enabled: true });
});

test('reminder message pools are trimmed, bounded, and keep the first message as the legacy value', () => {
  const settings = normalizeReminderSettings({
    messages: ['  First message  ', '', 'Second message'],
    schedule: 'hourly',
  });

  assert.deepEqual(settings.messages, ['First message', 'Second message']);
  assert.equal(settings.message, 'First message');
  assert.equal(normalizeReminderSettings({ message: 'Legacy only' }).message, 'Legacy only');
});

test('reminder:get returns saved custom message and schedule', () => {
  const savedReminder = { enabled: true, task: 'custom-message', message: 'Saved message', schedule: 'daily', intervalMinutes: 5, dailyTime: '18:30' };
  const saved = { settings: { reminder: savedReminder } };
  assert.deepEqual(getReminderSettings(saved), savedReminder);
});

test('reminder:get returns normalized defaults when lifecycle settings are unavailable', () => {
  assert.deepEqual(getReminderSettings(undefined), defaultReminderSettings);
});

test('reminder:update rejects unavailable lifecycle with a clear error', () => {
  assert.throws(() => requireReminderLifecycle(undefined), {
    message: 'Cannot update reminder settings: desktop lifecycle is unavailable',
  });
});

test('coin-flip task normalizes and round-trips through the preload contract', async () => {
  const settings = normalizeReminderSettings({ enabled: true, task: 'coin-flip', message: 'ignored', schedule: 'hourly', dailyTime: '09:00' });
  assert.deepEqual(settings, { enabled: true, task: 'coin-flip', message: 'ignored', schedule: 'hourly', intervalMinutes: 5, dailyTime: '09:00' });
  const api = createReminderPreloadApi({ get: async () => settings, update: async (next: ReminderSettings) => next });
  assert.deepEqual(await api.update(settings), settings);
});

test('reminder preload contract has no token or direct Joystick surface', () => {
  const api = createReminderPreloadApi({ get: async () => defaultReminderSettings, update: async (settings) => settings });
  assert.deepEqual(Object.keys(api).sort(), ['get', 'update']);
  assert.equal((api as Record<string, unknown>).accessToken, undefined);
});

test('reminder preload contract exposes only a typed immediate test method', async () => {
  const calls: ReminderSettings[] = [];
  const api = createReminderPreloadApi({
    get: async () => defaultReminderSettings,
    update: async (settings) => settings,
    test: async (settings) => { calls.push(settings); return { ok: true }; },
  });
  assert.deepEqual(await api.test({ ...defaultReminderSettings, enabled: false }), { ok: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(api).sort(), ['get', 'test', 'update']);
});
