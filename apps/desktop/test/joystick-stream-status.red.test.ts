import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as runtimeBoundary from '../electron/joystick-whisper-runtime.js';
import * as preloadBoundary from '../electron/preload-api.js';
import { renderShellPage } from '../electron/shell-page.js';

type StreamState = 'checking' | 'live' | 'offline' | 'ending-soon' | 'unknown';
type Session = { state: 'authenticated'; accessToken: string; grantedPermissions: string[] };
type GatewayInput = {
  getAccessToken: () => string | undefined;
  getGrantedPermissions: () => readonly string[];
  onEvent: (event: unknown) => Promise<void>;
  onStatus: (status: { state: 'connected' | 'reconnecting' | 'unavailable' }) => void;
};
type RuntimeStatus = {
  stream: { state: StreamState };
  [key: string]: unknown;
};
type Runtime = {
  start: () => Promise<void>;
  shutdown: () => Promise<void>;
  getStatus: () => RuntimeStatus;
  onStatusChanged: (listener: (status: RuntimeStatus) => void) => () => void;
};
type FetchCall = { url: string; init?: RequestInit };

const createRuntime = (runtimeBoundary as unknown as {
  createJoystickWhisperRuntime?: (options: Record<string, unknown>) => Runtime;
}).createJoystickWhisperRuntime;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function response(live: boolean): Response {
  return new Response(JSON.stringify({
    channel_id: 'channel-1',
    live,
    live_at: live ? '2026-11-07T12:00:00.000Z' : null,
    stream_title: live ? 'A live stream' : null,
    view_count: 0,
    tags: [],
    online_photo_url: null,
    offline_photo_url: null,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function fixture(input: {
  session?: Session | null;
  confirmOnStart?: boolean;
  fetchImpl?: (url: string | URL, init?: RequestInit) => Promise<Response>;
} = {}) {
  let session: Session | null = input.session === undefined ? {
    state: 'authenticated',
    accessToken: 'stream-token-initial',
    grantedPermissions: ['stream:read', 'chat:whisper:write'],
  } : input.session;
  const authListeners: Array<() => void> = [];
  const fetchCalls: FetchCall[] = [];
  const order: string[] = [];
  const published: RuntimeStatus[] = [];
  let gatewayInput: GatewayInput | undefined;
  const runtime = createRuntime!({
    desktopSettings: {
      getSettings: async () => ({ settings: {} }),
      saveSettings: async (settings: Record<string, unknown>) => ({ settings }),
    },
    auth: {
      getSession: () => session,
      onStateChanged: (listener: () => void) => {
        authListeners.push(listener);
        return () => {
          const index = authListeners.indexOf(listener);
          if (index >= 0) authListeners.splice(index, 1);
        };
      },
    },
    createGateway: (gateway: GatewayInput) => {
      gatewayInput = gateway;
      return {
        start: async () => {
          order.push('gateway-start');
          if (input.confirmOnStart) {
            order.push('subscription-confirmed');
            gateway.onStatus({ state: 'connected' });
          }
        },
        updateAccessToken: async () => {
          order.push('reconnect-confirmed');
          gateway.onStatus({ state: 'connected' });
        },
        stop: async () => {},
      };
    },
    attemptStore: { claimWhisperAttempt: async () => true },
    sendWhisper: async () => {},
    fetchImpl: async (url: string | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      order.push(`snapshot:${new Headers(init?.headers).get('authorization') ?? 'no-authorization'}`);
      return input.fetchImpl
        ? input.fetchImpl(url, init)
        : response(true);
    },
  });
  runtime.onStatusChanged((status) => published.push(status));

  return {
    runtime,
    fetchCalls,
    order,
    published,
    get gatewayInput() { return gatewayInput!; },
    setSession(next: Session | null) {
      session = next;
      for (const listener of [...authListeners]) listener();
    },
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function streamState(runtime: Runtime): StreamState | undefined {
  return runtime.getStatus()?.stream?.state;
}

test('startup snapshots current stream state with GET and the current bearer token, without exposing credentials', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the Joystick runtime composition boundary');
  const harness = fixture({ confirmOnStart: true });

  await harness.runtime.start();
  await flushMicrotasks();

  assert.equal(harness.fetchCalls.length, 1, 'startup should make one stream snapshot request, not poll');
  assert.equal(harness.fetchCalls[0]?.url, 'https://api.joystick.tv/api/v1/me/stream');
  assert.equal(harness.fetchCalls[0]?.init?.method, 'GET');
  assert.equal(new Headers(harness.fetchCalls[0]?.init?.headers).get('authorization'), 'Bearer stream-token-initial');
  assert.equal(streamState(harness.runtime), 'live', 'a live REST snapshot must cover the app-started-after-live case');
  assert.ok(harness.order.indexOf('snapshot:Bearer stream-token-initial') > harness.order.indexOf('subscription-confirmed'),
    'the post-confirmation snapshot should start after gateway subscription confirmation');
  const serializedStatus = JSON.stringify([harness.runtime.getStatus(), harness.published]);
  assert.doesNotMatch(serializedStatus, /stream-token-initial|accessToken|refreshToken/);
  await harness.runtime.shutdown();
});

test('only the actual stream:read grant permits a snapshot; a failed or unauthorized snapshot stays unknown, never offline', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the Joystick runtime composition boundary');
  const missingGrant = fixture({
    session: { state: 'authenticated', accessToken: 'without-stream-grant', grantedPermissions: ['chat:whisper:write'] },
  });
  await missingGrant.runtime.start();
  assert.equal(missingGrant.fetchCalls.length, 0, 'requested scopes do not replace actual stream:read grants');
  assert.equal(streamState(missingGrant.runtime), 'unknown');
  await missingGrant.runtime.shutdown();

  const offlineSnapshot = fixture({
    confirmOnStart: true,
    fetchImpl: async () => response(false),
  });
  await offlineSnapshot.runtime.start();
  await flushMicrotasks();
  assert.equal(streamState(offlineSnapshot.runtime), 'offline', 'a successful live:false snapshot is evidence of Offline');
  await offlineSnapshot.runtime.shutdown();

  const failedSnapshot = fixture({
    confirmOnStart: true,
    fetchImpl: async () => { throw new Error('network failure'); },
  });
  await failedSnapshot.runtime.start();
  await flushMicrotasks();
  assert.equal(streamState(failedSnapshot.runtime), 'unknown');
  assert.notEqual(streamState(failedSnapshot.runtime), 'offline', 'a request failure is not evidence that the streamer is offline');
  await failedSnapshot.runtime.shutdown();

  const malformedSnapshot = fixture({
    confirmOnStart: true,
    fetchImpl: async () => new Response(JSON.stringify({ live: 'false' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  await malformedSnapshot.runtime.start();
  await flushMicrotasks();
  assert.equal(streamState(malformedSnapshot.runtime), 'unknown', 'malformed successful responses are not evidence of Offline');
  await malformedSnapshot.runtime.shutdown();

  const unauthorizedSnapshot = fixture({
    confirmOnStart: true,
    fetchImpl: async () => new Response('{}', { status: 401 }),
  });
  await unauthorizedSnapshot.runtime.start();
  await flushMicrotasks();
  assert.equal(streamState(unauthorizedSnapshot.runtime), 'unknown', 'unauthorized snapshots remain unknown');
  await unauthorizedSnapshot.runtime.shutdown();
});

test('confirmed gateway stream events update live, offline, and ending-soon without treating ending as offline', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the Joystick runtime composition boundary');
  const harness = fixture({ confirmOnStart: true });
  await harness.runtime.start();

  const samples: Array<{ event: Record<string, unknown>; expected: StreamState }> = [
    { event: { v: 2, id: 'started', type: 'started' }, expected: 'live' },
    { event: { v: 2, id: 'online-topic', type: 'stream_event', topic: 'stream.online' }, expected: 'live' },
    { event: { v: 2, id: 'ended', type: 'ended' }, expected: 'offline' },
    { event: { v: 2, id: 'offline-topic', type: 'stream_event', topic: 'stream.offline' }, expected: 'offline' },
    { event: { v: 2, id: 'ending', type: 'stream_ending' }, expected: 'ending-soon' },
  ];
  for (const sample of samples) {
    await harness.gatewayInput.onEvent(sample.event);
    assert.equal(streamState(harness.runtime), sample.expected, `event ${sample.event.id} should map to ${sample.expected}`);
  }
  assert.ok(harness.published.some((status) => status.stream.state === 'ending-soon'));
  assert.doesNotMatch(JSON.stringify(harness.published), /stream-token-initial|accessToken|refreshToken/);
  await harness.runtime.shutdown();
});

test('a stream event received while the REST snapshot is in flight wins over the older response', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the Joystick runtime composition boundary');
  const snapshot = deferred<Response>();
  const fetchStarted = deferred<void>();
  const harness = fixture({
    confirmOnStart: true,
    fetchImpl: async () => {
      fetchStarted.resolve();
      return snapshot.promise;
    },
  });

  const starting = harness.runtime.start();
  await flushMicrotasks();
  assert.equal(harness.fetchCalls.length, 1, 'startup should begin its REST snapshot');
  await fetchStarted.promise;
  assert.equal(streamState(harness.runtime), 'checking', 'the shell should identify a pending initial snapshot as Checking');
  await harness.gatewayInput.onEvent({ v: 2, id: 'new-live-event', type: 'started' });
  snapshot.resolve(response(false));
  await flushMicrotasks();
  await starting;

  assert.equal(streamState(harness.runtime), 'live', 'a late offline response must not overwrite a newer live event');
  await harness.runtime.shutdown();
});

test('a refreshed session and confirmed reconnect refresh the snapshot and fence stale responses from the old session', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the Joystick runtime composition boundary');
  const oldSnapshot = deferred<Response>();
  const oldFetchStarted = deferred<void>();
  const harness = fixture({
    confirmOnStart: true,
    fetchImpl: async (_url, init) => {
      if (new Headers(init?.headers).get('authorization') === 'Bearer stream-token-initial') {
        oldFetchStarted.resolve();
        return oldSnapshot.promise;
      }
      return response(true);
    },
  });

  const starting = harness.runtime.start();
  await flushMicrotasks();
  assert.equal(harness.fetchCalls.length, 1, 'startup should request the current session snapshot');
  await oldFetchStarted.promise;
  harness.setSession({
    state: 'authenticated',
    accessToken: 'stream-token-refreshed',
    grantedPermissions: ['stream:read'],
  });
  await flushMicrotasks();
  assert.ok(harness.fetchCalls.some((call) => new Headers(call.init?.headers).get('authorization') === 'Bearer stream-token-refreshed'),
    'a confirmed reconnect after token refresh should fetch a fresh snapshot');
  assert.ok(harness.order.indexOf('snapshot:Bearer stream-token-refreshed') > harness.order.indexOf('reconnect-confirmed'),
    'the refreshed snapshot must start after the new gateway subscription is confirmed');
  assert.equal(streamState(harness.runtime), 'live');
  await flushMicrotasks();
  assert.equal(harness.fetchCalls.length, 2, 'stream snapshots should refresh on reconnect, not poll continuously');

  oldSnapshot.resolve(response(false));
  await flushMicrotasks();
  await starting;
  assert.equal(streamState(harness.runtime), 'live', 'a response from the prior session must be ignored');
  await harness.runtime.shutdown();
});

test('the desktop shell hides whisper and stream status copy while retaining live-status updates', () => {
  const html = renderShellPage('ready', 'Prismata desktop');
  assert.doesNotMatch(html, /Private thank-you whispers/);
  assert.doesNotMatch(html, /Whispers run only while Prismata is running and connected/);
  assert.doesNotMatch(html, /Gateway connection requires stream:read/);
  assert.doesNotMatch(html, /Gift-recipient whispers are disabled/);
  assert.doesNotMatch(html, /Connection unavailable|Connected to Joystick events|No whisper attempts yet/);
  assert.doesNotMatch(html, /Joystick stream status/);
  assert.match(html, /joystickWhispers\.onStatusChanged/);
});

test('a late initial shell status cannot overwrite a newer pushed live status', async () => {
  const html = renderShellPage('ready', 'Prismata desktop');
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, 'the shell page includes its UI script');

  let resolveInitialStatus!: (status: unknown) => void;
  const initialStatus = new Promise<unknown>((resolve) => { resolveInitialStatus = resolve; });
  const callOrder: string[] = [];
  let publishStatus: ((status: unknown) => void) | undefined;
  const elements = new Map<string, {
    textContent: string;
    innerHTML: string;
    value: string;
    checked: boolean;
    hidden: boolean;
    disabled: boolean;
    className: string;
    onclick?: () => void;
    onchange?: () => void;
    onsubmit?: (event: { preventDefault(): void }) => void;
    classList: { add(...names: string[]): void; toggle(name: string, force?: boolean): boolean };
    setAttribute(name: string, value: string): void;
    append(...children: unknown[]): void;
    replaceChildren(...children: unknown[]): void;
  }>();
  const makeElement = () => ({
    textContent: '', innerHTML: '', value: '', checked: false, hidden: false, disabled: false, className: '',
    classList: { add: (..._names: string[]) => {}, toggle: (_name: string, _force?: boolean) => false },
    setAttribute: (_name: string, _value: string) => {},
    append: (..._children: unknown[]) => {},
    replaceChildren: (..._children: unknown[]) => {},
  });
  const document = {
    getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id)!;
    },
    createElement: makeElement,
  };
  const offlineStatus = {
    connection: { state: 'unavailable' },
    delivery: { state: 'idle' },
    stream: { state: 'offline', viewerCount: 0 },
  };
  const liveStatus = {
    connection: { state: 'connected' },
    delivery: { state: 'idle' },
    stream: { state: 'live', viewerCount: 27 },
  };
  const settings = Object.fromEntries(['followed', 'subscribed', 'resubscribed', 'giftSender']
    .map((rule) => [rule, { enabled: false, message: '' }]));
  const shellApi = {
    admin: {
      getStatus: async () => ({ state: 'offline', lanEnabled: false, protocol: 'https', discovery: 'stopped' }),
      listNetworkInterfaces: async () => [],
      listDevices: async () => [],
      listConnectionRequests: async () => [],
      setLanEnabled: async () => ({}),
      setAdvertisedAddress: async () => ({}),
      retryAdvertising: async () => ({}),
      revokeDevice: async () => {},
      approveConnectionRequest: async () => {},
    },
    auth: {
      onStateChanged: () => () => {},
      getSnapshot: async () => ({ state: 'signed-out' }),
      signInWithJoystick: async () => {},
      signOut: async () => {},
      cancel: () => {},
    },
    joystickWhispers: {
      onStatusChanged(listener: (status: unknown) => void) {
        callOrder.push('subscribe');
        publishStatus = listener;
        return () => {};
      },
      getStatus() {
        callOrder.push('getStatus');
        return initialStatus;
      },
      getSettings: async () => settings,
      updateSettings: async (next: unknown) => next,
    },
    todos: {
      onListChanged: () => () => {},
      list: async () => [],
      add: async () => ({}),
      complete: async () => {},
    },
    reminder: {
      list: async () => [],
      create: async () => {},
      updateRecord: async () => {},
      remove: async () => {},
      test: async () => {},
      testRecord: async () => {},
    },
    directMessage: { send: async () => {} },
  };

  runInNewContext(script!, {
    document,
    window: { prismataDesktop: shellApi, addEventListener: () => {} },
    setInterval: () => 0,
    confirm: () => true,
  });
  assert.deepEqual(callOrder, ['subscribe', 'getStatus'], 'the shell subscribes before requesting its initial status');
  assert.equal(typeof publishStatus, 'function');

  publishStatus!(liveStatus);
  assert.equal(elements.get('panel-viewer-count')?.textContent, '27');
  resolveInitialStatus(offlineStatus);
  for (let index = 0; index < 8; index += 1) await Promise.resolve();

  assert.equal(elements.get('panel-viewer-count')?.textContent, '27',
    'the older initial offline response must not replace the newer pushed live status');
  assert.equal(elements.has('joystick-stream-status'), false, 'the removed stream status is not rendered');
});

test('the preload status boundary carries only a credential-free stream state', async () => {
  const mainSource = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const preloadSource = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
  const typedPreloadSource = readFileSync(new URL('../electron/preload-api.ts', import.meta.url), 'utf8');
  const runtimeSource = readFileSync(new URL('../electron/joystick-whisper-runtime.ts', import.meta.url), 'utf8');
  const createApi = (preloadBoundary as unknown as {
    createJoystickWhisperPreloadApi?: (input: Record<string, unknown>) => Record<string, unknown>;
  }).createJoystickWhisperPreloadApi;
  assert.equal(typeof createApi, 'function', 'preload must expose the typed Joystick status API');
  const safeStatus = {
    connection: { state: 'connected', message: null },
    delivery: { state: 'idle', rule: null, message: null },
    stream: { state: 'live' },
  };
  const api = createApi!({
    getSettings: async () => ({}),
    updateSettings: async (settings: unknown) => settings,
    getStatus: async () => safeStatus,
    onStatusChanged: () => () => {},
  });

  assert.deepEqual(await (api.getStatus as () => Promise<unknown>)(), safeStatus);
  assert.deepEqual(Object.keys(safeStatus.stream), ['state']);
  assert.doesNotMatch(JSON.stringify(safeStatus), /accessToken|refreshToken|stream-token/);
  assert.match(mainSource, /handle\('joystick-whispers:get-status'/);
  assert.match(mainSource, /joystick-whispers:status-changed/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('joystick-whispers:get-status'\)/);
  assert.match(preloadSource, /joystick-whispers:status-changed/);
  assert.match(typedPreloadSource, /getStatus:\s*\(\)\s*=>\s*Promise<JoystickWhisperStatus>/,
    'the preload status API must retain its runtime-defined type');
  assert.match(runtimeSource, /stream\s*:\s*\{/s,
    'the runtime-defined status must include the credential-free stream state');
});
