import assert from 'node:assert/strict';
import test from 'node:test';
import { createDirectMessageSender, normalizeDirectMessage } from '../src/direct-message.js';
import { createDirectMessagePreloadApi, type DirectMessagePreloadApi } from '../electron/preload-api.js';
import { renderShellPage } from '../electron/shell-page.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('direct message validation rejects empty input and bounds while preserving text', () => {
  assert.throws(() => normalizeDirectMessage(' \n\t '), /message is required/i);
  const text = '  hello\nworld  ';
  assert.equal(normalizeDirectMessage(text), text);
  assert.throws(() => normalizeDirectMessage('x'.repeat(501)), /500 characters/i);
});

test('direct message sender bypasses reminder settings and sends authenticated text immediately', async () => {
  const sent: string[] = [];
  const recorded: Array<{ text: string; response: unknown }> = [];
  const sender = createDirectMessageSender({
    getAccessToken: () => 'session-token',
    getStreamState: () => 'live',
    onMessageSent: (text, response) => recorded.push({ text, response }),
    createClient: () => ({ sendMessage: async ({ text }: { text: string }) => { sent.push(text); return { id: 'server-message' }; } }),
  });
  await sender('  send this now  ');
  assert.deepEqual(sent, ['  send this now  ']);
  assert.deepEqual(recorded, [{ text: '  send this now  ', response: { id: 'server-message' } }]);
});

test('direct message sender reports missing authentication without logging text or token', async () => {
  const diagnostics: string[] = [];
  const sender = createDirectMessageSender({ getAccessToken: () => undefined, getStreamState: () => 'live', log: (message) => diagnostics.push(message) });
  await assert.rejects(sender('private text'), /authenticated Joystick session unavailable/i);
  assert.deepEqual(diagnostics, ['Direct message skipped: authenticated Joystick session unavailable']);
  assert.doesNotMatch(diagnostics.join(' '), /private text|token/i);
});

test('direct message preload contract exposes only send', async () => {
  const calls: string[] = [];
  const api: DirectMessagePreloadApi = createDirectMessagePreloadApi({ send: async (text) => { calls.push(text); return { ok: true }; } });
  assert.deepEqual(await api.send('hello'), { ok: true });
  assert.deepEqual(calls, ['hello']);
  assert.deepEqual(Object.keys(api), ['send']);
});

test('direct message IPC and UI wiring are narrow and independent from reminders', () => {
  const preload = readFileSync(fileURLToPath(new URL('../electron/preload.mjs', import.meta.url)), 'utf8');
  const main = readFileSync(fileURLToPath(new URL('../electron/main.mjs', import.meta.url)), 'utf8');
  const page = renderShellPage('offline', 'Prismata');
  const firstPanel = page.indexOf('<section class="empty-panel"');
  const directMessagePanel = page.indexOf('<section aria-label="Direct message">');
  const streamActivityPanel = page.indexOf('<section aria-label="Stream activity">');
  const automationPanel = page.indexOf('<section aria-label="Automations">');
  assert.ok(firstPanel >= 0 && directMessagePanel > firstPanel && directMessagePanel < automationPanel,
    'Direct message should be the second top-level panel, immediately after the header panel');
  assert.ok(streamActivityPanel > directMessagePanel && streamActivityPanel < automationPanel,
    'Stream activity should appear one panel before Automations');
  assert.equal((page.slice(firstPanel, directMessagePanel).match(/<section\b/g) ?? []).length, 1,
    'no other panel should appear between the header and Direct message');
  assert.match(preload, /ipcRenderer\.invoke\('direct-message:send', text\)/);
  assert.match(main, /ipcMain\.handle\('direct-message:send'/);
  assert.doesNotMatch(page, /Send a message now|Send immediately to your authenticated Joystick chat|Message sent\./);
  assert.match(page, /id="direct-message-input"/);
  assert.match(page, /<div class="direct-message-composer"><textarea id="direct-message-input"[^>]*><\/textarea><button id="direct-message-send"[^>]*>Send Message<\/button><\/div>/);
  assert.match(page, /directMessage\.send/);
  assert.match(page, /event\.key !== 'Enter' \|\| event\.shiftKey \|\| event\.isComposing/);
  assert.match(page, /event\.preventDefault\(\); void sendDirectMessage\(\)/);
  assert.match(page, /status\.textContent = ''/);
  assert.match(page, /Unable to send message/);
});

test('direct message textarea fills its section without horizontal overflow', () => {
  const page = renderShellPage('offline', 'Prismata');
  assert.match(page, /input,\s*textarea\s*\{[^}]*width:\s*100%;[^}]*box-sizing:\s*border-box;/s);
  assert.match(page, /\.direct-message-composer \{ display: flex; align-items: stretch; gap: 10px; \}/);
  assert.match(page, /\.direct-message-composer textarea \{ flex: 1 1 0; width: 0; min-width: 0; \}/);
});
