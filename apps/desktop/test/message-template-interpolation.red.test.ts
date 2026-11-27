import assert from 'node:assert/strict';
import test from 'node:test';
import { renderShellPage } from '../electron/shell-page.js';
import { createJoystickWhisperRuntime } from '../electron/joystick-whisper-runtime.js';
import { createJoystickWhisperAutomation } from '../src/joystick-whispers.js';

const liveSession = {
  state: 'authenticated' as const,
  accessToken: 'template-test-token',
  grantedPermissions: ['stream:read', 'chat:write', 'chat:whisper:write'],
  login: 'streamer-login',
};

function runtimeFixture(settings: Record<string, unknown>) {
  let gatewayInput: {
    onEvent: (event: unknown) => Promise<void>;
    onStatus: (status: { state: 'connected' | 'reconnecting' | 'unavailable' }) => void;
  } | undefined;
  const publicMessages: string[] = [];
  const runtime = createJoystickWhisperRuntime({
    desktopSettings: {
      getSettings: async () => ({ settings }),
      saveSettings: async (next) => ({ settings: next }),
    },
    auth: { getSession: () => liveSession, onStateChanged: () => () => {} },
    createGateway: (input) => {
      gatewayInput = input;
      return {
        start: async () => {},
        updateAccessToken: async () => {},
        stop: async () => {},
      };
    },
    attemptStore: { claimWhisperAttempt: async () => true },
    sendWhisper: async () => {},
    sendPublicChat: async (_token, text) => { publicMessages.push(text); },
    fetchImpl: async () => new Response(JSON.stringify({ live: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  return {
    runtime,
    publicMessages,
    get gateway() { return gatewayInput!; },
  };
}

async function startLive(fixture: ReturnType<typeof runtimeFixture>) {
  await fixture.runtime.start();
  fixture.gateway.onStatus({ state: 'connected' });
  await fixture.gateway.onEvent({
    v: 2, type: 'started', topic: 'stream.online', id: 'template-test-live', data: {},
  });
}

test('all whisper message templates interpolate the event sender', async () => {
  const sent: Array<{ username: string; text: string }> = [];
  const automation = createJoystickWhisperAutomation({
    rules: {
      followed: { enabled: true, message: 'Follow: {{sender}}' },
      subscribed: { enabled: true, message: 'Subscribe: {{sender}}' },
      resubscribed: { enabled: true, message: 'Resubscribe: {{sender}}' },
      giftSender: { enabled: true, message: 'Gift sender: {{sender}}' },
    },
    getStreamState: () => 'live',
    sendWhisper: async (message) => { sent.push(message); },
  });

  for (const [type, id, who] of [
    ['followed', 'template-follow', 'Ada'],
    ['subscribed', 'template-subscribe', 'Bea'],
    ['resubscribed', 'template-resubscribe', 'Cy'],
    ['gifted_subscriptions', 'template-gift-sender', 'Dee'],
  ]) {
    await automation.handleEvent({ v: 2, type, id, data: { who } }, { subscriptionConfirmed: true });
  }

  assert.deepEqual(sent, [
    { username: 'Ada', text: 'Follow: Ada' },
    { username: 'Bea', text: 'Subscribe: Bea' },
    { username: 'Cy', text: 'Resubscribe: Cy' },
    { username: 'Dee', text: 'Gift sender: Dee' },
  ]);
});

test('Drop-in message templates interpolate only fields present in the Drop-in event context', async () => {
  const fixture = runtimeFixture({
    joystickChatAutomations: {
      dropIn: {
        enabled: true,
        messages: ['Welcome {{sender}}! {{number_of_viewers}} viewers: {{text}} ({{occurred_at}})'],
      },
    },
  });
  await startLive(fixture);
  await fixture.gateway.onEvent({
    v: 2,
    type: 'stream_dropped_in',
    id: 'template-drop-in',
    occurred_at: '2026-11-25T15:30:00.000Z',
    text: 'Ada and friends dropped in!',
    data: { who: 'Ada', number_of_viewers: 4 },
  });

  assert.deepEqual(fixture.publicMessages, [
    'Welcome Ada! 4 viewers: Ada and friends dropped in! (2026-11-25T15:30:00.000Z)',
  ]);
  await fixture.runtime.shutdown();
});

test('slash-command responses interpolate the authenticated author but preserve the unsupported message placeholder', async () => {
  const fixture = runtimeFixture({
    joystickChatAutomations: {
      slashCommands: {
        prefix: '!',
        commands: [
          { name: 'hello', response: 'Hello {{sender}}; trigger: {{message}}', enabled: true },
          { name: 'login', response: 'Welcome {{sender}}', enabled: true },
        ],
      },
    },
  });
  await startLive(fixture);
  await fixture.gateway.onEvent({
    v: 2,
    type: 'new_message',
    topic: 'chat.message',
    id: 'template-slash-command',
    data: {
      visibility: 'public',
      author: {
        username: 'streamer-login',
        display_name: 'Streamer',
        badges: { bot: false, moderator: false },
      },
      text: '!hello stream',
    },
  });
  await fixture.gateway.onEvent({
    v: 2,
    type: 'new_message',
    topic: 'chat.message',
    id: 'template-slash-command-username-fallback',
    data: {
      visibility: 'public',
      author: {
        username: 'streamer-login',
        badges: { bot: false, moderator: false },
      },
      text: '!login',
    },
  });

  assert.ok(fixture.publicMessages[0]?.startsWith('Hello Streamer;'),
    'slash-command responses continue to interpolate {{sender}}');
  assert.deepEqual(fixture.publicMessages, [
    'Hello Streamer; trigger: {{message}}',
    'Welcome streamer-login',
  ]);
  await fixture.runtime.shutdown();
});

test('message fields expose matching variable help by hover/focus and click-to-open modal', () => {
  const page = renderShellPage('ready', 'Prismata');

  assert.ok(/function createMessageVariableInfo\(/.test(page),
    'the shell provides a reusable variable-help control');
  const helpFactoryStart = page.indexOf('function createMessageVariableInfo(');
  const helpFactorySource = page.slice(helpFactoryStart);
  assert.ok(/context/.test(helpFactorySource)
    && /tooltip/.test(helpFactorySource)
    && /dialog/.test(helpFactorySource),
  'the context-specific help factory supplies both tooltip and modal content');
  assert.ok(/role=["']tooltip["']/.test(page),
    'variable help is available as a tooltip');
  assert.ok(/role=["']dialog["']/.test(page),
    'the same help can be opened in a dialog');
  assert.ok(/mouseenter|mouseover/.test(page),
    'hovering the info icon reveals its tooltip');
  assert.ok(/onfocus|focus/.test(page),
    'keyboard focus reveals its tooltip');
  assert.ok(/onclick|click/.test(page),
    'activating the info icon opens the dialog');

  for (const context of ['whisper', 'drop-in', 'slash-command']) {
    assert.ok(new RegExp(`createMessageVariableInfo\\(['"]${context}['"]\\)`).test(page),
      `${context} message fields use context-specific variable help`);
  }
  for (const variable of ['sender', 'number_of_viewers', 'occurred_at']) {
    assert.ok(page.includes(variable), `variable help documents {{${variable}}}`);
  }
  const slashCommandHelp = page.match(/['"]slash-command['"]:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  assert.ok(slashCommandHelp.includes('{{sender}}'),
    'slash-command help continues to document {{sender}}');
  assert.ok(!slashCommandHelp.includes('{{message}}'),
    'slash-command help does not list {{message}}');
  assert.ok(/\{\{\s*sender\s*\}\}.{0,180}(viewer|display name|username)/i.test(page),
    'sender help describes the human-facing viewer/author value');
  assert.ok(/\{\{\s*number_of_viewers\s*\}\}.{0,180}(viewer|Drop-in|dropped in)/i.test(page),
    'Drop-in viewer-count help describes its event context');
  assert.ok(/\{\{\s*occurred_at\s*\}\}.{0,180}(occurred|timestamp|time)/i.test(page),
    'Drop-in timestamp help describes when the event occurred');
  assert.ok(!page.includes('{{who}}'), 'help does not expose the internal data.who field name');
  assert.ok(!page.includes('{{author}}'), 'help does not expose the internal author object as a template variable');
});
