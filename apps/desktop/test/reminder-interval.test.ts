import assert from 'node:assert/strict';
import test from 'node:test';
import { renderShellPage } from '../electron/shell-page.js';
import { createFlipACoinScheduler } from '../src/flip-a-coin-scheduler.js';
import { normalizeReminderSettings } from '../src/reminder-settings.js';

test('migrates legacy every-5-minutes reminders to interval/5', () => {
  assert.deepEqual(normalizeReminderSettings({ schedule: 'every-5-minutes' }), {
    enabled: true,
    task: 'custom-message',
    message: 'Flip a Coin',
    schedule: 'interval',
    intervalMinutes: 5,
    dailyTime: '09:00',
  });
});

test('normalizes invalid interval values to the five-minute default', () => {
  assert.equal(normalizeReminderSettings({ schedule: 'interval', intervalMinutes: 0 }).intervalMinutes, 5);
  assert.equal(normalizeReminderSettings({ schedule: 'interval', intervalMinutes: 60 }).intervalMinutes, 5);
  assert.equal(normalizeReminderSettings({ schedule: 'interval', intervalMinutes: 2.5 }).intervalMinutes, 5);
  assert.equal(normalizeReminderSettings({ schedule: 'interval', intervalMinutes: '7' }).intervalMinutes, 5);
});

test('schedules seven-minute wall-clock buckets and deduplicates each bucket', async () => {
  const sent: string[] = [];
  const scheduler = createFlipACoinScheduler({
    send: ({ message }) => { sent.push(message); },
    getSettings: () => ({ enabled: true, task: 'custom-message', message: 'Seven', schedule: 'interval', intervalMinutes: 7, dailyTime: '09:00' }),
  });

  await scheduler.tick(new Date(2026, 9, 14, 0, 0, 0));
  await scheduler.tick(new Date(2026, 9, 14, 0, 6, 59));
  await scheduler.tick(new Date(2026, 9, 14, 0, 7, 0));
  await scheduler.tick(new Date(2026, 9, 14, 0, 7, 30));

  assert.deepEqual(sent, ['Seven', 'Seven']);
});

test('shows and persists the configurable interval control in the reminder UI', () => {
  const page = renderShellPage('offline', 'Prismata');
  assert.match(page, /<option value="interval">Every X minutes<\/option>/);
  assert.match(page, /id="reminder-interval-controls" hidden/);
  assert.match(page, /id="reminder-interval"[^>]*type="number"[^>]*min="1"[^>]*max="59"[^>]*step="1"/);
  assert.match(page, /intervalMinutes: Number\(\$\('reminder-interval'\)\.value\)/);
  assert.match(page, /Every ' \+ record\.intervalMinutes \+ ' minutes/);
});
