import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as preloadApiBoundary from '../electron/preload-api.js';
import * as runtimeBoundary from '../electron/joystick-whisper-runtime.js';
import { renderShellPage } from '../electron/shell-page.js';

type Session = {
  state: 'authenticated';
  accessToken: string;
  grantedPermissions: string[];
  login?: string;
};
type PublicSend = (accessToken: string, text: string) => Promise<unknown>;
type GatewayInput = {
  onEvent: (event: unknown) => Promise<void>;
  onStatus: (status: { state: 'connected' | 'reconnecting' | 'unavailable' }) => void;
};
type RuntimeOptions = {
  desktopSettings: {
    getSettings: () => Promise<{ settings: Record<string, unknown> }>;
    saveSettings: (settings: Record<string, unknown>) => Promise<{ settings: Record<string, unknown> }>;
  };
  auth: {
    getSession: () => Session | null;
    onStateChanged: (listener: () => void) => () => void;
  };
  createGateway: (input: GatewayInput) => {
    start: () => Promise<void>;
    updateAccessToken: (token: string | undefined) => Promise<void>;
    stop: () => Promise<void>;
  };
  attemptStore: { claimWhisperAttempt: () => Promise<boolean> };
  sendWhisper: () => Promise<void>;
  sendPublicChat?: PublicSend;
  now?: () => number;
};
type Runtime = {
  start: () => Promise<void>;
  shutdown: () => Promise<void>;
  getStatus: () => { stream: { state: string } };
};

const createRuntime = (runtimeBoundary as unknown as {
  createJoystickWhisperRuntime?: (options: RuntimeOptions) => Runtime;
}).createJoystickWhisperRuntime;

const defaultSlashCommands = {
  prefix: '!',
  commands: [{ name: 'toy', response: 'Use !toy to learn about the stream', enabled: true }],
};

function publicChatEvent(id: string, text: string, options: {
  username?: string;
  bot?: boolean;
  visibility?: string;
  type?: string;
  topic?: string;
  topLevelText?: boolean;
} = {}) {
  return {
    v: 2,
    type: options.type ?? 'new_message',
    topic: options.topic ?? 'chat.message',
    id,
    channel_id: 'channel-1',
    occurred_at: '2026-11-05T12:00:00Z',
    data: {
      author: {
        username: options.username ?? `viewer-${id}`,
        display_name: 'Viewer',
        badges: { bot: options.bot ?? false, moderator: false },
      },
      streamer: { username: 'streamer-login' },
      ...(!options.topLevelText ? { text } : {}),
      visibility: options.visibility ?? 'public',
    },
    ...(options.topLevelText ? { text } : {}),
  };
}

function liveEvent() {
  return {
    v: 2,
    type: 'started',
    topic: 'stream.online',
    id: 'stream-live',
    data: {},
  };
}

function runtimeFixture(input: {
  settings?: Record<string, unknown>;
  session?: Session | null;
  beforeSettingsRead?: () => Promise<void> | void;
  sendPublicChat?: PublicSend;
  now?: () => number;
} = {}) {
  let settings = input.settings ?? {
    joystickChatAutomations: {
      dropIn: { enabled: false, messages: [] },
      slashCommands: defaultSlashCommands,
    },
  };
  let session: Session | null = input.session === undefined ? {
    state: 'authenticated',
    accessToken: 'stream-token',
    grantedPermissions: ['stream:read', 'chat:write'],
    login: 'streamer-login',
  } : input.session;
  let gatewayInput: GatewayInput | undefined;
  const sent: Array<{ accessToken: string; text: string }> = [];
  const runtime = createRuntime!({
    desktopSettings: {
      getSettings: async () => {
        await input.beforeSettingsRead?.();
        return { settings };
      },
      saveSettings: async (next) => {
        settings = next;
        return { settings };
      },
    },
    auth: {
      getSession: () => session,
      onStateChanged: () => () => {},
    },
    createGateway: (next) => {
      gatewayInput = next;
      return {
        start: async () => {},
        updateAccessToken: async () => {},
        stop: async () => {},
      };
    },
    attemptStore: { claimWhisperAttempt: async () => true },
    sendWhisper: async () => {},
    sendPublicChat: input.sendPublicChat ?? (async (accessToken, text) => {
      sent.push({ accessToken, text });
    }),
    now: input.now,
  });

  return {
    runtime,
    sent,
    get gateway() { return gatewayInput!; },
    setSession(next: Session | null) { session = next; },
    setSettings(next: Record<string, unknown>) { settings = next; },
  };
}

async function startLiveRuntime(fixture: ReturnType<typeof runtimeFixture>) {
  await fixture.runtime.start();
  fixture.gateway.onStatus({ state: 'connected' });
  await fixture.gateway.onEvent(liveEvent());
  assert.equal(fixture.runtime.getStatus().stream.state, 'live');
}

test('public command matching is case-insensitive, trims input, ignores trailing text, and requires an exact first token', async () => {
  const fixture = runtimeFixture();
  await startLiveRuntime(fixture);
  for (const [id, text] of [
    ['partial-name', '!toys'],
    ['punctuation-suffix', '!toy,'],
    ['missing-name', '! toy'],
    ['private-message', '!toy'],
    ['other-event', '!toy', 'followed'],
    ['other-topic', '!toy', undefined, 'stream.online'],
  ] as Array<[string, string, string?, string?]>) {
    await fixture.gateway.onEvent(publicChatEvent(id, text, {
      visibility: id === 'private-message' ? 'private' : undefined,
      type: text === '!toy' ? id === 'other-event' ? 'followed' : 'new_message' : undefined,
      topic: id === 'other-topic' ? 'stream.online' : undefined,
    }));
  }
  await fixture.gateway.onEvent(publicChatEvent('valid-with-trailing-text', '  !TOY extra words are ignored  '));

  assert.deepEqual(fixture.sent, [{
    accessToken: 'stream-token',
    text: 'Use !toy to learn about the stream',
  }], 'only the fixed configured response is sent for the entire case-insensitive first token');
  await fixture.runtime.shutdown();
});

test('public command matching reads top-level Joystick v2 text for an eligible viewer', async () => {
  const fixture = runtimeFixture({
    settings: { joystickChatAutomations: {
      dropIn: { enabled: false, messages: [] },
      slashCommands: {
        prefix: '!',
        commands: [{ name: 'info', response: 'Here is the configured stream info', enabled: true }],
      },
    } },
  });
  await startLiveRuntime(fixture);
  await fixture.gateway.onEvent(publicChatEvent('viewer-top-level-text', '!info', { topLevelText: true }));

  assert.deepEqual(fixture.sent, [{
    accessToken: 'stream-token',
    text: 'Here is the configured stream info',
  }], 'the public viewer event top-level text triggers only its configured response');
  await fixture.runtime.shutdown();
});

test('bot messages stay ignored while the authenticated streamer can trigger public commands', async () => {
  const fixture = runtimeFixture();
  await startLiveRuntime(fixture);
  await fixture.gateway.onEvent(publicChatEvent('bot', '!toy', { bot: true }));
  await fixture.gateway.onEvent(publicChatEvent('streamer-self', '!toy', {
    username: ' STREAMER-LOGIN ',
    topLevelText: true,
  }));
  assert.deepEqual(fixture.sent.map(({ text }) => text), ['Use !toy to learn about the stream'],
    'the bot is ignored and the authenticated streamer command sends its configured response');
  await fixture.runtime.shutdown();
});

test('an echoed streamer command response can trigger another public command', async () => {
  let fixture!: ReturnType<typeof runtimeFixture>;
  let echoedResponse = false;
  fixture = runtimeFixture({
    settings: { joystickChatAutomations: {
      dropIn: { enabled: false, messages: [] },
      slashCommands: {
        prefix: '!',
        commands: [
          { name: 'info', response: '!rules', enabled: true },
          { name: 'rules', response: 'These are the stream rules', enabled: true },
        ],
      },
    } },
    sendPublicChat: async (accessToken, text) => {
      fixture.sent.push({ accessToken, text });
      if (text === '!rules' && !echoedResponse) {
        echoedResponse = true;
        await fixture.gateway.onEvent(publicChatEvent('prismata-response-echo', text, {
          username: 'streamer-login',
          topLevelText: true,
        }));
      }
    },
  });
  await startLiveRuntime(fixture);
  await fixture.gateway.onEvent(publicChatEvent('streamer-info-command', '!info', {
    username: 'streamer-login',
    topLevelText: true,
  }));

  assert.deepEqual(fixture.sent, [
    { accessToken: 'stream-token', text: '!rules' },
    { accessToken: 'stream-token', text: 'These are the stream rules' },
  ], 'the authenticated streamer echo triggers the matching configured !rules response');
  await fixture.runtime.shutdown();
});

test('command delivery requires an enabled command, both permissions, and an exactly live stream', async (t) => {
  await t.test('disabled commands do not send', async () => {
    const fixture = runtimeFixture({ settings: { joystickChatAutomations: {
      slashCommands: { ...defaultSlashCommands, commands: [{ ...defaultSlashCommands.commands[0], enabled: false }] },
    } } });
    await startLiveRuntime(fixture);
    await fixture.gateway.onEvent(publicChatEvent('disabled', '!toy'));
    assert.deepEqual(fixture.sent, []);
    await fixture.runtime.shutdown();
  });

  await t.test('missing chat:write does not send', async () => {
    const fixture = runtimeFixture({ session: {
      state: 'authenticated', accessToken: 'stream-token', grantedPermissions: ['stream:read'], login: 'streamer-login',
    } });
    await startLiveRuntime(fixture);
    await fixture.gateway.onEvent(publicChatEvent('no-chat-write', '!toy'));
    assert.deepEqual(fixture.sent, []);
    await fixture.runtime.shutdown();
  });

  await t.test('missing stream:read does not send', async () => {
    const fixture = runtimeFixture({ session: {
      state: 'authenticated', accessToken: 'stream-token', grantedPermissions: ['chat:write'], login: 'streamer-login',
    } });
    await fixture.runtime.start();
    fixture.gateway.onStatus({ state: 'connected' });
    await fixture.gateway.onEvent(liveEvent());
    await fixture.gateway.onEvent(publicChatEvent('no-stream-read', '!toy'));
    assert.deepEqual(fixture.sent, []);
    await fixture.runtime.shutdown();
  });

  await t.test('offline streams do not send', async () => {
    const fixture = runtimeFixture();
    await fixture.runtime.start();
    fixture.gateway.onStatus({ state: 'connected' });
    await fixture.gateway.onEvent(publicChatEvent('offline', '!toy'));
    assert.deepEqual(fixture.sent, []);
    await fixture.runtime.shutdown();
  });
});

test('permission and live state are rechecked after settings load and immediately before delivery', async (t) => {
  await t.test('revoked chat:write blocks the pending trigger', async () => {
    let fixture!: ReturnType<typeof runtimeFixture>;
    fixture = runtimeFixture({
      beforeSettingsRead: () => fixture.setSession({
        state: 'authenticated', accessToken: 'stream-token', grantedPermissions: ['stream:read'], login: 'streamer-login',
      }),
    });
    await startLiveRuntime(fixture);
    await fixture.gateway.onEvent(publicChatEvent('permission-race', '!toy'));
    assert.deepEqual(fixture.sent, []);
    await fixture.runtime.shutdown();
  });

  await t.test('a stream that stops before delivery blocks the pending trigger', async () => {
    let fixture!: ReturnType<typeof runtimeFixture>;
    fixture = runtimeFixture({
      beforeSettingsRead: async () => fixture.gateway.onEvent({
        v: 2, type: 'ended', topic: 'stream.offline', id: 'stream-stopped', data: {},
      }),
    });
    await startLiveRuntime(fixture);
    await fixture.gateway.onEvent(publicChatEvent('live-race', '!toy'));
    assert.deepEqual(fixture.sent, []);
    await fixture.runtime.shutdown();
  });
});

test('per-command cooldown is shared across viewers, starts before failed delivery, and lasts five seconds', async () => {
  let now = 10_000;
  let attempts = 0;
  let fixture!: ReturnType<typeof runtimeFixture>;
  fixture = runtimeFixture({
    settings: { joystickChatAutomations: { slashCommands: {
      prefix: '!',
      commands: [
        { name: 'toy', response: 'Toy response', enabled: true },
        { name: 'rules', response: 'Rules response', enabled: true },
      ],
    } } },
    now: () => now,
    sendPublicChat: async (_accessToken, text) => {
      attempts += 1;
      if (attempts === 1) throw new Error(`uncertain delivery: ${text}`);
      fixture.sent.push({ accessToken: _accessToken, text });
    },
  });
  await startLiveRuntime(fixture);
  await fixture.gateway.onEvent(publicChatEvent('first-viewer', '!toy', { username: 'alice' }));
  now += 4_999;
  await fixture.gateway.onEvent(publicChatEvent('second-viewer', '!toy', { username: 'bob' }));
  assert.equal(attempts, 1, 'failed delivery still starts a command-wide cooldown shared by viewers');
  await fixture.gateway.onEvent(publicChatEvent('different-command', '!rules', { username: 'alice' }));
  assert.equal(attempts, 2, 'a different command has an independent cooldown');

  now += 1;
  await fixture.gateway.onEvent(publicChatEvent('third-viewer', '!toy', { username: 'carol' }));
  assert.equal(attempts, 3, 'a new trigger is eligible at the five-second boundary');
  assert.deepEqual(fixture.sent, [
    { accessToken: 'stream-token', text: 'Rules response' },
    { accessToken: 'stream-token', text: 'Toy response' },
  ]);
  await fixture.runtime.shutdown();
});

test('recent Gateway event IDs are deduplicated across command names', async () => {
  const fixture = runtimeFixture({ settings: { joystickChatAutomations: {
    slashCommands: {
      prefix: '!',
      commands: [
        { name: 'toy', response: 'Toy response', enabled: true },
        { name: 'rules', response: 'Rules response', enabled: true },
      ],
    },
  } } });
  await startLiveRuntime(fixture);
  await fixture.gateway.onEvent(publicChatEvent('replayed-event-id', '!toy'));
  await fixture.gateway.onEvent(publicChatEvent('replayed-event-id', '!rules'));
  assert.deepEqual(fixture.sent.map(({ text }) => text), ['Toy response']);
  await fixture.runtime.shutdown();
});

test('slash command preload contract exposes only typed settings operations', async () => {
  const createApi = (preloadApiBoundary as unknown as {
    createJoystickChatAutomationPreloadApi?: (input: {
      getSettings: () => Promise<Record<string, unknown>>;
      updateSettings: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }) => Record<string, unknown>;
  }).createJoystickChatAutomationPreloadApi;
  assert.equal(typeof createApi, 'function', 'command editing reuses the typed chat-automation settings boundary');
  const settings = {
    dropIn: { enabled: false, messages: [] },
    slashCommands: { prefix: '!', commands: [] },
  };
  const api = createApi!({
    getSettings: async () => settings,
    updateSettings: async (next) => next,
  });
  assert.deepEqual(Object.keys(api).sort(), ['getSettings', 'updateSettings']);
  assert.deepEqual(await (api.getSettings as () => Promise<Record<string, unknown>>)(), settings);
  assert.equal('sendPublicChat' in api, false);
  assert.equal('accessToken' in api, false);
  assert.equal('rawEvent' in api, false);
});

test('Automations exposes bounded slash-command editor controls through settings IPC only', async () => {
  const page = renderShellPage('ready', 'Prismata desktop');
  assert.ok(page.includes('Slash commands'), 'Automations labels the command editor');
  assert.ok(page.includes('id="slash-command-prefix"'), 'the global prefix has an editor control');
  assert.ok(page.includes('id="slash-command-list"'), 'commands have an editor list');
  assert.ok(page.includes('id="slash-command-add"'), 'the editor can add a command');
  assert.ok(!page.includes('Requires Joystick sign-in, stream:read, chat:write, and a live stream'),
    'the shell omits explanatory command delivery requirements');
  assert.ok(page.includes('textarea.maxLength = 500'), 'responses are bounded to the public chat limit');

  const main = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /joystick-chat-automations:get-settings/);
  assert.match(main, /joystick-chat-automations:update-settings/);
  assert.doesNotMatch(main, /joystick-chat-automations:send/);
});
