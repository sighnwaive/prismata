import assert from 'node:assert/strict';
import test from 'node:test';
import { createJoystickActionCableGateway } from '../src/joystick-gateway.js';

type SocketListener = (event: { data?: string; code?: number; reason?: string }) => void;

class FakeSocket {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, SocketListener[]>();
  closed = false;

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string) { this.sent.push(value); }
  close() { this.closed = true; this.emit('close', { code: 1000 }); }
  emit(type: string, event: { data?: string; code?: number; reason?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  frame(value: unknown) { this.emit('message', { data: JSON.stringify(value) }); }
}

const gatewayIdentifier = JSON.stringify({ channel: 'GatewayChannel', event_version: 'v2' });

test('ActionCable handshake uses the required protocol and exact v2 subscription and gates events on confirmation', async () => {
  const sockets: FakeSocket[] = [];
  const socketCalls: Array<{ url: string; protocols: string[] }> = [];
  const received: unknown[] = [];
  const gateway = createJoystickActionCableGateway({
    getAccessToken: () => 'access token',
    getGrantedPermissions: () => ['stream:read', 'chat:whisper:write'],
    socketFactory: (url: string, protocols: string[]) => {
      socketCalls.push({ url, protocols });
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onEvent: (event: unknown) => { received.push(event); },
  });

  await gateway.start();
  assert.equal(socketCalls[0]?.protocols[0], 'actioncable-v1-json');
  const url = new URL(socketCalls[0]!.url);
  assert.equal(url.href.split('?')[0], 'wss://api.joystick.tv/cable');
  assert.equal(url.searchParams.get('token'), 'access token');

  sockets[0]!.frame({ type: 'welcome' });
  const subscription = JSON.stringify({ command: 'subscribe', identifier: JSON.stringify({ channel: 'GatewayChannel', event_version: 'v2' }) });
  assert.deepEqual(sockets[0]!.sent, [subscription]);
  sockets[0]!.frame({ type: 'message', identifier: gatewayIdentifier, message: { v: 2, type: 'followed', id: 'before-confirm', data: { who: 'Follower' } } });
  assert.deepEqual(received, []);

  sockets[0]!.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
  const event = { v: 2, type: 'followed', id: 'confirmed', data: { who: 'Follower' } };
  sockets[0]!.frame({ type: 'message', identifier: gatewayIdentifier, message: event });
  assert.deepEqual(received, [event]);
  await gateway.stop();
});

test('type message frames require the exact confirmed GatewayChannel v2 identifier before observation or dispatch', async () => {
  const sockets: FakeSocket[] = [];
  const observed: unknown[] = [];
  const received: unknown[] = [];
  const event = { v: 2, type: 'followed', id: 'identifier-gated', data: { who: 'Follower' } };
  const gateway = createJoystickActionCableGateway({
    getAccessToken: () => 'access token',
    getGrantedPermissions: () => ['stream:read'],
    socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    onEventEnvelope: (envelope: unknown) => { observed.push(envelope); },
    onEvent: (envelope: unknown) => { received.push(envelope); },
  });

  await gateway.start();
  const socket = sockets[0]!;
  socket.frame({ type: 'welcome' });
  socket.frame({ type: 'message', identifier: gatewayIdentifier, message: event });
  assert.deepEqual({ observed, received }, { observed: [], received: [] }, 'a matching identifier is insufficient before subscription confirmation');

  socket.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
  socket.frame({ type: 'message', identifier: JSON.stringify({ channel: 'OtherChannel', event_version: 'v2' }), message: event });
  socket.frame({ type: 'message', message: event });
  socket.frame({ type: 'message', identifier: '{"event_version":"v2","channel":"GatewayChannel"}', message: event });
  assert.deepEqual({ observed, received }, { observed: [], received: [] }, 'other, missing, and non-exact identifiers must not reach diagnostics or consumers');

  socket.frame({ type: 'message', identifier: gatewayIdentifier, message: event });
  assert.deepEqual({ observed, received }, { observed: [event], received: [event] });
  await gateway.stop();
});

test('gateway forwards nested v2 events only from the confirmed channel when the outer frame has no type', async () => {
  const sockets: FakeSocket[] = [];
  const received: unknown[] = [];
  const gateway = createJoystickActionCableGateway({
    getAccessToken: () => 'access token',
    getGrantedPermissions: () => ['stream:read', 'chat:whisper:write'],
    socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    onEvent: (event: unknown) => { received.push(event); },
  });

  await gateway.start();
  const identifier = JSON.stringify({ channel: 'GatewayChannel', event_version: 'v2' });
  sockets[0]!.frame({ type: 'welcome' });
  sockets[0]!.frame({ type: 'confirm_subscription', identifier });

  const event = { v: 2, type: 'followed', id: 'fixture-followed-event', data: { who: 'Fixture Follower' } };
  sockets[0]!.frame({ identifier: JSON.stringify({ channel: 'OtherChannel', event_version: 'v2' }), message: event });
  assert.deepEqual(received, [], 'a nested event from a different channel must not be forwarded');

  sockets[0]!.frame({ identifier, message: event });
  assert.deepEqual(received, [event], 'a matching confirmed channel must forward the nested v2 event');

  const viewerCountEvent = {
    v: 2,
    type: 'viewer_count_updated',
    topic: 'stream.viewer_count',
    id: 'gateway-viewer-count',
    data: { number_of_viewers: 27 },
  };
  sockets[0]!.frame({ type: 'message', identifier, message: viewerCountEvent });
  assert.deepEqual(received, [event, viewerCountEvent],
    'the ActionCable message wrapper is removed and the actual viewer-count event reaches the runtime unchanged');
  await gateway.stop();
});

test('gateway never logs raw text frames or event payloads at any console level', async () => {
  const event = { v: 2, type: 'followed', id: 'raw-frame-event', data: { who: 'Follower' } };
  const frames = [
    '{"type":"welcome"}',
    '{"type":"unrecognized","marker":"unfiltered-frame"}',
    'not-json',
    `{"type":"confirm_subscription","identifier":${JSON.stringify(JSON.stringify({ channel: 'GatewayChannel', event_version: 'v2' }))}}`,
    JSON.stringify({ type: 'message', identifier: gatewayIdentifier, message: { v: 1, type: 'followed', id: 'wrong-version' } }),
    JSON.stringify({ type: 'message', identifier: gatewayIdentifier, message: event }),
  ];
  const accessToken = 'gateway-access-token-must-never-be-logged';
  const originals = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const sockets: FakeSocket[] = [];
  const consoleCalls: unknown[][] = [];
  const forwarded: unknown[] = [];
  const gateway = createJoystickActionCableGateway({
    getAccessToken: () => accessToken,
    getGrantedPermissions: () => ['stream:read', 'chat:whisper:write'],
    socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    onEvent: (received: unknown) => { forwarded.push(received); },
  });
  const capture = (...args: unknown[]) => { consoleCalls.push(args); };
  console.log = capture;
  console.debug = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;

  try {
    await gateway.start();
    for (const frame of frames) sockets[0]!.emit('message', { data: frame });

    assert.deepEqual(forwarded, [event], 'only a valid v2 event is forwarded');
    const diagnostics = JSON.stringify(consoleCalls);
    assert.doesNotMatch(diagnostics, /gateway-access-token-must-never-be-logged/);
    for (const frame of frames) {
      assert.equal(diagnostics.includes(frame), false, `logs must not contain raw frame ${frame}`);
    }
    assert.equal(diagnostics.includes(JSON.stringify(event)), false, 'logs must not contain the event payload');
  } finally {
    try { await gateway.stop(); } finally {
      console.log = originals.log;
      console.debug = originals.debug;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
    }
  }
});

test('gateway replaces the socket with the refreshed token and bounds reconnect attempts', async () => {
  const sockets: FakeSocket[] = [];
  const calls: string[] = [];
  const delays: number[] = [];
  const scheduled: Array<() => Promise<void>> = [];
  let token = 'first-token';
  const gateway = createJoystickActionCableGateway({
    getAccessToken: () => token,
    getGrantedPermissions: () => ['stream:read', 'chat:whisper:write'],
    socketFactory: (url: string) => {
      calls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    maxReconnectAttempts: 2,
    reconnectDelayMs: (attempt: number) => attempt * 250,
    scheduleReconnect: async (callback: () => Promise<void>, delayMs: number) => {
      delays.push(delayMs);
      scheduled.push(callback);
    },
  });

  await gateway.start();
  token = 'rotated-token';
  await gateway.updateAccessToken(token);
  assert.equal(sockets[0]?.closed, true);
  assert.equal(new URL(calls.at(-1)!).searchParams.get('token'), 'rotated-token');

  sockets.at(-1)!.emit('close', { code: 1006, reason: 'network lost' });
  assert.deepEqual(delays, [250]);
  await scheduled.shift()!();
  sockets.at(-1)!.emit('close', { code: 1006, reason: 'network lost' });
  assert.deepEqual(delays, [250, 500]);
  await scheduled.shift()!();
  sockets.at(-1)!.emit('close', { code: 1006, reason: 'network lost' });
  assert.equal(delays.length, 2, 'reconnect attempts must stop at the configured bound');
  assert.equal(gateway.getStatus().state, 'unavailable');
  await gateway.stop();
});

test('gateway reports connected/reconnecting/unavailable and closes on sign-out and shutdown', async () => {
  const sockets: FakeSocket[] = [];
  const states: string[] = [];
  const gateway = createJoystickActionCableGateway({
    getAccessToken: () => 'access-token',
    getGrantedPermissions: () => ['stream:read', 'chat:whisper:write'],
    socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    onStatus: (status: { state: string }) => { states.push(status.state); },
    maxReconnectAttempts: 0,
    scheduleReconnect: async () => {},
  });

  await gateway.start();
  assert.equal(gateway.getStatus().state, 'reconnecting');
  sockets[0]!.frame({ type: 'welcome' });
  sockets[0]!.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
  assert.equal(gateway.getStatus().state, 'connected');
  await gateway.signOut();
  assert.equal(sockets[0]!.closed, true);
  assert.equal(gateway.getStatus().state, 'unavailable');

  await gateway.start();
  await gateway.shutdown();
  assert.equal(sockets.at(-1)!.closed, true);
  assert.ok(states.includes('connected'));
  assert.ok(states.includes('unavailable'));
});

test('gateway creates no socket without the actual stream:read grant', async () => {
  for (const grants of [[], ['chat:whisper:write']]) {
    const sockets: FakeSocket[] = [];
    const forwarded: unknown[] = [];
    const gateway = createJoystickActionCableGateway({
      getAccessToken: () => 'access-token',
      getGrantedPermissions: () => grants,
      socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      onEvent: (event: unknown) => { forwarded.push(event); },
      maxReconnectAttempts: 0,
      scheduleReconnect: async () => {},
    });

    await gateway.start();
    assert.equal(sockets.length, 0, `grants ${JSON.stringify(grants)} must not open a socket`);
    assert.deepEqual(forwarded, [], `grants ${JSON.stringify(grants)} must not forward gateway events`);
    assert.notEqual(gateway.getStatus().state, 'connected');
    await gateway.stop();
  }
});

test('gateway connects and captures events with stream:read when chat:whisper:write is absent', async () => {
  const sockets: FakeSocket[] = [];
  const forwarded: unknown[] = [];
  const gateway = createJoystickActionCableGateway({
    getAccessToken: () => 'access-token',
    getGrantedPermissions: () => ['stream:read'],
    socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    onEvent: (event: unknown) => { forwarded.push(event); },
  });

  await gateway.start();
  assert.equal(sockets.length, 1);
  sockets[0]!.frame({ type: 'welcome' });
  sockets[0]!.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
  assert.equal(gateway.getStatus().state, 'connected', 'stream-only authorization is sufficient for event capture');
  const event = { v: 2, type: 'followed', id: 'stream-only-event', data: { who: 'Follower' } };
  sockets[0]!.frame({ type: 'message', identifier: gatewayIdentifier, message: event });
  assert.deepEqual(forwarded, [event]);
  await gateway.stop();
});
