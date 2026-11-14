import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createAuthenticatedJoystickChatSender,
  createJoystickChatClient,
} from '../src/joystick-chat.js';
import { createDirectMessageSender } from '../src/direct-message.js';
import { createFlipACoinScheduler } from '../src/flip-a-coin-scheduler.js';
import * as runtimeBoundary from '../electron/joystick-whisper-runtime.js';

type StreamState = 'checking' | 'live' | 'offline' | 'ending-soon' | 'unknown';
type LiveStateInput = { getStreamState: () => StreamState };
type FetchCall = { url: string; init?: RequestInit };
type Session = { state: 'authenticated'; accessToken: string; grantedPermissions: string[] };
type WhisperAttempt = { eventId: string; rule: 'followed'; recipient: string; attemptedAt: string };
type GatewayInput = {
  getAccessToken: () => string | undefined;
  getGrantedPermissions: () => readonly string[];
  onEvent: (event: unknown) => Promise<void>;
  onStatus: (status: { state: 'connected' | 'reconnecting' | 'unavailable' }) => void;
};
type Runtime = {
  start: () => Promise<void>;
  shutdown: () => Promise<void>;
  getStatus: () => { stream: { state: StreamState } };
};
type RuntimeOptions = {
  desktopSettings: {
    getSettings: () => Promise<{ settings: Record<string, unknown> }>;
    saveSettings: (settings: Record<string, unknown>) => Promise<{ settings: Record<string, unknown> }>;
  };
  auth: { getSession: () => Session | null; onStateChanged: (listener: () => void) => () => void };
  createGateway: (input: GatewayInput) => { start: () => Promise<void>; updateAccessToken: (token: string | undefined) => Promise<void>; stop: () => Promise<void> };
  attemptStore: { claimWhisperAttempt: (attempt: WhisperAttempt) => Promise<boolean> };
  sendWhisper: (accessToken: string, whisper: { username: string; text: string }) => Promise<void>;
  fetchImpl?: (url: string | URL, init?: RequestInit) => Promise<Response>;
};

const liveAwareChatClient = createJoystickChatClient as unknown as (
  input: Parameters<typeof createJoystickChatClient>[0] & LiveStateInput,
) => ReturnType<typeof createJoystickChatClient>;
const liveAwareChatSender = createAuthenticatedJoystickChatSender as unknown as (
  input: Parameters<typeof createAuthenticatedJoystickChatSender>[0] & LiveStateInput,
) => ReturnType<typeof createAuthenticatedJoystickChatSender>;
const liveAwareDirectMessageSender = createDirectMessageSender as unknown as (
  input: Parameters<typeof createDirectMessageSender>[0] & LiveStateInput,
) => ReturnType<typeof createDirectMessageSender>;
const createRuntime = (runtimeBoundary as unknown as {
  createJoystickWhisperRuntime?: (options: RuntimeOptions) => Runtime;
}).createJoystickWhisperRuntime;

const enabledWhisperRules = {
  followed: { enabled: true, message: 'Thanks for following' },
  subscribed: { enabled: false, message: '' },
  resubscribed: { enabled: false, message: '' },
  giftSender: { enabled: false, message: '' },
};

function fakeFetch(calls: FetchCall[]) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: { id: 'message-1' } }), { status: 201 });
  };
}

async function ignoreDeliveryResult(operation: () => Promise<unknown>) {
  try { await operation(); } catch { /* Blocking may reject; the request-count assertion is the contract. */ }
}

async function exerciseChatRoutes(state: StreamState) {
  const calls = new Map(['client', 'scheduled', 'reminder-test', 'direct'].map((route) => [route, [] as FetchCall[]]));
  const getStreamState = () => state;
  const client = liveAwareChatClient({
    accessToken: 'access-token',
    getStreamState,
    fetchImpl: fakeFetch(calls.get('client')!),
  });
  await ignoreDeliveryResult(() => client.sendMessage({ text: 'Client send' }));

  const scheduledSender = liveAwareChatSender({
    getAccessToken: () => 'access-token',
    getStreamState,
    fetchImpl: fakeFetch(calls.get('scheduled')!),
  });
  const scheduler = createFlipACoinScheduler({
    send: scheduledSender,
    getSettings: () => ({ reminders: [{
      id: 'hourly', enabled: true, task: 'custom-message', message: 'Scheduled message',
      schedule: 'hourly', intervalMinutes: 5, dailyTime: '09:00',
    }] }),
  });
  await ignoreDeliveryResult(() => scheduler.tick(new Date(2026, 9, 25, 12, 0)));

  const reminderTestSender = liveAwareChatSender({
    getAccessToken: () => 'access-token',
    getStreamState,
    fetchImpl: fakeFetch(calls.get('reminder-test')!),
    throwIfUnavailable: true,
    throwOnError: true,
  });
  await ignoreDeliveryResult(() => reminderTestSender({ message: 'Test reminder' }));

  const directSender = liveAwareDirectMessageSender({
    getAccessToken: () => 'access-token',
    getStreamState,
    fetchImpl: fakeFetch(calls.get('direct')!),
  });
  await ignoreDeliveryResult(() => directSender('Manual direct message'));

  return Object.fromEntries([...calls].map(([route, requests]) => [route, requests.map(({ url }) => url)]));
}

test('every public chat route fails closed unless the authoritative stream state is exactly live', async (t) => {
  for (const state of ['offline', 'ending-soon', 'checking', 'unknown'] as const) {
    await t.test(`${state} blocks shared client, scheduled, reminder-test, and direct sends`, async () => {
      assert.deepEqual(await exerciseChatRoutes(state), {
        client: [],
        scheduled: [],
        'reminder-test': [],
        direct: [],
      });
    });
  }

  await t.test('live allows all public chat routes', async () => {
    assert.deepEqual(await exerciseChatRoutes('live'), {
      client: Array(1).fill('https://api.joystick.tv/api/v1/chat/messages'),
      scheduled: Array(1).fill('https://api.joystick.tv/api/v1/chat/messages'),
      'reminder-test': Array(1).fill('https://api.joystick.tv/api/v1/chat/messages'),
      direct: Array(1).fill('https://api.joystick.tv/api/v1/chat/messages'),
    });
  });
});

test('Electron main supplies its authoritative stream state to scheduled, test, and direct chat composition', () => {
  const mainSource = readFileSync(fileURLToPath(new URL('../electron/main.mjs', import.meta.url)), 'utf8');
  const schedulerStart = mainSource.indexOf('const flipACoinScheduler =');
  const schedulerEnd = mainSource.indexOf('function wireIpc()', schedulerStart);
  assert.ok(schedulerStart >= 0 && schedulerEnd > schedulerStart, 'main composes the public and reminder-test senders');
  const schedulerComposition = mainSource.slice(schedulerStart, schedulerEnd);
  const senderOptions = [...schedulerComposition.matchAll(/createAuthenticatedJoystickChatSender\(\{([\s\S]*?)\}\)/g)];
  assert.equal(senderOptions.length, 2, 'scheduled and immediate reminder-test messages use the shared chat sender');
  for (const [, options] of senderOptions) {
    assert.match(options!, /getStreamState|stream\.state|requireLive|assertLive/i,
      'the shared sender must receive or apply the authoritative stream-state gate');
  }

  const directStart = mainSource.indexOf("ipcMain.handle('direct-message:send'");
  const directEnd = mainSource.indexOf("registeredIpcHandlers.add('direct-message:send')", directStart);
  assert.ok(directStart >= 0 && directEnd > directStart, 'main composes the direct-message route');
  assert.match(mainSource.slice(directStart, directEnd), /getStreamState|stream\.state|requireLive|assertLive/i,
    'manual/direct messages must use the same live-only boundary');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function streamResponse(live: boolean) {
  return new Response(JSON.stringify({ live }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function whisperRuntimeFixture(fetchImpl?: RuntimeOptions['fetchImpl']) {
  let session: Session | null = {
    state: 'authenticated',
    accessToken: 'stream-token',
    grantedPermissions: ['stream:read', 'chat:whisper:write'],
  };
  const authListeners: Array<() => void> = [];
  const fetchCalls: FetchCall[] = [];
  const gatewayCalls: string[] = [];
  const attempts: WhisperAttempt[] = [];
  const sent: Array<{ accessToken: string; username: string; text: string }> = [];
  let gatewayInput: GatewayInput | undefined;
  const runtime = createRuntime!({
    desktopSettings: {
      getSettings: async () => ({ settings: { joystickWhispers: enabledWhisperRules } }),
      saveSettings: async (settings) => ({ settings }),
    },
    auth: {
      getSession: () => session,
      onStateChanged: (listener) => {
        authListeners.push(listener);
        return () => {
          const index = authListeners.indexOf(listener);
          if (index >= 0) authListeners.splice(index, 1);
        };
      },
    },
    createGateway: (input) => {
      gatewayInput = input;
      return {
        start: async () => { gatewayCalls.push('start'); },
        updateAccessToken: async () => { gatewayCalls.push('update'); },
        stop: async () => { gatewayCalls.push('stop'); },
      };
    },
    attemptStore: {
      claimWhisperAttempt: async (attempt) => { attempts.push(attempt); return true; },
    },
    sendWhisper: async (accessToken, whisper) => { sent.push({ accessToken, ...whisper }); },
    fetchImpl: fetchImpl && (async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      return fetchImpl(url, init);
    }),
  });

  return {
    runtime,
    fetchCalls,
    gatewayCalls,
    attempts,
    sent,
    get gatewayInput() { return gatewayInput!; },
    setSession(next: Session | null) {
      session = next;
      for (const listener of [...authListeners]) listener();
    },
  };
}

function followedEvent(id: string) {
  return {
    v: 2,
    type: 'followed',
    id,
    channel_id: 'channel-1',
    occurred_at: '2026-10-25T12:00:00Z',
    text: 'Follower',
    data: { who: 'Follower' },
  };
}

test('non-live whisper events neither send nor claim a durable attempt, while live events still do', async (t) => {
  assert.equal(typeof createRuntime, 'function', 'Electron main exposes the injectable Joystick runtime boundary');
  const cases: Array<{
    state: Exclude<StreamState, 'live'>;
    fetchImpl: RuntimeOptions['fetchImpl'];
    setState?: (gateway: GatewayInput) => Promise<void> | void;
  }> = [
    { state: 'offline', fetchImpl: async () => streamResponse(false) },
    {
      state: 'ending-soon',
      fetchImpl: async () => streamResponse(true),
      setState: async (gateway) => { await gateway.onEvent({ v: 2, type: 'stream_ending' }); },
    },
    { state: 'checking', fetchImpl: async () => new Promise<Response>(() => {}) },
    { state: 'unknown', fetchImpl: async () => { throw new Error('stream status unavailable'); } },
  ];

  for (const sample of cases) {
    await t.test(`${sample.state} skips delivery without claiming an attempt and preserves status recovery`, async () => {
      const harness = whisperRuntimeFixture(sample.fetchImpl);
      await harness.runtime.start();
      assert.ok(harness.gatewayCalls.includes('start'), 'gateway setup remains enabled while the stream is not live');
      harness.gatewayInput.onStatus({ state: 'connected' });
      await flushMicrotasks();
      await sample.setState?.(harness.gatewayInput);
      assert.equal(harness.runtime.getStatus().stream.state, sample.state);

      assert.equal(harness.fetchCalls.length, 1, 'stream-status REST remains available while sends are blocked');
      assert.equal(harness.fetchCalls[0]?.url, 'https://api.joystick.tv/api/v1/me/stream');
      assert.equal(harness.fetchCalls[0]?.init?.method, 'GET');

      await harness.gatewayInput.onEvent(followedEvent(`not-live-${sample.state}`));
      assert.deepEqual(harness.sent, [], 'a non-live stream cannot receive an automated whisper');
      assert.deepEqual(harness.attempts, [], 'a blocked whisper must not consume a durable attempt');
      await harness.runtime.shutdown();
    });
  }

  await t.test('live sends and claims exactly one durable attempt', async () => {
    const harness = whisperRuntimeFixture(async () => streamResponse(true));
    await harness.runtime.start();
    harness.gatewayInput.onStatus({ state: 'connected' });
    await flushMicrotasks();
    assert.equal(harness.runtime.getStatus().stream.state, 'live');

    await harness.gatewayInput.onEvent(followedEvent('live-follow'));

    assert.deepEqual(harness.sent, [{
      accessToken: 'stream-token', username: 'Follower', text: 'Thanks for following',
    }]);
    assert.deepEqual(harness.attempts.map(({ eventId, rule, recipient }) => ({ eventId, rule, recipient })), [
      { eventId: 'live-follow', rule: 'followed', recipient: 'Follower' },
    ]);
    await harness.runtime.shutdown();
  });
});
