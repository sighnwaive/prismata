import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as preloadApiBoundary from '../electron/preload-api.js';
import { createJoystickChatFeed, generatedAuthorColor, JOYSTICK_CHAT_FEED_LIMIT, parseJoystickChatMessage } from '../src/joystick-chat-feed.js';
import { renderShellPage } from '../electron/shell-page.js';

function publicChatMessage(id: string, text = `message ${id}`, color?: string, username?: string) {
  return {
    v: 2,
    type: 'new_message',
    topic: 'chat.message',
    id,
    data: {
      visibility: 'public',
      author: { display_name: 'Ada', badges: { bot: false }, ...(color ? { color } : {}), ...(username ? { username } : {}) },
      text,
    },
  };
}

test('live chat parser accepts only public Joystick v2 messages and normalizes them to one line', () => {
  assert.deepEqual(parseJoystickChatMessage(publicChatMessage('chat-1', '  Hello\n  world <b>! </b>')), {
    id: 'chat-1', author: 'Ada', text: 'Hello world <b>! </b>', authorColor: generatedAuthorColor('Ada'),
  });
  assert.equal(parseJoystickChatMessage({ ...publicChatMessage('private'), data: { ...publicChatMessage('private').data, visibility: 'private' } }), null);
  assert.equal(parseJoystickChatMessage({ ...publicChatMessage('wrong-type'), type: 'tipped' }), null);
  assert.equal(parseJoystickChatMessage({ ...publicChatMessage('no-author'), data: { visibility: 'public', text: 'hello' } }), null);
  assert.equal(parseJoystickChatMessage(publicChatMessage('has-color', 'Hello', '#abc'))?.authorColor, '#abc');
  assert.equal(parseJoystickChatMessage(publicChatMessage('unsafe-color', 'Hello', 'red; background: url(javascript:alert(1))'))?.authorColor, generatedAuthorColor('Ada'));
  assert.equal(parseJoystickChatMessage(publicChatMessage('stable-handle-a', 'Hello', undefined, 'ada_01'))?.authorColor,
    parseJoystickChatMessage(publicChatMessage('stable-handle-b', 'Different display text', undefined, 'ADA_01'))?.authorColor,
    'fallback colors are keyed by normalized username, not current display name');
});

test('live chat feed keeps only the newest 26 unique messages and safely publishes snapshots', () => {
  const feed = createJoystickChatFeed();
  let received: Array<Array<{ id: string; author: string; text: string }>> = [];
  const unsubscribe = feed.onListChanged((messages) => received.push(messages));
  for (let index = 0; index < 30; index += 1) feed.onGatewayEvent(publicChatMessage(`chat-${index}`));
  feed.onGatewayEvent(publicChatMessage('chat-29'));
  const messages = feed.list();
  assert.equal(JOYSTICK_CHAT_FEED_LIMIT, 26);
  assert.equal(messages.length, 26);
  assert.equal(messages[0]?.id, 'chat-4');
  assert.equal(messages.at(-1)?.id, 'chat-29');
  assert.match(messages[0]!.authorColor, /^hsl\(/);
  assert.equal(messages[0]!.authorColor, generatedAuthorColor('Ada'), 'same username receives a stable fallback color');
  assert.equal(received.at(-1)?.length, 26);
  messages[0]!.text = 'mutated snapshot';
  assert.equal(feed.list()[0]?.text, 'message chat-4');
  unsubscribe();
  const updatesBefore = received.length;
  feed.onGatewayEvent(publicChatMessage('chat-30'));
  assert.equal(received.length, updatesBefore);
});

test('successfully sent Prismata messages append to chat history and reconcile a Gateway echo by server ID', () => {
  const feed = createJoystickChatFeed();
  feed.onGatewayEvent(publicChatMessage('chat-before', 'Earlier message'));
  const sentResponse = {
    data: {
      id: 'server-message-1',
      text: 'Sent from Prismata',
      author: { username: 'streamer', display_name: 'Streamer', color: '#123abc' },
    },
  };
  feed.onMessageSent('Sent from Prismata', sentResponse);
  assert.deepEqual(feed.list().map(({ id, author, text, authorColor }) => ({ id, author, text, authorColor })), [
    { id: 'chat-before', author: 'Ada', text: 'Earlier message', authorColor: generatedAuthorColor('Ada') },
    { id: 'server-message-1', author: 'Prismata', text: 'Sent from Prismata', authorColor: '#123abc' },
  ]);
  feed.onGatewayEvent({
    ...publicChatMessage('server-message-1', 'Sent from Prismata', '#123abc', 'streamer'),
    data: { ...publicChatMessage('server-message-1', 'Sent from Prismata', '#123abc', 'streamer').data,
      author: { ...publicChatMessage('server-message-1').data.author, username: 'streamer' } },
  });
  assert.equal(feed.list().length, 2, 'the server echo does not duplicate a sent message with a shared server ID');
});

test('sent chat without a response author or message ID uses a local row at the end of history', () => {
  const feed = createJoystickChatFeed();
  feed.onGatewayEvent(publicChatMessage('chat-before', 'Earlier message'));
  feed.onMessageSent('A local send', {});
  const sent = feed.list().at(-1);
  assert.deepEqual(sent && { id: sent.id, author: sent.author, text: sent.text }, {
    id: 'sent-local-1', author: 'Prismata', text: 'A local send',
  });
});

test('direct-message panel places a 26-line live chat feed above the message composer', () => {
  const page = renderShellPage('offline', 'Prismata');
  const liveChat = page.indexOf('id="joystick-chat-feed"');
  const messageInput = page.indexOf('id="direct-message-input"');
  assert.ok(liveChat >= 0 && messageInput > liveChat, 'live chat appears above the Message box');
  assert.doesNotMatch(page, /chat-feed-section|id="live-chat-heading"|>Live chat<\/h3>/,
    'the feed has no extra visible title or enclosing panel');
  assert.match(page, /\.chat-feed \{ height: 486px; box-sizing: border-box; overflow-y: auto;/);
  assert.match(page, /\.chat-message \{[^}]*height: 18px; line-height: 18px;[^}]*white-space: nowrap;/);
  assert.match(page, /messages\.slice\(-26\)/);
  assert.match(page, /author\.textContent = message\.author/);
  assert.match(page, /author\.style\.color = message\.authorColor/);
  assert.match(page, /body\.textContent = message\.text/);
});

test('typed live-chat preload API is read-only and unsubscribes safely', async () => {
  const createApi = (preloadApiBoundary as unknown as {
    createJoystickChatPreloadApi?: (input: Record<string, unknown>) => Record<string, any>;
  }).createJoystickChatPreloadApi;
  assert.equal(typeof createApi, 'function');
  if (!createApi) return;
  const entry = { id: 'chat-1', author: 'Ada', text: 'Hello' };
  let publish!: (messages: typeof entry[]) => void;
  let unsubscribed = false;
  const api = createApi({
    list: async () => [entry],
    onListChanged(listener: typeof publish) { publish = listener; return () => { unsubscribed = true; }; },
  });
  assert.deepEqual(Object.keys(api).sort(), ['list', 'onListChanged']);
  assert.deepEqual(await api.list(), [entry]);
  const received: Array<typeof entry[]> = [];
  const unsubscribe = api.onListChanged((messages: typeof entry[]) => received.push(messages));
  publish([entry]);
  unsubscribe();
  publish([]);
  assert.deepEqual(received, [[entry]]);
  assert.equal(unsubscribed, true);
});

test('sandboxed preload and main expose only the live-chat list and snapshot subscription', async () => {
  const preloadSource = await readFile(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const exposed: Record<string, any> = {};
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
  const invocations: string[] = [];
  const ipcRenderer = {
    invoke: async (channel: string) => { invocations.push(channel); return []; },
    on: (channel: string, handler: (event: unknown, payload: unknown) => void) => listeners.set(channel, handler),
    removeListener: (channel: string, handler: (event: unknown, payload: unknown) => void) => {
      if (listeners.get(channel) === handler) listeners.delete(channel);
    },
  };
  vm.runInNewContext(preloadSource, {
    require: (specifier: string) => {
      assert.equal(specifier, 'electron');
      return { contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { exposed[name] = value; } }, ipcRenderer };
    },
  }, { filename: 'preload.mjs' });
  const api = exposed.prismataDesktop?.joystickChat;
  assert.ok(api);
  assert.deepEqual(Object.keys(api).sort(), ['list', 'onListChanged']);
  assert.deepEqual(await api.list(), []);
  const snapshots: unknown[][] = [];
  const unsubscribe = api.onListChanged((messages: unknown[]) => snapshots.push(messages));
  const listener = listeners.get('joystick-chat:listChanged');
  assert.equal(typeof listener, 'function');
  listener?.({}, [{ id: 'chat-1' }]);
  unsubscribe();
  assert.equal(listeners.has('joystick-chat:listChanged'), false);
  assert.deepEqual(snapshots, [[{ id: 'chat-1' }]]);
  assert.deepEqual(invocations, ['joystick-chat:list']);
  assert.match(mainSource, /handle\('joystick-chat:list', \(\) => joystickChatFeed\.list\(\)\)/);
  assert.match(mainSource, /joystickChatFeed\.onGatewayEvent\(event\)/);
  assert.match(mainSource, /webContents\.send\('joystick-chat:listChanged', messages\)/);
  assert.match(mainSource, /const addSentJoystickChatMessage = \(text, response\) => joystickChatFeed\.onMessageSent\(text, response\)/);
  assert.equal((mainSource.match(/onMessageSent: addSentJoystickChatMessage/g) ?? []).length, 3,
    'direct, scheduled, and reminder-test public sends all appear in the shared chat history');
});
