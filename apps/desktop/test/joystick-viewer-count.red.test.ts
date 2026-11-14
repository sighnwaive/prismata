import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as runtimeBoundary from '../electron/joystick-whisper-runtime.js';
import { renderShellPage } from '../electron/shell-page.js';

type RuntimeStatus = {
  connection: { state: string; message: string | null };
  delivery: { state: string; rule: string | null; message: string | null };
  stream: { state: string; viewerCount: number };
};
type GatewayInput = {
  onEvent: (event: unknown) => Promise<void>;
  onStatus: (status: { state: 'connected' | 'reconnecting' | 'unavailable' }) => void;
};
type Runtime = {
  start: () => Promise<void>;
  shutdown: () => Promise<void>;
  getStatus: () => RuntimeStatus;
  onStatusChanged: (listener: (status: RuntimeStatus) => void) => () => void;
};

const createRuntime = (runtimeBoundary as unknown as {
  createJoystickWhisperRuntime?: (options: Record<string, unknown>) => Runtime;
}).createJoystickWhisperRuntime;

function gatewayLog(event: unknown) {
  return { receivedAt: '2026-11-07T12:00:00.000Z', event };
}

function viewerCountEvent(id: string, count: unknown) {
  return {
    v: 2,
    type: 'viewer_count_updated',
    topic: 'stream.viewer_count',
    id,
    channel_id: 'channel-1',
    occurred_at: '2026-11-07T12:00:00.000Z',
    data: { number_of_viewers: count },
  };
}

function streamSnapshotResponse(
  live: boolean,
  options: { viewCount?: unknown; includeViewCount?: boolean } = {},
): Response {
  const { viewCount = 0, includeViewCount = true } = options;
  return new Response(JSON.stringify({
    channel_id: 'channel-1',
    live,
    live_at: live ? '2026-11-07T12:00:00.000Z' : null,
    stream_title: live ? 'A live stream' : null,
    ...(includeViewCount ? { view_count: viewCount } : {}),
    tags: [],
    online_photo_url: null,
    offline_photo_url: null,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function runtimeFixture(
  fetchImpl: (url: string | URL, init?: RequestInit) => Promise<Response> = async () => streamSnapshotResponse(true),
) {
  let gatewayInput: GatewayInput | undefined;
  const published: RuntimeStatus[] = [];
  const runtime = createRuntime!({
    desktopSettings: {
      getSettings: async () => ({ settings: {} }),
      saveSettings: async (settings: Record<string, unknown>) => ({ settings }),
    },
    auth: {
      getSession: () => ({
        state: 'authenticated',
        accessToken: 'viewer-count-test-token',
        grantedPermissions: ['stream:read', 'chat:whisper:write'],
      }),
      onStateChanged: () => () => {},
    },
    createGateway: (input: GatewayInput) => {
      gatewayInput = input;
      return { start: async () => {}, updateAccessToken: async () => {}, stop: async () => {} };
    },
    attemptStore: { claimWhisperAttempt: async () => true },
    sendWhisper: async () => {},
    fetchImpl,
  });
  runtime.onStatusChanged((status) => published.push(status));
  return { runtime, published, get gatewayInput() { return gatewayInput!; } };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

test('viewer count starts at zero before the first count event', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the Joystick runtime composition boundary');
  const harness = runtimeFixture();
  const initialCount = harness.runtime.getStatus().stream.viewerCount;
  await harness.runtime.shutdown();
  assert.equal(initialCount, 0, 'before any count event the viewer count is zero');
});

test('actual Gateway v2 count updates are published and reset when the stream ends', async () => {
  const harness = runtimeFixture();
  const observedCounts: Array<number | undefined> = [harness.runtime.getStatus().stream.viewerCount];

  await harness.runtime.start();
  harness.gatewayInput.onStatus({ state: 'connected' });
  await flushMicrotasks();
  observedCounts.push(harness.runtime.getStatus().stream.viewerCount);

  for (const count of [11, 12, 11]) {
    await harness.gatewayInput.onEvent(viewerCountEvent(`viewer-count-${count}-${harness.published.length}`, count));
    observedCounts.push(harness.runtime.getStatus().stream.viewerCount);
    observedCounts.push(harness.published.at(-1)?.stream.viewerCount);
  }

  await harness.gatewayInput.onEvent(gatewayLog(viewerCountEvent('nested-viewer-count', 13)));
  observedCounts.push(harness.runtime.getStatus().stream.viewerCount);
  observedCounts.push(harness.published.at(-1)?.stream.viewerCount);

  await harness.gatewayInput.onEvent(gatewayLog({
    v: 2,
    type: 'ended',
    id: 'stream-ended',
    channel_id: 'channel-1',
    occurred_at: '2026-11-07T12:01:00.000Z',
    data: {},
  }));
  observedCounts.push(harness.runtime.getStatus().stream.viewerCount);
  observedCounts.push(harness.published.at(-1)?.stream.viewerCount);
  const streamState = harness.runtime.getStatus().stream.state;
  await harness.runtime.shutdown();

  assert.deepEqual(observedCounts, [0, 0, 11, 11, 12, 12, 11, 11, 13, 13, 0, 0],
    'the runtime starts at zero, accepts actual and nested event payloads, publishes counts, and resets at stream end');
  assert.equal(streamState, 'offline');
});

test('a valid snapshot view_count initializes and publishes the runtime viewer count', async () => {
  for (const viewCount of [0, 37, Number.MAX_SAFE_INTEGER]) {
    const harness = runtimeFixture(async () => streamSnapshotResponse(true, { viewCount }));
    await harness.runtime.start();
    harness.gatewayInput.onStatus({ state: 'connected' });
    await flushMicrotasks();

    assert.equal(harness.runtime.getStatus().stream.viewerCount, viewCount,
      `view_count ${viewCount} should initialize the runtime status`);
    assert.equal(harness.published.at(-1)?.stream.viewerCount, viewCount,
      `view_count ${viewCount} should be published to status listeners`);
    await harness.runtime.shutdown();
  }
});

test('missing and invalid snapshot view_count values leave the viewer count at zero', async () => {
  const invalidSnapshots: Array<{ label: string; options: { viewCount?: unknown; includeViewCount?: boolean } }> = [
    { label: 'missing', options: { includeViewCount: false } },
    { label: 'null', options: { viewCount: null } },
    { label: 'string', options: { viewCount: '12' } },
    { label: 'negative', options: { viewCount: -1 } },
    { label: 'fractional', options: { viewCount: 1.5 } },
    { label: 'unsafe integer', options: { viewCount: Number.MAX_SAFE_INTEGER + 1 } },
    { label: 'non-finite', options: { viewCount: Number.NaN } },
  ];

  for (const { label, options } of invalidSnapshots) {
    const harness = runtimeFixture(async () => streamSnapshotResponse(true, options));
    await harness.runtime.start();
    harness.gatewayInput.onStatus({ state: 'connected' });
    await flushMicrotasks();

    assert.equal(harness.runtime.getStatus().stream.viewerCount, 0,
      `${label} view_count must leave the runtime count unchanged`);
    await harness.runtime.shutdown();
  }
});

test('snapshot viewer count is read only from the top-level view_count field', async () => {
  const harness = runtimeFixture(async () => new Response(JSON.stringify({
    live: true,
    data: { view_count: 29 },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));

  await harness.runtime.start();
  harness.gatewayInput.onStatus({ state: 'connected' });
  await flushMicrotasks();

  assert.equal(harness.runtime.getStatus().stream.state, 'live');
  assert.equal(harness.runtime.getStatus().stream.viewerCount, 0,
    'a nested data.view_count must not initialize the runtime count');
  await harness.runtime.shutdown();
});

test('a Gateway count received during the snapshot request wins over its later view_count', async () => {
  let resolveSnapshot!: (response: Response) => void;
  const snapshot = new Promise<Response>((resolve) => { resolveSnapshot = resolve; });
  const harness = runtimeFixture(async () => snapshot);

  await harness.runtime.start();
  harness.gatewayInput.onStatus({ state: 'connected' });
  await harness.gatewayInput.onEvent(viewerCountEvent('count-during-snapshot', 8));
  assert.equal(harness.runtime.getStatus().stream.viewerCount, 8);

  resolveSnapshot(streamSnapshotResponse(true, { viewCount: 3 }));
  await flushMicrotasks();

  assert.equal(harness.runtime.getStatus().stream.viewerCount, 8,
    'the later REST snapshot must not overwrite a newer Gateway count');
  assert.equal(harness.published.at(-1)?.stream.viewerCount, 8);
  await harness.runtime.shutdown();
});

test('an offline snapshot does not initialize a nonzero viewer count', async () => {
  const harness = runtimeFixture(async () => streamSnapshotResponse(false, { viewCount: 29 }));

  await harness.runtime.start();
  harness.gatewayInput.onStatus({ state: 'connected' });
  await flushMicrotasks();

  assert.equal(harness.runtime.getStatus().stream.state, 'offline');
  assert.equal(harness.runtime.getStatus().stream.viewerCount, 0,
    'offline snapshots keep the viewer count reset to zero regardless of their view_count');
  assert.equal(harness.published.at(-1)?.stream.viewerCount, 0);
  await harness.runtime.shutdown();
});

test('an offline REST snapshot resets a viewer count received while the initial snapshot is pending', async () => {
  let resolveSnapshot!: (response: Response) => void;
  const snapshot = new Promise<Response>((resolve) => { resolveSnapshot = resolve; });
  const harness = runtimeFixture(async () => snapshot);

  await harness.runtime.start();
  harness.gatewayInput.onStatus({ state: 'connected' });
  await harness.gatewayInput.onEvent(viewerCountEvent('count-during-snapshot', 8));
  assert.equal(harness.runtime.getStatus().stream.viewerCount, 8);

  resolveSnapshot(streamSnapshotResponse(false));
  await flushMicrotasks();

  assert.equal(harness.runtime.getStatus().stream.state, 'offline');
  assert.equal(harness.runtime.getStatus().stream.viewerCount, 0,
    'a confirmed offline snapshot clears any count observed during Checking');
  await harness.runtime.shutdown();
});

test('unrelated, malformed, and invalid viewer-count events are ignored', async () => {
  const harness = runtimeFixture();
  await harness.runtime.start();
  harness.gatewayInput.onStatus({ state: 'connected' });
  await flushMicrotasks();
  await harness.gatewayInput.onEvent(viewerCountEvent('valid-viewer-count', 11));
  const publishedAfterValidCount = harness.published.length;

  const invalidEvents = [
    gatewayLog({ v: 2, type: 'tipped', topic: 'stream.viewer_count', data: { number_of_viewers: 90 } }),
    gatewayLog({ v: 2, type: 'viewer_count_updated', topic: 'chat.message', data: { number_of_viewers: 91 } }),
    gatewayLog({ v: 2, type: 'viewer_count_updated', topic: 'stream.viewer_count', data: {} }),
    gatewayLog({ v: 2, type: 'viewer_count_updated', topic: 'stream.viewer_count', data: { number_of_viewers: '12' } }),
    gatewayLog({ v: 2, type: 'viewer_count_updated', topic: 'stream.viewer_count', data: { number_of_viewers: -1 } }),
    gatewayLog({ v: 2, type: 'viewer_count_updated', topic: 'stream.viewer_count', data: { number_of_viewers: 1.5 } }),
    gatewayLog({ v: 2, type: 'viewer_count_updated', topic: 'stream.viewer_count', data: { number_of_viewers: Number.NaN } }),
    gatewayLog({ v: 2, type: 'viewer_count_updated', topic: 'stream.viewer_count', data: { number_of_viewers: Number.POSITIVE_INFINITY } }),
    gatewayLog({ v: 2, type: 'viewer_count_updated', topic: 'stream.viewer_count', data: { number_of_viewers: Number.MAX_SAFE_INTEGER + 1 } }),
    gatewayLog({ v: 1, type: 'viewer_count_updated', topic: 'stream.viewer_count', data: { number_of_viewers: 92 } }),
    gatewayLog(null),
    { receivedAt: '2026-11-07T12:00:00.000Z' },
  ];
  for (const event of invalidEvents) await harness.gatewayInput.onEvent(event);

  assert.equal(harness.runtime.getStatus().stream.viewerCount, 11);
  assert.equal(harness.published.length, publishedAfterValidCount,
    'ignored events must not publish a status update');
  await harness.runtime.shutdown();
});

test('viewer count is shown in the first panel, not repeated in the TODO list', () => {
  const html = renderShellPage('ready', 'Prismata desktop');
  assert.doesNotMatch(html, /id="joystick-viewer-count"|>0 viewers</,
    'the TODO list has no duplicate viewer count');
  assert.match(html, /id="todo-tab"[^>]*aria-selected="true"/,
    'the TODO tab is selected first');
  assert.match(html, /id="panel-viewer-count">0</,
    'the first panel count starts at zero');
});

test('the first-panel viewer count follows pushed status updates', async () => {
  const html = renderShellPage('ready', 'Prismata desktop');
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, 'the shell page includes its UI script');
  let publishStatus: ((status: RuntimeStatus) => void) | undefined;
  let publishAuthState: ((snapshot: { state: string }) => void) | undefined;
  let signInCalls = 0;
  let signOutCalls = 0;
  const elements = new Map<string, Record<string, any>>();
  const makeElement = () => ({
    textContent: '', innerHTML: '', value: '', checked: false, hidden: false, disabled: false, className: '',
    attributes: new Map<string, string>(),
    classList: {
      classes: new Set<string>(),
      add(...names: string[]) { names.forEach((name) => this.classes.add(name)); },
      remove(...names: string[]) { names.forEach((name) => this.classes.delete(name)); },
      contains(name: string) { return this.classes.has(name); },
      toggle(name: string, force?: boolean) {
        const shouldAdd = force ?? !this.classes.has(name);
        if (shouldAdd) this.classes.add(name); else this.classes.delete(name);
        return shouldAdd;
      },
    },
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    append: (..._children: unknown[]) => {},
    replaceChildren: (..._children: unknown[]) => {},
    focus: () => {},
  });
  const document = {
    getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id)!;
    },
    createElement: makeElement,
  };
  const settings = Object.fromEntries(['followed', 'subscribed', 'resubscribed', 'giftSender']
    .map((rule) => [rule, { enabled: false, message: '' }]));
  const shellApi = {
    admin: {
      getStatus: async () => ({ state: 'offline', lanEnabled: false, protocol: 'https', discovery: 'stopped' }),
      listNetworkInterfaces: async () => [], listDevices: async () => [], listConnectionRequests: async () => [],
      setLanEnabled: async () => ({}), setAdvertisedAddress: async () => ({}), retryAdvertising: async () => ({}),
      revokeDevice: async () => {}, approveConnectionRequest: async () => {},
    },
    auth: {
      onStateChanged(listener: (snapshot: { state: string }) => void) { publishAuthState = listener; return () => {}; },
      getSnapshot: async () => ({ state: 'signed-out' }),
      signInWithJoystick: async () => { signInCalls += 1; },
      signOut: async () => { signOutCalls += 1; }, cancel: () => {},
    },
    joystickWhispers: {
      onStatusChanged(listener: (status: RuntimeStatus) => void) { publishStatus = listener; return () => {}; },
      getStatus: async (): Promise<RuntimeStatus> => ({
        connection: { state: 'connected', message: null },
        delivery: { state: 'idle', rule: null, message: null },
        stream: { state: 'unknown', viewerCount: 0 },
      }),
      getSettings: async () => settings,
      updateSettings: async (next: unknown) => next,
    },
    todos: { onListChanged: () => () => {}, list: async () => [], add: async () => ({}), complete: async () => {} },
    tipHistory: { onListChanged: () => () => {}, list: async () => [] },
    reminder: {
      list: async () => [], create: async () => {}, updateRecord: async () => {}, remove: async () => {},
      test: async () => {}, testRecord: async () => {},
    },
    directMessage: { send: async () => {} },
  };

  runInNewContext(script!, {
    document,
    window: { prismataDesktop: shellApi, addEventListener: () => {} },
    setInterval: () => 0,
    confirm: () => true,
  });
  await flushMicrotasks();
  const joystickButton = elements.get('joystick-connect')!;
  assert.equal(joystickButton.classList.contains('connected'), false, 'the Joystick button starts disconnected and grayscale');
  assert.equal(joystickButton.attributes.get('aria-pressed'), 'false');
  await joystickButton.onclick();
  assert.equal(signInCalls, 1, 'clicking while disconnected starts the Joystick authentication flow');
  publishAuthState!({ state: 'authenticated' });
  assert.equal(joystickButton.classList.contains('connected'), true, 'authentication colors the connection button');
  assert.equal(joystickButton.attributes.get('aria-pressed'), 'true');
  await joystickButton.onclick();
  assert.equal(signOutCalls, 1, 'clicking while connected signs out');
  const observedPanelCounts = [elements.get('panel-viewer-count')?.textContent ?? '<missing>'];
  assert.equal(elements.has('joystick-viewer-count'), false, 'renderer no longer looks for a TODO-panel viewer count');
  assert.equal(typeof publishStatus, 'function');

  for (const count of [11, 12, 11]) {
    publishStatus!({
      connection: { state: 'connected', message: null },
      delivery: { state: 'idle', rule: null, message: null },
      stream: { state: 'live', viewerCount: count },
    });
    observedPanelCounts.push(elements.get('panel-viewer-count')?.textContent ?? '<missing>');
  }
  assert.deepEqual(observedPanelCounts, ['0', '11', '12', '11'],
    'the first-panel count follows pushed runtime status');
});
