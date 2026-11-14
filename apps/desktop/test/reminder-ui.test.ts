import assert from 'node:assert/strict';
import test from 'node:test';
import { renderShellPage } from '../electron/shell-page.js';

test('reminder custom-message controls are hidden as one block for coin-flip', () => {
  const page = renderShellPage('offline', 'Prismata');

  assert.match(page, /<div id="reminder-message-controls" hidden><label[^>]*id="reminder-message-label"[^>]*>Custom message<\/label><input[^>]*id="reminder-message"[^>]*disabled/);
  assert.match(page, /function setReminderMessageVisibility\(task\) \{ const visible = task === 'custom-message';/);
  assert.match(page, /\$\('reminder-message-controls'\)\.hidden = !visible; \$\('reminder-message'\)\.disabled = !visible/);
  assert.match(page, /setReminderMessageVisibility\(settings\.task\)/);
  assert.match(page, /onchange = \(\) => setReminderMessageVisibility\(\$\('reminder-task'\)\.value\)/);
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
