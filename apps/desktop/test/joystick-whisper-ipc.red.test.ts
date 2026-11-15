import assert from 'node:assert/strict';
import test from 'node:test';
import * as preloadApi from '../electron/preload-api.js';
import { renderShellPage } from '../electron/shell-page.js';

type WhisperSettings = Record<string, { enabled: boolean; message: string }>;
type WhisperStatus = {
  connection: { state: 'connected' | 'reconnecting' | 'unavailable'; message: string | null };
  delivery: {
    state: 'idle' | 'sent' | 'failed';
    rule: 'followed' | 'subscribed' | 'resubscribed' | 'giftSender' | null;
    message: string | null;
  };
};
type WhisperPreloadApi = {
  getSettings: () => Promise<WhisperSettings>;
  updateSettings: (settings: WhisperSettings) => Promise<WhisperSettings>;
  getStatus: () => Promise<WhisperStatus>;
  onStatusChanged: (listener: (status: WhisperStatus) => void) => () => void;
};

test('typed whisper preload API exposes only settings and sanitized connection status', async () => {
  const createApi = (preloadApi as unknown as { createJoystickWhisperPreloadApi?: (input: WhisperPreloadApi) => WhisperPreloadApi }).createJoystickWhisperPreloadApi;
  assert.equal(typeof createApi, 'function', 'preload must define the typed whisper API boundary');
  const settings: WhisperSettings = {
    followed: { enabled: true, message: 'Follow message' },
    subscribed: { enabled: false, message: 'Subscription message' },
    resubscribed: { enabled: true, message: 'Resubscription message' },
    giftSender: { enabled: false, message: 'Gift sender message' },
  };
  const status: WhisperStatus = {
    connection: { state: 'reconnecting', message: 'Waiting to reconnect' },
    delivery: { state: 'failed', rule: 'followed', message: 'Unable to send whisper.' },
  };
  const api = createApi!({
    getSettings: async () => settings,
    updateSettings: async (next) => next,
    getStatus: async () => status,
    onStatusChanged: () => () => {},
  });

  assert.deepEqual(Object.keys(api).sort(), ['getSettings', 'getStatus', 'onStatusChanged', 'updateSettings']);
  assert.deepEqual(await api.getSettings(), settings);
  assert.deepEqual(await api.getStatus(), status);
  assert.deepEqual(Object.keys(await api.getStatus()).sort(), ['connection', 'delivery']);
  assert.deepEqual(Object.keys((await api.getStatus()).connection).sort(), ['message', 'state']);
  assert.deepEqual(Object.keys((await api.getStatus()).delivery).sort(), ['message', 'rule', 'state']);
  assert.equal('accessToken' in api, false);
  assert.equal('rawEvent' in api, false);
  assert.equal('sendWhisper' in api, false);
});

test('desktop shell offers independent whisper controls without gateway status copy', () => {
  const html = renderShellPage('ready', 'Prismata desktop');
  for (const rule of ['followed', 'subscribed', 'resubscribed', 'gift-sender']) {
    const enabledId = `whisper-${rule}-enabled`;
    const messageId = `whisper-${rule}-message`;
    const enabledMatches = html.match(new RegExp(`id="${enabledId}"`, 'g')) ?? [];
    assert.equal(enabledMatches.length, 1, `${rule} must have its own enable control`);
    const enabledInput = html.match(new RegExp(`<input\\b[^>]*id="${enabledId}"[^>]*>`))?.[0] ?? '';
    assert.match(enabledInput, /type="checkbox"/, `${rule} must be independently toggleable`);
    assert.match(html, new RegExp(`for="${enabledId}"`), `${rule} toggle must have an associated label`);
    assert.match(html, new RegExp(`id="${messageId}"`), `${rule} must have its own message control`);
    assert.match(html, new RegExp(`for="${messageId}"`), `${rule} message must have an associated label`);
  }
  assert.doesNotMatch(html, /Connection unavailable|Connected to Joystick events|reconnecting/i);
  assert.doesNotMatch(html, /Whispers run only while Prismata is running and connected/);
  assert.doesNotMatch(html, /Events received while offline or disconnected are not caught up/);
  assert.doesNotMatch(html, /id="whisper-settings-status"|Whisper settings saved locally\./);
});

test('Automations UI configures multiple ordered public messages for live Drop-in events', () => {
  const html = renderShellPage('ready', 'Prismata desktop');
  assert.match(html, />New follower whisper<\/label>/);
  assert.match(html, />New subscription \/ gift recipients whisper<\/label>/);
  assert.match(html, />Resubscription whisper<\/label>/);
  assert.match(html, />Gift sender whisper<\/label>/);
  assert.match(html, /Drop-in public chat/);
  assert.match(html, /Send up to 10 messages in order when a viewer drops in/);
  assert.match(html, /Requires chat:write and a live stream/);
  assert.match(html, /id="drop-in-chat-enabled" type="checkbox" role="switch"/);
  assert.match(html, />Drop-in chat messages<\/label>/);
  assert.doesNotMatch(html, />Enable Drop-in chat messages<\/label>/);
  for (const id of ['whisper-followed-enabled', 'whisper-subscribed-enabled', 'whisper-resubscribed-enabled', 'whisper-gift-sender-enabled']) {
    assert.match(html, new RegExp(`id="${id}" type="checkbox" role="switch"`));
  }
  assert.match(html, /\.whisper-rule input\[type="checkbox"\]:checked/);
  assert.match(html, /\.whisper-rule > label \{ align-self: start; \}/);
  assert.match(html, /section\[aria-label="Automations"\] > \.whisper-rule:first-of-type \{ border-top: 0; \}/);
  assert.match(html, /#drop-in-chat-enabled:checked/);
  assert.match(html, /id="drop-in-message-list"/);
  assert.match(html, /id="drop-in-message-add"[^>]*>Add message/);
  assert.doesNotMatch(html, /id="drop-in-chat-status"|Drop-in chat automation saved\./);
  assert.match(html, /row\.append\(field\);\s*if \(index > 0\)/);
  assert.match(html, /textarea\.maxLength = 500/);
  assert.match(html, /messages\.length >= 10/);
  assert.match(html, /joystickChatAutomations\.updateSettings\(snapshot\)/);
});

test('typed chat automation preload API exposes only normalized settings operations', async () => {
  const createApi = (preloadApi as unknown as {
    createJoystickChatAutomationPreloadApi?: (input: {
      getSettings: () => Promise<{ dropIn: { enabled: boolean; messages: string[] } }>;
      updateSettings: (settings: { dropIn: { enabled: boolean; messages: string[] } }) => Promise<{ dropIn: { enabled: boolean; messages: string[] } }>;
    }) => { getSettings: () => Promise<{ dropIn: { enabled: boolean; messages: string[] } }>; updateSettings: (settings: { dropIn: { enabled: boolean; messages: string[] } }) => Promise<{ dropIn: { enabled: boolean; messages: string[] } }> };
  }).createJoystickChatAutomationPreloadApi;
  assert.equal(typeof createApi, 'function');
  const settings = { dropIn: { enabled: true, messages: ['Welcome!', 'Enjoy!'] } };
  const api = createApi!({ getSettings: async () => settings, updateSettings: async (next) => next });
  assert.deepEqual(Object.keys(api).sort(), ['getSettings', 'updateSettings']);
  assert.deepEqual(await api.getSettings(), settings);
  assert.deepEqual(await api.updateSettings(settings), settings);
  assert.equal('sendPublicChat' in api, false);
});
