import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDirectMessageSender } from '../src/direct-message.js';
import { createFlipACoinScheduler } from '../src/flip-a-coin-scheduler.js';
import {
  createAuthenticatedJoystickChatSender,
  createJoystickChatCooldown,
  createJoystickChatEventHandler,
} from '../src/joystick-chat.js';
import { createJoystickActionCableGateway } from '../src/joystick-gateway.js';
import { createJoystickWhisperClient } from '../src/joystick-whispers.js';

function chatMessageEvent(id: string, options: {
  bot?: boolean;
  visibility?: string;
  type?: string;
  topic?: string;
} = {}) {
  return {
    receivedAt: '2026-11-05T12:00:00.000Z',
    event: {
      v: 2,
      type: options.type ?? 'new_message',
      topic: options.topic ?? 'chat.message',
      id,
      channel_id: 'channel-1',
      occurred_at: '2026-11-05T12:00:00Z',
      text: 'A viewer message',
      data: {
        author: {
          username: 'viewer',
          nickname: 'Viewer',
          color: '#ffffff',
          verified: false,
          badges: { bot: options.bot ?? false, moderator: false },
        },
        streamer: { username: 'streamer' },
        subscription: null,
        text: 'A viewer message',
        visibility: options.visibility ?? 'public',
      },
    },
  };
}

async function send(cooldown: ChatCooldown, text: string, sent: string[]) {
  return cooldown.send(text, async () => { sent.push(text); });
}

test('successful public sends suppress the exact text until ten qualifying public chat messages', async () => {
  const cooldown = createJoystickChatCooldown();
  const sent: string[] = [];

  assert.equal(await send(cooldown, 'Thanks for watching', sent), true);
  assert.equal(await send(cooldown, 'Thanks for watching', sent), false);
  for (let index = 1; index <= 9; index += 1) {
    cooldown.onGatewayEvent(chatMessageEvent(`viewer-${index}`));
  }
  assert.equal(await send(cooldown, 'Thanks for watching', sent), false, 'the gate stays closed after only nine viewer messages');

  cooldown.onGatewayEvent(chatMessageEvent('viewer-10'));
  assert.equal(await send(cooldown, 'Thanks for watching', sent), true, 'the tenth viewer message opens the gate');
  assert.equal(await send(cooldown, 'Thanks for watching', sent), false, 'a successful resend starts a fresh counter of ten');
  assert.deepEqual(sent, ['Thanks for watching', 'Thanks for watching']);
});

test('bot, non-chat, and non-public events do not decrement active public-send counters', async () => {
  const cooldown = createJoystickChatCooldown();
  const sent: string[] = [];
  await send(cooldown, 'Same public text', sent);

  cooldown.onGatewayEvent(chatMessageEvent('bot-message', { bot: true }));
  cooldown.onGatewayEvent(chatMessageEvent('private-message', { visibility: 'private' }));
  cooldown.onGatewayEvent(chatMessageEvent('other-event', { type: 'followed' }));
  cooldown.onGatewayEvent(chatMessageEvent('other-topic', { topic: 'stream.online' }));
  assert.equal(await send(cooldown, 'Same public text', sent), false, 'ignored events leave all ten counts intact');

  for (let index = 0; index < 10; index += 1) {
    cooldown.onGatewayEvent(chatMessageEvent(`human-${index}`, { bot: false, visibility: 'public' }));
  }
  assert.equal(await send(cooldown, 'Same public text', sent), true, 'a public chat.message/new_message from a non-bot counts');
  assert.deepEqual(sent, ['Same public text', 'Same public text']);
});

test('cooldown keys use exact message text equality', async () => {
  const cooldown = createJoystickChatCooldown();
  const sent: string[] = [];
  await send(cooldown, 'Hello', sent);
  for (let index = 0; index < 9; index += 1) cooldown.onGatewayEvent(chatMessageEvent(`viewer-${index}`));

  assert.equal(await send(cooldown, 'hello', sent), true, 'case changes are distinct text');
  assert.equal(await send(cooldown, 'Hello ', sent), true, 'whitespace changes are distinct text');
  assert.equal(await send(cooldown, 'Hello', sent), false, 'the original exact text remains suppressed');
  assert.deepEqual(sent, ['Hello', 'hello', 'Hello ']);
});

test('only a successful public send starts a cooldown', async () => {
  const cooldown = createJoystickChatCooldown();
  let attempts = 0;

  await assert.rejects(cooldown.send('Retry after failure', async () => {
    attempts += 1;
    throw new Error('delivery failed');
  }), /delivery failed/);
  assert.equal(await cooldown.send('Retry after failure', async () => { attempts += 1; }), true);
  assert.equal(await cooldown.send('Retry after failure', async () => { attempts += 1; }), false);
  assert.equal(attempts, 2, 'failed delivery leaves the text eligible, then successful delivery closes the gate');
});

test('ordinary, scheduled, and reminder-test public sends share cooldown state', async () => {
  const cooldown = createJoystickChatCooldown();
  const sentByRoute: string[] = [];
  const senderFor = (route: string) => createAuthenticatedJoystickChatSender({
    getAccessToken: () => 'access-token',
    getStreamState: () => 'live',
    cooldown,
    createClient: () => ({
      sendMessage: async ({ text }) => {
        sentByRoute.push(`${route}: ${text}`);
        return {};
      },
    }),
  });
  const ordinarySender = senderFor('ordinary chat');
  const scheduledSender = senderFor('scheduled reminder');
  const reminderTestSender = senderFor('reminder test');
  const scheduler = createFlipACoinScheduler({
    send: scheduledSender,
    getSettings: () => ({ reminders: [{
      id: 'scheduled', enabled: true, task: 'custom-message', message: 'Reminder text',
      schedule: 'interval', intervalMinutes: 5, dailyTime: '09:00',
    }] }),
  });

  await ordinarySender({ message: 'Reminder text' });
  await scheduler.tick(new Date(2026, 10, 5, 12, 0));
  await reminderTestSender({ message: 'Reminder text' });
  assert.deepEqual(sentByRoute, ['ordinary chat: Reminder text'], 'the ordinary send suppresses both reminder public-send paths');

  for (let index = 0; index < 10; index += 1) cooldown.onGatewayEvent(chatMessageEvent(`viewer-${index}`));
  await scheduler.tick(new Date(2026, 10, 5, 12, 5));
  await reminderTestSender({ message: 'Reminder text' });
  assert.deepEqual(sentByRoute, ['ordinary chat: Reminder text', 'scheduled reminder: Reminder text'], 'successful scheduled delivery also suppresses the reminder-test sender');
});

test('the production composition shares the cooldown and receives validated Gateway events', async () => {
  const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  assert.match(mainSource, /const joystickChatCooldown = createJoystickChatCooldown\(\)/);
  assert.equal((mainSource.match(/cooldown: joystickChatCooldown/g) ?? []).length, 2,
    'both production public sender instances use the same cooldown');
  assert.match(mainSource, /onEvent: createJoystickChatEventHandler\(joystickChatCooldown, async \(event\) => \{\s*joystickChatFeed\.onGatewayEvent\(event\);\s*await gatewayInput\.onEvent\(event\);/,
    'the production Gateway callback shares events with the chat feed and then forwards them through the cooldown adapter');

  type Listener = (event: { data?: string }) => void;
  class FakeSocket {
    readonly listeners = new Map<string, Listener[]>();
    readonly sent: string[] = [];
    addEventListener(type: string, listener: Listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    send(value: string) { this.sent.push(value); }
    close() {}
    frame(value: unknown) {
      for (const listener of this.listeners.get('message') ?? []) listener({ data: JSON.stringify(value) });
    }
  }

  const cooldown = createJoystickChatCooldown();
  const socket = new FakeSocket();
  const sender = createAuthenticatedJoystickChatSender({
    getAccessToken: () => 'access-token',
    getStreamState: () => 'live',
    cooldown,
    createClient: () => ({ sendMessage: async () => ({}) }),
  });
  const gatewayIdentifier = JSON.stringify({ channel: 'GatewayChannel', event_version: 'v2' });
  const gateway = createJoystickActionCableGateway({
    getAccessToken: () => 'access-token',
    getGrantedPermissions: () => ['stream:read'],
    socketFactory: () => socket,
    onEvent: createJoystickChatEventHandler(cooldown, () => undefined),
  });

  await sender({ message: 'Gateway cooldown' });
  await gateway.start();
  socket.frame({ type: 'welcome' });
  socket.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
  for (let index = 0; index < 10; index += 1) {
    socket.frame({
      type: 'message',
      identifier: gatewayIdentifier,
      message: {
        v: 2,
        type: 'new_message',
        topic: 'chat.message',
        id: `gateway-viewer-${index}`,
        data: { author: { badges: { bot: false } }, visibility: 'public' },
      },
    });
  }
  await sender({ message: 'Gateway cooldown' });
  assert.equal(await cooldown.send('Gateway cooldown', async () => {}), false,
    'the successful resend through the public sender starts a fresh cooldown');
  await gateway.stop();
});

test('cooldown accepts both Gateway payloads and the event-log envelope shape', async () => {
  const cooldown = createJoystickChatCooldown();
  const sent: string[] = [];
  await send(cooldown, 'Envelope-aware text', sent);

  for (let index = 0; index < 5; index += 1) {
    cooldown.onGatewayEvent({
      receivedAt: '2026-11-05T12:00:00.000Z',
      event: chatMessageEvent(`logged-viewer-${index}`).event,
    });
  }
  for (let index = 5; index < 10; index += 1) {
    cooldown.onGatewayEvent(chatMessageEvent(`gateway-viewer-${index}`));
  }

  assert.equal(await send(cooldown, 'Envelope-aware text', sent), true,
    'both the raw Gateway payload and its persisted event-log envelope count as qualifying messages');
  assert.deepEqual(sent, ['Envelope-aware text', 'Envelope-aware text']);
});

test('the UI Direct message sender and whisper transport bypass public-send cooldowns', async () => {
  const cooldown = createJoystickChatCooldown();
  const publicSent: string[] = [];
  await send(cooldown, 'Same exact text', publicSent);
  assert.equal(await send(cooldown, 'Same exact text', publicSent), false);

  const directSent: string[] = [];
  const directSender = createDirectMessageSender({
    getAccessToken: () => 'access-token',
    getStreamState: () => 'live',
    createClient: () => ({ sendMessage: async ({ text }) => { directSent.push(text); return {}; } }),
  });
  await directSender('Same exact text');

  const whisperRequests: string[] = [];
  const whisperClient = createJoystickWhisperClient({
    accessToken: 'access-token',
    getStreamState: () => 'live',
    fetchImpl: async (url, init) => {
      whisperRequests.push(`${String(url)}:${String(init?.body)}`);
      return new Response(JSON.stringify({ sent: true, username: 'viewer' }), { status: 200 });
    },
  });
  await whisperClient.sendWhisper({ username: 'viewer', text: 'Same exact text' });

  assert.deepEqual(publicSent, ['Same exact text']);
  assert.deepEqual(directSent, ['Same exact text']);
  assert.deepEqual(whisperRequests, [
    'https://api.joystick.tv/api/v1/chat/whispers:{"username":"viewer","text":"Same exact text"}',
  ]);
});
