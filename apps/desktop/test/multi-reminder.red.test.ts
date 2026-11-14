import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultReminderRecord,
  normalizeReminderRecords,
  type ReminderRecord,
} from '../src/reminder-settings.js';
import { createFlipACoinScheduler } from '../src/flip-a-coin-scheduler.js';
import { createReminderPreloadApi } from '../electron/preload-api.js';

test('legacy reminder migrates to one stable identified record without losing settings', () => {
  const records = normalizeReminderRecords({
    theme: 'night',
    reminder: { enabled: false, task: 'custom-message', message: 'Legacy', schedule: 'daily', dailyTime: '18:30' },
  });
  assert.deepEqual(records, [{ id: 'legacy-reminder', enabled: false, task: 'custom-message', message: 'Legacy', schedule: 'daily', intervalMinutes: 5, dailyTime: '18:30' }]);
});

test('multiple reminder records are normalized and receive unique safe ids', () => {
  const records = normalizeReminderRecords({ reminders: [
    { id: 'same', task: 'coin-flip', schedule: 'hourly' },
    { id: 'same', enabled: 'bad', task: 'unknown', schedule: 'bad', message: '', dailyTime: 'bad' },
    null,
  ] });
  assert.equal(records.length, 2);
  assert.equal(new Set(records.map((record) => record.id)).size, 2);
  assert.equal(records[0].task, 'coin-flip');
  assert.deepEqual(records[1], { ...defaultReminderRecord, id: 'same-2' });
});

test('preload contract supports narrow list/create/update/delete/test reminder CRUD', async () => {
  const calls: string[] = [];
  const record: ReminderRecord = { ...defaultReminderRecord, id: 'one' };
  const api = createReminderPreloadApi({
    list: async () => [record],
    create: async (input) => { calls.push(`create:${input.task}`); return record; },
    updateRecord: async (id, input) => { calls.push(`update:${id}`); return { ...record, ...input, id }; },
    remove: async (id) => { calls.push(`delete:${id}`); },
    testRecord: async (id) => { calls.push(`test:${id}`); return { ok: true }; },
  });
  assert.deepEqual(await api.list!(), [record]);
  await api.create!(record);
  await api.updateRecord!('one', record);
  await api.remove!('one');
  await api.testRecord!('one');
  assert.deepEqual(calls, ['create:custom-message', 'update:one', 'delete:one', 'test:one']);
});

test('scheduler independently deduplicates and delivers multiple enabled reminders', async () => {
  const sent: unknown[] = [];
  const scheduler = createFlipACoinScheduler({
    send: (payload) => { sent.push(payload); },
    getSettings: () => ({ reminders: [
      { ...defaultReminderRecord, id: 'one', message: 'One', schedule: 'hourly' },
      { ...defaultReminderRecord, id: 'two', message: 'Two', schedule: 'hourly' },
    ] }),
  });
  await scheduler.tick(new Date(2026, 9, 14, 12, 0, 0));
  await scheduler.tick(new Date(2026, 9, 14, 12, 0, 30));
  assert.deepEqual(sent, [{ message: 'One' }, { message: 'Two' }]);
});
