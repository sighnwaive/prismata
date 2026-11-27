import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeJoystickChatAutomationSettings } from '../src/joystick-chat-automations.js';
import * as runtimeBoundary from '../electron/joystick-whisper-runtime.js';

type Session = {
  state: 'authenticated';
  accessToken: string;
  grantedPermissions: string[];
  login?: string;
  userId?: string;
  identity?: { id?: string; login?: string };
};
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
  sendPublicChat: (accessToken: string, text: string) => Promise<unknown>;
  beforeSettingsRead?: () => Promise<void> | void;
};
type Runtime = {
  start: () => Promise<void>;
  shutdown: () => Promise<void>;
  getStatus: () => { stream: { state: string } };
};

const createRuntime = (runtimeBoundary as unknown as {
  createJoystickWhisperRuntime?: (options: RuntimeOptions) => Runtime;
}).createJoystickWhisperRuntime;

const defaultSettings = {
  joystickChatAutomations: {
    slashCommands: {
      prefix: '!',
      commands: [
        { name: 'toy', response: 'Toy response', enabled: true },
        { name: 'rules', response: 'Rules response', enabled: true },
      ],
    },
  },
};

function publicChatEvent(id: unknown, token: string, options: {
  payload?: 'text' | 'message' | 'message-text';
  author?: Record<string, unknown>;
} = {}) {
  const data: Record<string, unknown> = {
    author: {
      username: 'viewer',
      badges: { bot: false, moderator: false },
      ...options.author,
    },
    streamer: { username: 'streamer-login' },
    visibility: 'public',
  };
  if (options.payload === 'message') data.message = token;
  else if (options.payload === 'message-text') data.message = { text: token };
  else data.text = token;

  return {
    v: 2,
    type: 'new_message',
    topic: 'chat.message',
    ...(id === undefined ? {} : { id }),
    channel_id: 'channel-1',
    occurred_at: '2026-11-05T12:00:00Z',
    data,
  };
}

function liveEvent() {
  return { v: 2, type: 'started', topic: 'stream.online', id: 'stream-live', data: {} };
}

function runtimeFixture(input: {
  settings?: Record<string, unknown>;
  session?: Session | null;
  beforeSettingsRead?: () => Promise<void> | void;
} = {}) {
  let settings = input.settings ?? defaultSettings;
  const session: Session | null = input.session === undefined ? {
    state: 'authenticated',
    accessToken: 'stream-token',
    grantedPermissions: ['stream:read', 'chat:write'],
    login: 'streamer-login',
  } : input.session;
  let gatewayInput: GatewayInput | undefined;
  const sent: string[] = [];
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
    sendPublicChat: async (_accessToken, text) => { sent.push(text); },
  });

  return {
    runtime,
    sent,
    get gateway() { return gatewayInput!; },
  };
}

async function startLiveRuntime(fixture: ReturnType<typeof runtimeFixture>) {
  await fixture.runtime.start();
  fixture.gateway.onStatus({ state: 'connected' });
  await fixture.gateway.onEvent(liveEvent());
  assert.equal(fixture.runtime.getStatus().stream.state, 'live');
}

test('public command matching accepts both message payload shapes supported by the chat feed parser', async (t) => {
  for (const [name, payload] of [
    ['data.message string', 'message'],
    ['data.message.text', 'message-text'],
  ] as const) {
    await t.test(name, async () => {
      const fixture = runtimeFixture();
      await startLiveRuntime(fixture);
      await fixture.gateway.onEvent(publicChatEvent(`payload-${payload}`, '!toy', { payload }));
      assert.deepEqual(fixture.sent, ['Toy response'],
        'a supported public chat message payload still triggers the matching configured command');
      await fixture.runtime.shutdown();
    });
  }
});

test('command delivery fails closed when the Gateway event ID is missing or malformed', async (t) => {
  for (const [name, id] of [
    ['missing', undefined],
    ['blank', '   '],
    ['non-string', 42],
    ['overlong', 'x'.repeat(513)],
  ] as const) {
    await t.test(name, async () => {
      const fixture = runtimeFixture();
      await startLiveRuntime(fixture);
      await fixture.gateway.onEvent(publicChatEvent(id, '!toy'));
      assert.deepEqual(fixture.sent, [],
        'a command trigger without a valid event ID must not be delivered');
      await fixture.runtime.shutdown();
    });
  }
});

test('duplicate delivery is reserved before asynchronous settings lookup', async () => {
  let releaseFirstSettingsRead!: () => void;
  let firstSettingsReadStarted!: () => void;
  let settingsReadCount = 0;
  const firstReadStarted = new Promise<void>((resolve) => { firstSettingsReadStarted = resolve; });
  const fixture = runtimeFixture({
    beforeSettingsRead: () => {
      settingsReadCount += 1;
      if (settingsReadCount > 1) return;
      return new Promise<void>((resolve) => {
        releaseFirstSettingsRead = resolve;
        firstSettingsReadStarted();
      });
    },
  });
  await startLiveRuntime(fixture);

  const firstDelivery = fixture.gateway.onEvent(publicChatEvent('same-event', '!toy'));
  await firstReadStarted;
  const duplicateDelivery = fixture.gateway.onEvent(publicChatEvent('same-event', '!rules'));
  await duplicateDelivery;
  releaseFirstSettingsRead();
  await firstDelivery;

  assert.deepEqual(fixture.sent, ['Toy response'],
    'the first delivery claims the event ID before a duplicate with another token can race settings lookup');
  await fixture.runtime.shutdown();
});

test('command delivery fails closed when self-message filtering has no trusted identity basis', async () => {
  const fixture = runtimeFixture({
    session: {
      state: 'authenticated',
      accessToken: 'stream-token',
      grantedPermissions: ['stream:read', 'chat:write'],
    },
  });
  await startLiveRuntime(fixture);
  await fixture.gateway.onEvent(publicChatEvent('no-identity', '!toy'));
  assert.deepEqual(fixture.sent, [],
    'without an authenticated streamer login or a usable message author ID, self-message filtering is untrusted');
  await fixture.runtime.shutdown();
});

test('slash command prefixes accept one Unicode punctuation character but reject non-punctuation and multiple characters', () => {
  const normalizePrefix = (prefix: string) => {
    const settings = normalizeJoystickChatAutomationSettings({
      slashCommands: { prefix, commands: [] },
    }) as { slashCommands: { prefix: string } };
    return settings.slashCommands.prefix;
  };

  assert.equal(normalizePrefix('—'), '—', 'a single Unicode punctuation prefix is valid');
  for (const prefix of ['a', ' ', '!!']) {
    assert.equal(normalizePrefix(prefix), '!', `${JSON.stringify(prefix)} is not a valid single punctuation prefix`);
  }
});
