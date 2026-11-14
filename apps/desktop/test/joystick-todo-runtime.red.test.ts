import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJoystickActionCableGateway } from '../src/joystick-gateway.js';
import { createJoystickWhisperRuntime } from '../electron/joystick-whisper-runtime.js';

type EventHandler = (event: unknown) => Promise<unknown>;
type GatewayInput = {
  getAccessToken: () => string | undefined;
  getGrantedPermissions: () => readonly string[];
  onEvent: EventHandler;
  onStatus: (status: { state: 'connected' | 'reconnecting' | 'unavailable' }) => void;
};

class FakeSocket {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(event: { data?: string; code?: number; reason?: string }) => void>>();
  addEventListener(type: string, listener: (event: { data?: string; code?: number; reason?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(value: string) { this.sent.push(value); }
  close() { this.emit('close', { code: 1000 }); }
  emit(type: string, event: { data?: string; code?: number; reason?: string }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  frame(value: unknown) { this.emit('message', { data: JSON.stringify(value) }); }
}

const gatewayIdentifier = JSON.stringify({ channel: 'GatewayChannel', event_version: 'v2' });

async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function streamResponse(live: boolean) {
  return new Response(JSON.stringify({ live }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('redemption handling shares the one confirmed gateway and ignores whisper permission, stream, and message gates', async () => {
  const sockets: FakeSocket[] = [];
  const receivedByTodo: unknown[] = [];
  let gatewayCreations = 0;
  const runtimeOptions = {
    desktopSettings: {
      getSettings: async () => ({ settings: { joystickWhispers: {
        followed: { enabled: false, message: '' },
        subscribed: { enabled: false, message: '' },
        resubscribed: { enabled: false, message: '' },
        giftSender: { enabled: false, message: '' },
      } } }),
      saveSettings: async (settings: Record<string, unknown>) => ({ settings }),
    },
    auth: {
      getSession: () => ({ state: 'authenticated' as const, accessToken: 'stream-token', grantedPermissions: ['stream:read'] }),
      onStateChanged: () => () => {},
    },
    createGateway: (input: GatewayInput) => {
      gatewayCreations += 1;
      return createJoystickActionCableGateway({
        ...input,
        socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      });
    },
    todoEventHandler: async (event: unknown) => { receivedByTodo.push(event); },
    attemptStore: { claimWhisperAttempt: async () => true },
    sendWhisper: async () => assert.fail('stream-only redemption events must not attempt whisper delivery'),
    fetchImpl: async () => streamResponse(false),
  };
  const runtime = createJoystickWhisperRuntime(runtimeOptions as Parameters<typeof createJoystickWhisperRuntime>[0] & {
    todoEventHandler: (event: unknown) => Promise<unknown>;
  });

  try {
    await runtime.start();
    assert.equal(gatewayCreations, 1, 'TODOs attach to the existing runtime gateway, not a second socket');
    assert.equal(sockets.length, 1, 'stream:read opens the one event socket without chat:whisper:write');
    const socket = sockets[0]!;
    socket.frame({ type: 'welcome' });

    const tip = {
      v: 2, type: 'tipped', topic: 'channel.tip', id: 'tip-before-confirmation', occurred_at: '2026-11-04T18:27:36.000Z',
      data: { who: 'Ada', is_test: false, how_much: 18, tip_menu_item: { title: 'Blue heart' } },
    };
    socket.frame({ type: 'message', identifier: gatewayIdentifier, message: tip });
    await flushMicrotasks();
    assert.deepEqual(receivedByTodo, [], 'events are not consumed before GatewayChannel v2 subscription confirmation');

    socket.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
    await flushMicrotasks();
    assert.equal(runtime.getStatus().connection.state, 'connected');
    assert.equal(runtime.getStatus().stream.state, 'offline', 'the live-status snapshot is explicitly offline');
    const confirmedTip = { ...tip, id: 'tip-after-confirmation' };
    socket.frame({ type: 'message', identifier: gatewayIdentifier, message: confirmedTip });
    await flushMicrotasks();

    assert.deepEqual(receivedByTodo, [confirmedTip], 'the confirmed redemption reaches TODO handling despite offline stream status and absent whisper permission');
    assert.deepEqual(socket.sent, [JSON.stringify({ command: 'subscribe', identifier: gatewayIdentifier })],
      'event handling uses the existing ActionCable subscription');
  } finally {
    await runtime.shutdown();
  }
});

test('TODO event-processing failures are isolated so whisper delivery and gateway status continue', async () => {
  const sent: Array<{ username: string; text: string }> = [];
  let gatewayInput: GatewayInput | undefined;
  let gatewayStarts = 0;
  let todoAttempts = 0;
  const runtimeOptions = {
    desktopSettings: {
      getSettings: async () => ({ settings: { joystickWhispers: {
        followed: { enabled: true, message: 'Thanks for following' },
        subscribed: { enabled: false, message: '' },
        resubscribed: { enabled: false, message: '' },
        giftSender: { enabled: false, message: '' },
      } } }),
      saveSettings: async (settings: Record<string, unknown>) => ({ settings }),
    },
    auth: {
      getSession: () => ({ state: 'authenticated' as const, accessToken: 'stream-token', grantedPermissions: ['stream:read', 'chat:whisper:write'] }),
      onStateChanged: () => () => {},
    },
    createGateway: (input: GatewayInput) => {
      gatewayInput = input;
      return {
        start: async () => { gatewayStarts += 1; },
        updateAccessToken: async () => {},
        stop: async () => {},
      };
    },
    todoEventHandler: async () => { todoAttempts += 1; throw new Error('TODO storage failed'); },
    attemptStore: { claimWhisperAttempt: async () => true },
    sendWhisper: async (_accessToken: string, whisper: { username: string; text: string }) => { sent.push(whisper); },
    fetchImpl: async () => streamResponse(true),
  };
  const runtime = createJoystickWhisperRuntime(runtimeOptions as Parameters<typeof createJoystickWhisperRuntime>[0] & {
    todoEventHandler: (event: unknown) => Promise<unknown>;
  });

  try {
    await runtime.start();
    gatewayInput!.onStatus({ state: 'connected' });
    await flushMicrotasks();
    const event = {
      v: 2, type: 'followed', id: 'follow-with-todo-failure', occurred_at: '2026-11-04T18:27:36.000Z',
      data: { who: 'Bea' },
    };
    const outcome = await gatewayInput!.onEvent(event).then(() => 'fulfilled', () => 'rejected');

    assert.deepEqual({
      outcome,
      todoAttempts,
      sent,
      gatewayStarts,
      connectionState: runtime.getStatus().connection.state,
    }, {
      outcome: 'fulfilled',
      todoAttempts: 1,
      sent: [{ username: 'Bea', text: 'Thanks for following' }],
      gatewayStarts: 1,
      connectionState: 'connected',
    }, 'TODO failure must be contained while the shared gateway and whisper consumer continue');
  } finally {
    await runtime.shutdown();
  }
});

test('Electron main wires lifecycle-backed TODO persistence into the shared, ungated gateway event path', () => {
  const mainSource = readFileSync(fileURLToPath(new URL('../electron/main.mjs', import.meta.url)), 'utf8');
  const runtimeSource = readFileSync(fileURLToPath(new URL('../electron/joystick-whisper-runtime.ts', import.meta.url)), 'utf8');
  const runtimeStart = mainSource.indexOf('activeJoystickWhisperRuntime = createJoystickWhisperRuntime({');
  const runtimeEnd = mainSource.indexOf('\n  });', runtimeStart);
  assert.ok(runtimeStart >= 0 && runtimeEnd > runtimeStart, 'main composes one bounded whisper runtime');
  const runtimeComposition = mainSource.slice(runtimeStart, runtimeEnd);
  assert.match(runtimeComposition, /todoEventHandler\s*:/, 'main supplies the TODO event hook to the existing runtime');
  assert.match(runtimeComposition, /todoEventHandler\s*:[\s\S]*activeLifecycle[\s\S]*\.addTodoFromJoystickEvent\s*\(\s*parsed\s*\)/,
    'the event hook persists TODOs through the active desktop lifecycle/service');
  assert.match(runtimeComposition, /createGateway\s*:\s*\(gatewayInput\)\s*=>\s*createJoystickActionCableGateway\(/,
    'the existing runtime gateway remains the single source of Joystick events');
  assert.equal((runtimeComposition.match(/createJoystickActionCableGateway\s*\(/g) ?? []).length, 1,
    'TODO handling must not create a second gateway or socket');

  const eventStart = runtimeSource.indexOf('async function handleEvent(event: unknown)');
  const eventEnd = runtimeSource.indexOf('\n  return {', eventStart);
  assert.ok(eventStart >= 0 && eventEnd > eventStart, 'runtime exposes a bounded shared event handler');
  const eventHandler = runtimeSource.slice(eventStart, eventEnd);
  const todoHookIndex = eventHandler.indexOf('input.todoEventHandler');
  const streamPermissionGateIndex = eventHandler.indexOf("if (!session || !session.grantedPermissions.includes('stream:read'))");
  const whisperPermissionGateIndex = eventHandler.indexOf('if (!requiredPermissions.every');
  const liveGateIndex = eventHandler.indexOf('if (!isJoystickStreamLive');
  assert.ok(todoHookIndex >= 0, 'the shared runtime event handler invokes the supplied TODO hook');
  assert.ok(todoHookIndex < streamPermissionGateIndex && todoHookIndex < whisperPermissionGateIndex && todoHookIndex < liveGateIndex,
    'TODO handling runs before stream, whisper-permission, and live-stream delivery gates');
  assert.match(eventHandler,
    /try\s*\{\s*await\s+input\.todoEventHandler(?:\?\.)?\(event\);\s*\}\s*catch\s*\{/,
    'TODO persistence failures are caught separately and cannot interrupt whisper processing');
});
