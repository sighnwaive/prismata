import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtimeBoundary from '../electron/joystick-whisper-runtime.js';

type RuleName = 'followed' | 'subscribed' | 'resubscribed' | 'giftSender';
type Rule = { enabled: boolean; message: string };
type Rules = Record<RuleName, Rule>;
type Session = { state: 'authenticated'; accessToken: string; grantedPermissions: string[]; refreshToken?: string };
type ConnectionState = 'connected' | 'reconnecting' | 'unavailable';
type SanitizedStatus = {
  connection: { state: ConnectionState; message: string | null };
  delivery: { state: 'idle' | 'sent' | 'failed'; rule: RuleName | null; message: string | null };
};
type Attempt = { eventId: string; rule: RuleName; recipient: string; attemptedAt: string };

type GatewayInput = {
  getAccessToken: () => string | undefined;
  getGrantedPermissions: () => readonly string[];
  onEvent: (event: unknown) => Promise<void>;
  onStatus: (status: { state: ConnectionState }) => void;
};
type Gateway = {
  start: () => Promise<void>;
  updateAccessToken: (accessToken: string | undefined) => Promise<void>;
  stop: () => Promise<void>;
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
  createGateway: (input: GatewayInput) => Gateway;
  attemptStore: { claimWhisperAttempt: (attempt: Attempt) => Promise<boolean> };
  sendWhisper: (accessToken: string, whisper: { username: string; text: string }) => Promise<void>;
  logError?: (message: string, diagnostic: string) => void;
  sendPublicChat?: (accessToken: string, text: string) => Promise<unknown>;
  fetchImpl?: (url: string | URL, init?: RequestInit) => Promise<Response>;
};
type Runtime = {
  start: () => Promise<void>;
  shutdown: () => Promise<void>;
  getSettings: () => Promise<Rules>;
  updateSettings: (settings: Rules) => Promise<Rules>;
  getChatAutomationSettings: () => Promise<{ dropIn: { enabled: boolean; messages: string[] } }>;
  updateChatAutomationSettings: (settings: { dropIn: { enabled: boolean; messages: string[] } }) => Promise<{ dropIn: { enabled: boolean; messages: string[] } }>;
  getStatus: () => SanitizedStatus;
  onStatusChanged: (listener: (status: SanitizedStatus) => void) => () => void;
};

const createRuntime = (runtimeBoundary as unknown as {
  createJoystickWhisperRuntime?: (options: RuntimeOptions) => Runtime;
}).createJoystickWhisperRuntime;

const enabledRules: Rules = {
  followed: { enabled: true, message: 'Thanks for following' },
  subscribed: { enabled: true, message: 'Thanks for subscribing' },
  resubscribed: { enabled: true, message: 'Thanks for resubscribing' },
  giftSender: { enabled: true, message: 'Thanks for the gifts' },
};

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function event(id: string, marker = 'raw-event-payload-secret') {
  return {
    v: 2,
    type: 'followed',
    id,
    channel_id: 'channel-1',
    occurred_at: '2026-10-25T12:00:00Z',
    text: 'Follower',
    data: { who: 'Follower', untrustedDiagnosticPayload: marker },
  };
}

function fixture(input: {
  settings?: Record<string, unknown>;
  session?: Session | null;
  beforeSettingsRead?: () => Promise<void>;
  sendWhisper?: RuntimeOptions['sendWhisper'];
  logError?: RuntimeOptions['logError'];
  sendPublicChat?: RuntimeOptions['sendPublicChat'];
  fetchImpl?: RuntimeOptions['fetchImpl'];
} = {}) {
  let storedSettings = input.settings ?? { joystickWhispers: enabledRules, theme: 'midnight', unrelated: { keep: true } };
  let session = input.session === undefined ? {
    state: 'authenticated' as const,
    accessToken: 'token-secret-initial',
    grantedPermissions: ['stream:read', 'chat:whisper:write'],
  } : input.session;
  const authListeners: Array<() => void> = [];
  const gatewayCalls: Array<{ method: string; token?: string; grants?: string[] }> = [];
  const attempts: Attempt[] = [];
  const sends: Array<{ accessToken: string; username: string; text: string }> = [];
  const publicChatSends: Array<{ accessToken: string; text: string }> = [];
  const statuses: SanitizedStatus[] = [];
  let gatewayInput: GatewayInput | undefined;
  const runtime = createRuntime!({
    desktopSettings: {
      getSettings: async () => {
        await input.beforeSettingsRead?.();
        return { settings: storedSettings };
      },
      saveSettings: async (settings) => {
        storedSettings = settings;
        return { settings: storedSettings };
      },
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
    createGateway: (gateway) => {
      gatewayInput = gateway;
      return {
        start: async () => gatewayCalls.push({ method: 'start', token: gateway.getAccessToken(), grants: [...gateway.getGrantedPermissions()] }),
        updateAccessToken: async (token) => gatewayCalls.push({ method: 'update', token, grants: [...gateway.getGrantedPermissions()] }),
        stop: async () => { gatewayCalls.push({ method: 'stop' }); },
      };
    },
    attemptStore: {
      claimWhisperAttempt: async (attempt) => {
        attempts.push(attempt);
        return true;
      },
    },
    sendWhisper: async (accessToken, whisper) => {
      sends.push({ accessToken, ...whisper });
      await input.sendWhisper?.(accessToken, whisper);
    },
    logError: input.logError,
    sendPublicChat: async (accessToken, text) => {
      publicChatSends.push({ accessToken, text });
      return input.sendPublicChat?.(accessToken, text);
    },
    fetchImpl: input.fetchImpl ?? (async () => new Response(JSON.stringify({ live: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  });
  runtime.onStatusChanged((status) => statuses.push(status));

  return {
    runtime,
    sends,
    publicChatSends,
    attempts,
    statuses,
    gatewayCalls,
    get gatewayInput() { return gatewayInput!; },
    get storedSettings() { return storedSettings; },
    setSession(next: Session | null) {
      session = next;
      for (const listener of [...authListeners]) listener();
    },
  };
}

async function connectLive(harness: ReturnType<typeof fixture>) {
  harness.gatewayInput.onStatus({ state: 'connected' });
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

test('Electron runtime composes normalized local whisper settings without clobbering other desktop settings and wires durable attempts', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the pure whisper runtime composition boundary');
  const harness = fixture({
    settings: {
      theme: 'midnight',
      unrelated: { keep: true },
      joystickWhispers: {
        followed: { enabled: true, message: 'Follow thanks' },
        subscribed: { enabled: 'yes', message: 7 },
        resubscribed: { enabled: true, message: '  ' },
        giftSender: { enabled: false, message: 'Gift thanks' },
      },
    },
  });

  assert.deepEqual(await harness.runtime.getSettings(), {
    followed: { enabled: true, message: 'Follow thanks' },
    subscribed: { enabled: false, message: '' },
    resubscribed: { enabled: false, message: '' },
    giftSender: { enabled: false, message: 'Gift thanks' },
  });
  await harness.runtime.updateSettings(enabledRules);
  assert.deepEqual(harness.storedSettings.theme, 'midnight');
  assert.deepEqual(harness.storedSettings.unrelated, { keep: true });
  assert.deepEqual(harness.storedSettings.joystickWhispers, enabledRules);

  await harness.runtime.start();
  await connectLive(harness);
  await harness.gatewayInput.onEvent(event('runtime-follow'));
  assert.deepEqual(harness.sends, [{
    accessToken: 'token-secret-initial', username: 'Follower', text: 'Thanks for following',
  }]);
  assert.deepEqual(harness.attempts.map(({ eventId, rule, recipient }) => ({ eventId, rule, recipient })), [
    { eventId: 'runtime-follow', rule: 'followed', recipient: 'Follower' },
  ], 'the runtime must supply the durable attempt store to whisper automation');
  await harness.runtime.shutdown();
});

test('Drop-in chat automation sends configured public messages in order and deduplicates each event', async () => {
  const harness = fixture({
    settings: {
      joystickWhispers: enabledRules,
      joystickChatAutomations: { dropIn: { enabled: true, messages: ['Welcome in!', 'Enjoy the stream.'] } },
    },
    session: { state: 'authenticated', accessToken: 'public-chat-token', grantedPermissions: ['stream:read', 'chat:write'] },
  });
  await harness.runtime.start();
  await connectLive(harness);
  const dropIn = {
    v: 2, type: 'stream_dropped_in', id: 'drop-in-event-1', channel_id: 'channel-1',
    occurred_at: '2026-11-13T06:49:07Z', text: 'SlyShindiXXX and friends dropped in!',
    data: { who: 'SlyShindiXXX', number_of_viewers: 4 },
  };
  await harness.gatewayInput.onEvent(dropIn);
  await harness.gatewayInput.onEvent(dropIn);
  assert.deepEqual(harness.publicChatSends, [
    { accessToken: 'public-chat-token', text: 'Welcome in!' },
    { accessToken: 'public-chat-token', text: 'Enjoy the stream.' },
  ], 'all configured public messages are sent in order once for the event');
  assert.deepEqual(harness.sends, [], 'Drop-in public chat does not use the private whisper route');
  await harness.runtime.shutdown();
});

test('Drop-in delivery claims an event before awaiting settings so concurrent duplicate frames cannot send twice', async () => {
  const settingsRead = deferred();
  const settingsReadStarted = deferred();
  const harness = fixture({
    settings: { joystickChatAutomations: { dropIn: { enabled: true, messages: ['Welcome!'] } } },
    session: { state: 'authenticated', accessToken: 'public-chat-token', grantedPermissions: ['stream:read', 'chat:write'] },
    beforeSettingsRead: async () => { settingsReadStarted.release(); await settingsRead.promise; },
  });
  await harness.runtime.start();
  await connectLive(harness);
  const dropIn = { v: 2, type: 'stream_dropped_in', id: 'drop-in-concurrent', data: { who: 'Viewer' } };
  const first = harness.gatewayInput.onEvent(dropIn);
  await settingsReadStarted.promise;
  await harness.gatewayInput.onEvent(dropIn);
  assert.deepEqual(harness.publicChatSends, [], 'the first event is paused before delivery and the duplicate is ignored');
  settingsRead.release();
  await first;
  assert.deepEqual(harness.publicChatSends, [{ accessToken: 'public-chat-token', text: 'Welcome!' }]);
  await harness.runtime.shutdown();
});

test('chat automation settings normalize on read and preserve unrelated settings on update', async () => {
  const harness = fixture({
    settings: {
      theme: 'midnight',
      joystickChatAutomations: { dropIn: { enabled: true, messages: [' Welcome! ', ''] } },
    },
  });
  assert.deepEqual(await harness.runtime.getChatAutomationSettings(), {
    dropIn: { enabled: true, messages: ['Welcome!'] },
  });
  const saved = await harness.runtime.updateChatAutomationSettings({
    dropIn: { enabled: true, messages: ['Hello!', 'Enjoy!'] },
  });
  assert.deepEqual(saved, { dropIn: { enabled: true, messages: ['Hello!', 'Enjoy!'] } });
  assert.equal(harness.storedSettings.theme, 'midnight');
  await harness.runtime.shutdown();
});

test('Drop-in chat automation requires the actual chat:write grant', async () => {
  const harness = fixture({
    settings: { joystickChatAutomations: { dropIn: { enabled: true, messages: ['Welcome!'] } } },
    session: { state: 'authenticated', accessToken: 'without-chat-write', grantedPermissions: ['stream:read', 'chat:whisper:write'] },
  });
  await harness.runtime.start();
  await connectLive(harness);
  await harness.gatewayInput.onEvent({ v: 2, type: 'stream_dropped_in', id: 'no-chat-write', data: { who: 'Viewer' } });
  assert.deepEqual(harness.publicChatSends, [], 'requested scopes cannot substitute for actual chat:write permission');
  await harness.runtime.shutdown();
});

test('runtime starts and refreshes the gateway from the current authenticated session, gates events on actual grants, and stops on sign-out/shutdown', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the pure whisper runtime composition boundary');
  const harness = fixture({
    session: { state: 'authenticated', accessToken: 'token-secret-before-grant', grantedPermissions: ['stream:read'] },
  });

  await harness.runtime.start();
  assert.deepEqual(harness.gatewayCalls[0], {
    method: 'start', token: 'token-secret-before-grant', grants: ['stream:read'],
  });
  harness.gatewayInput.onStatus({ state: 'connected' });
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await harness.gatewayInput.onEvent(event('missing-whisper-grant'));
  assert.deepEqual(harness.sends, [], 'requested OAuth scopes must not substitute for actual grants');
  assert.deepEqual(harness.attempts, [], 'without chat:whisper:write, the event must not create a whisper attempt');
  assert.equal(harness.runtime.getStatus().connection.state, 'connected', 'skipping whisper delivery must not mark the stream gateway unavailable');
  assert.deepEqual(harness.runtime.getStatus().delivery, {
    state: 'idle', rule: null, message: null,
  }, 'an unavailable whisper grant must not be reported as a delivery failure');

  harness.setSession({
    state: 'authenticated',
    accessToken: 'token-secret-refreshed',
    grantedPermissions: ['stream:read', 'chat:whisper:write'],
  });
  assert.deepEqual(harness.gatewayCalls.at(-1), {
    method: 'update', token: 'token-secret-refreshed', grants: ['stream:read', 'chat:whisper:write'],
  });
  await connectLive(harness);
  await harness.gatewayInput.onEvent(event('granted-after-refresh'));
  assert.equal(harness.sends.at(-1)?.accessToken, 'token-secret-refreshed');

  harness.setSession(null);
  assert.equal(harness.gatewayCalls.at(-1)?.method, 'stop', 'sign-out must stop the gateway');
  await harness.runtime.shutdown();
  assert.equal(harness.gatewayCalls.at(-1)?.method, 'stop', 'application shutdown must stop the gateway');
});

test('runtime synchronizes authenticated sessions without logging granted permissions', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the pure whisper runtime composition boundary');
  const harness = fixture({
    session: {
      state: 'authenticated',
      accessToken: 'startup-access-token-must-not-be-logged',
      refreshToken: 'startup-refresh-token-must-not-be-logged',
      grantedPermissions: ['stream:read', 'chat:whisper:write', 'followers:read'],
    },
  });
  const consoleCalls: Array<{ method: string; args: unknown[] }> = [];
  const originals = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const methods = ['log', 'debug', 'info', 'warn', 'error'] as const;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => { consoleCalls.push({ method, args }); };
  }

  try {
    await harness.runtime.start();
    assert.deepEqual(harness.gatewayCalls[0]?.method, 'start', 'authenticated startup must still synchronize the gateway');
    assert.deepEqual(consoleCalls, [], 'startup must not print a permission list or permission debug log');

    harness.setSession({
      state: 'authenticated',
      accessToken: 'rotated-access-token-must-not-be-logged',
      refreshToken: 'rotated-refresh-token-must-not-be-logged',
      grantedPermissions: ['stream:read', 'chat:whisper:write'],
    });
    assert.deepEqual(harness.gatewayCalls.at(-1)?.method, 'update', 'authenticated refresh must still synchronize the gateway');
    assert.deepEqual(consoleCalls, [], 'token refresh must not print a permission list or permission debug log');
  } finally {
    try { await harness.runtime.shutdown(); } finally {
      for (const method of methods) console[method] = originals[method];
    }
  }
});

async function runDeliveryLoggingScenario(packaged = false) {
  const harness = fixture({
    logError: packaged ? undefined : (message, diagnostic) => console.error(message, diagnostic),
    sendWhisper: async (_accessToken, whisper) => {
      if (whisper.username === 'FailureRecipient') {
        throw new Error('HTTP 503 upstream unavailable; request URL https://api.joystick.tv/api/v1/chat/whispers; Authorization: Bearer access-token-must-not-leak; event ID event-id-must-not-leak; event-payload-marker-must-not-leak');
      }
    },
  });
  const consoleCalls: Array<{ method: string; args: unknown[] }> = [];
  const originals = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const methods = ['log', 'debug', 'info', 'warn', 'error'] as const;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => { consoleCalls.push({ method, args }); };
  }

  let sentStatus!: SanitizedStatus;
  let failedStatus!: SanitizedStatus;
  try {
    await harness.runtime.start();
    harness.gatewayInput.onStatus({ state: 'connected' });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    await harness.gatewayInput.onEvent({ ...event('delivery-success'), text: 'SuccessRecipient', data: { who: 'SuccessRecipient' } });
    sentStatus = harness.runtime.getStatus();
    await harness.gatewayInput.onEvent({
      ...event('delivery-failure', 'event-payload-marker-must-not-leak'),
      text: 'FailureRecipient',
      data: { who: 'FailureRecipient' },
    });
    failedStatus = harness.runtime.getStatus();
  } finally {
    try { await harness.runtime.shutdown(); } finally {
      for (const method of methods) console[method] = originals[method];
    }
  }

  return { consoleCalls, sentStatus, failedStatus, statuses: harness.statuses };
}

function assertDeliveryStatuses(
  result: Awaited<ReturnType<typeof runDeliveryLoggingScenario>>,
  build: string,
) {
  assert.deepEqual(result.sentStatus.delivery, {
    state: 'sent', rule: 'followed', message: 'Whisper sent.',
  }, `${build} successful delivery status must remain unchanged`);
  assert.deepEqual(result.failedStatus.delivery, {
    state: 'failed', rule: 'followed', message: 'Whisper delivery failed or could not be confirmed. It was not automatically retried.',
  }, `${build} failed delivery status must remain unchanged`);
  assert.equal(result.sentStatus.connection.state, 'connected');
  assert.equal(result.failedStatus.connection.state, 'connected');
  assert.ok(result.statuses.some(({ delivery }) => delivery.state === 'sent'), `${build} sent status must be published to the shell`);
  assert.ok(result.statuses.some(({ delivery }) => delivery.state === 'failed'), `${build} failed status must be published to the shell`);

  const serializedStatuses = JSON.stringify([result.sentStatus, result.failedStatus, ...result.statuses]);
  assert.doesNotMatch(serializedStatuses, /token-secret|raw-event-payload-secret|event-payload-marker-must-not-leak|Bearer/);
}

function assertNoVerboseDeliveryDiagnostics(
  result: Awaited<ReturnType<typeof runDeliveryLoggingScenario>>,
  build: string,
) {
  const diagnostics = JSON.stringify(result.consoleCalls);
  assert.doesNotMatch(
    diagnostics,
    /SuccessRecipient|FailureRecipient|Thanks for following|Joystick whisper delivery succeeded|delivery succeeded/i,
    `${build} diagnostics must not include recipient/request text or successful delivery details`,
  );
}

function assertSanitizedFailureConsoleError(
  result: Awaited<ReturnType<typeof runDeliveryLoggingScenario>>,
  build: string,
) {
  const failureErrors = result.consoleCalls.filter(({ method }) => method === 'error');
  assert.equal(failureErrors.length, 1, `${build} should retain one observable whisper failure console error`);
  const failureDiagnostic = JSON.stringify(failureErrors);
  assert.match(failureDiagnostic, /HTTP 503/);
  assert.match(failureDiagnostic, /upstream unavailable/);
  assert.doesNotMatch(failureDiagnostic, /FailureRecipient|Thanks for following|Authorization|Bearer|api\.joystick\.tv|event-id-must-not-leak|access-token-must-not-leak|event-payload-marker-must-not-leak/);
}

test('development whisper diagnostics omit verbose request/success details and preserve delivery statuses', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the pure whisper runtime composition boundary');
  const result = await runDeliveryLoggingScenario();
  assertDeliveryStatuses(result, 'development');
  assertNoVerboseDeliveryDiagnostics(result, 'development');
});

test('packaged whisper diagnostics omit verbose request/success details and preserve delivery statuses', async () => {
  assert.equal(typeof createRuntime, 'function', 'Electron main must expose the pure whisper runtime composition boundary');
  const result = await runDeliveryLoggingScenario(true);
  assertDeliveryStatuses(result, 'packaged');
  assertNoVerboseDeliveryDiagnostics(result, 'packaged');
  assert.deepEqual(result.consoleCalls, [], 'packaged delivery failures produce no console output');
});

test('development whisper failures remain observable as sanitized console errors', async () => {
  const result = await runDeliveryLoggingScenario();
  assertSanitizedFailureConsoleError(result, 'development');
});

test('packaged whisper failures update status without console output', async () => {
  const result = await runDeliveryLoggingScenario(true);
  assertDeliveryStatuses(result, 'packaged');
  assert.deepEqual(result.consoleCalls, [], 'packaged failures produce no console output');
});

test('shutdown fences an event paused at the settings boundary before it can start a whisper', async () => {
  const settingsReadStarted = deferred();
  const releaseSettingsRead = deferred();
  const harness = fixture({
    beforeSettingsRead: async () => {
      settingsReadStarted.release();
      await releaseSettingsRead.promise;
    },
  });

  await harness.runtime.start();
  await connectLive(harness);
  const inFlightEvent = harness.gatewayInput.onEvent(event('shutdown-in-flight'));
  await settingsReadStarted.promise;

  await harness.runtime.shutdown();
  releaseSettingsRead.release();
  await inFlightEvent;

  assert.deepEqual(harness.sends, [], 'an event resuming after shutdown must not start a whisper');
});
