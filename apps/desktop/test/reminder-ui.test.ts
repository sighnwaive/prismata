import assert from 'node:assert/strict';
import test from 'node:test';
import { renderShellPage } from '../electron/shell-page.js';

test('reminder message pool controls are hidden as one block for coin-flip', () => {
  const page = renderShellPage('offline', 'Prismata');

  assert.match(page, /<div id="reminder-message-controls" hidden><p class="muted">Custom messages send in order, then rotate back to the beginning\.<\/p><div id="reminder-message-list"[^>]*>/);
  assert.match(page, /id="reminder-message-add"[^>]*>Add message<\/button>/);
  assert.match(page, /function setReminderMessageVisibility\(task\) \{ const visible = task === 'custom-message';/);
  assert.match(page, /\$\('reminder-message-controls'\)\.hidden = !visible/);
  assert.doesNotMatch(page, /\$\('reminder-message'\)/);
  assert.match(page, /setReminderMessageVisibility\(settings\.task\)/);
  assert.match(page, /onchange = \(\) => setReminderMessageVisibility\(\$\('reminder-task'\)\.value\)/);
});

test('reminder message pool keeps its first message and supports ordered add/remove editing', () => {
  const page = renderShellPage('offline', 'Prismata');

  assert.match(page, /function renderReminderMessages\(messages\)/);
  assert.match(page, /values\.forEach\(\(message, index\)/);
  assert.match(page, /messages\.push\(''\)/);
  assert.match(page, /field\.append\(label, textarea\); row\.append\(field\); if \(index > 0\)/);
  assert.match(page, /next\.splice\(index, 1\)/);
  assert.match(page, /messages\.length >= 10/);
  assert.match(page, /Add at least one custom message/);
});

test('reminder editor omits its test button while reminder rows retain test-send actions', () => {
  const page = renderShellPage('offline', 'Prismata');
  assert.doesNotMatch(page, /id="reminder-test"|>Test reminder<\/button>/);
  assert.match(page, /async function testReminderForId\(id\)/);
  assert.match(page, /await reminder\.testRecord\(id\)/);
  assert.match(page, /createReminderIconButton\('send'/);
});

test('reminder UI renders per-reminder toggles and icon-based CRUD actions', () => {
  const page = renderShellPage('offline', 'Prismata');
  assert.match(page, /id="reminder-list"/);
  assert.doesNotMatch(page, /Scheduled Joystick messages/);
  assert.doesNotMatch(page, /Create scheduled reminders and rotate through a pool of custom messages in order/);
  assert.doesNotMatch(page, /id="reminder-list-status"/);
  assert.doesNotMatch(page, /id="reminder-enabled"|Reminder enabled/);
  assert.match(page, /let editingReminderEnabled = false/);
  assert.match(page, /editingReminderEnabled = settings\?\.enabled === true/);
  assert.match(page, /enabled: editingReminderEnabled/);
  assert.match(page, /renderReminder\(settings \|\| \{ enabled: false,/);
  assert.match(page, /task: 'custom-message', message: '', schedule: 'hourly'/);
  assert.match(page, /id="reminder-add"[^>]*>Add reminder<\/button>/);
  assert.match(page, /role', 'switch'/);
  assert.match(page, /aria-checked', String\(record\.enabled\)/);
  assert.match(page, /metadata\.textContent = scheduleLabel\(record\)/);
  assert.doesNotMatch(page, /scheduleLabel\(record\) \+ ' · ' \+ \(record\.enabled \? 'Enabled' : 'Disabled'\)/);
  assert.match(page, /async function toggleReminder\(record, button\)/);
  assert.match(page, /await reminder\.updateRecord\(record\.id, \{ \.\.\.record, enabled \}\)/);
  assert.match(page, /createReminderIconButton\('edit'/);
  assert.match(page, /createReminderIconButton\('delete'/);
  assert.match(page, /createReminderIconButton\('send'/);
  assert.match(page, /testReminderForId/);
  assert.match(page, /confirm\('Delete this reminder\?'\)/);
  assert.match(page, /reminder\.create/);
  assert.match(page, /reminder\.updateRecord/);
  assert.match(page, /reminder\.remove/);
  assert.match(page, /reminder\.testRecord/);
});
