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

test('reminder message pool supports ordered add/remove editing and requires a nonblank message', () => {
  const page = renderShellPage('offline', 'Prismata');

  assert.match(page, /function renderReminderMessages\(messages\)/);
  assert.match(page, /values\.forEach\(\(message, index\)/);
  assert.match(page, /messages\.push\(''\)/);
  assert.match(page, /next\.splice\(index, 1\)/);
  assert.match(page, /messages\.length >= 10/);
  assert.match(page, /Add at least one custom message/);
});

test('reminder UI has a manual test button and reports success or failure without saving', () => {
  const page = renderShellPage('offline', 'Prismata');
  assert.match(page, /id="reminder-test"[^>]*>Test reminder<\/button>/);
  assert.match(page, /async function testReminder\(\)/);
  assert.match(page, /await reminder\.test\(/);
  assert.match(page, /Reminder sent\./);
  assert.match(page, /Unable to send reminder/);
  assert.match(page, /\$\('reminder-test'\)\.onclick = testReminder/);
});

test('reminder UI renders the multi-reminder list and CRUD actions', () => {
  const page = renderShellPage('offline', 'Prismata');
  assert.match(page, /id="reminder-list"/);
  assert.match(page, /id="reminder-add"[^>]*>Add reminder<\/button>/);
  assert.match(page, /label === 'Edit'/);
  assert.match(page, /label === 'Delete'/);
  assert.match(page, /testReminderForId/);
  assert.match(page, /confirm\('Delete this reminder\?'\)/);
  assert.match(page, /reminder\.create/);
  assert.match(page, /reminder\.updateRecord/);
  assert.match(page, /reminder\.remove/);
  assert.match(page, /reminder\.testRecord/);
});
