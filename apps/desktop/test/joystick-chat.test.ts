import assert from 'node:assert/strict';
import test from 'node:test';
import { createJoystickChatClient, createAuthenticatedJoystickChatSender } from '../src/joystick-chat.js';

test('Joystick chat POST uses the documented endpoint, auth header, and text body', async () => {
  let call: { url: string; init?: RequestInit } | undefined;
  const client = createJoystickChatClient({
    accessToken: 'access-token',
    getStreamState: () => 'live',
    fetchImpl: async (url, init) => {
      call = { url: String(url), init };
      return new Response(JSON.stringify({ data: { id: 'message-1' } }), { status: 201 });
    },
  });

  const response = await client.sendMessage({ text: 'Flip a Coin' });

  assert.equal(call?.url, 'https://api.joystick.tv/api/v1/chat/messages');
  assert.equal(call?.init?.method, 'POST');
  assert.deepEqual(Object.fromEntries(new Headers(call?.init?.headers).entries()), {
    authorization: 'Bearer access-token',
    'content-type': 'application/json',
  });
  assert.equal(call?.init?.body, JSON.stringify({ text: 'Flip a Coin' }));
  assert.deepEqual(response, { data: { id: 'message-1' } });
});

test('Joystick chat rejects invalid text and does not invent a channel field', async () => {
  const client = createJoystickChatClient({ accessToken: 'access-token', getStreamState: () => 'live', fetchImpl: async () => new Response('{}') });
  await assert.rejects(client.sendMessage({ text: '   ' }), /text is required/);
  await assert.rejects(client.sendMessage({ text: 42 as unknown as string }), /text must be a string/);
});

test('Joystick chat reports non-2xx responses without exposing the token', async () => {
  const client = createJoystickChatClient({
    accessToken: 'secret-token',
    getStreamState: () => 'live',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'denied' }), { status: 403, statusText: 'Forbidden' }),
  });
  await assert.rejects(client.sendMessage({ text: 'hello' }), (error: unknown) =>
    error instanceof Error && /403/.test(error.message) && /denied/.test(error.message) && !error.message.includes('secret-token'));
});

test('authenticated sender uses the session token and safely skips without a session', async () => {
  const sent: string[] = [];
  const diagnostics: string[] = [];
  const sender = createAuthenticatedJoystickChatSender({
    getAccessToken: () => undefined,
    getStreamState: () => 'live',
    createClient: (accessToken) => ({ sendMessage: async ({ text }) => { sent.push(`${accessToken}:${text}`); return {}; } }),
    log: (message) => diagnostics.push(message),
  });

  await sender({ message: 'Flip a Coin' });
  assert.deepEqual(sent, []);
  assert.deepEqual(diagnostics, ['Joystick chat send skipped: authenticated session unavailable']);
});

test('stream-gate diagnostics do not falsely identify a reminder as Flip a Coin', async () => {
  const diagnostics: string[] = [];
  const sender = createAuthenticatedJoystickChatSender({
    getAccessToken: () => 'session-token',
    getStreamState: () => 'offline',
    log: (message) => diagnostics.push(message),
  });

  await sender({ message: 'My custom reminder' });

  assert.deepEqual(diagnostics, ['Joystick chat send skipped: stream is not live']);
  assert.doesNotMatch(diagnostics[0]!, /Flip a Coin/);
});

test('authenticated public sends publish to chat history only after successful delivery', async () => {
  const sent: Array<{ text: string; response: unknown }> = [];
  const sender = createAuthenticatedJoystickChatSender({
    getAccessToken: () => 'session-token',
    getStreamState: () => 'live',
    createClient: () => ({ sendMessage: async () => ({ id: 'server-message' }) }),
    onMessageSent: (text, response) => sent.push({ text, response }),
  });
  await sender({ message: 'Scheduled from Prismata' });
  assert.deepEqual(sent, [{ text: 'Scheduled from Prismata', response: { id: 'server-message' } }]);

  const failed = createAuthenticatedJoystickChatSender({
    getAccessToken: () => 'session-token',
    getStreamState: () => 'live',
    createClient: () => ({ sendMessage: async () => { throw new Error('delivery failed'); } }),
    onMessageSent: (text, response) => sent.push({ text, response }),
  });
  await failed({ message: 'Not delivered' });
  assert.equal(sent.length, 1, 'failed delivery is never added to history');
});

test('manual reminder sender reports unavailable authentication to its caller', async () => {
  const sender = createAuthenticatedJoystickChatSender({
    getAccessToken: () => undefined,
    getStreamState: () => 'live',
    throwIfUnavailable: true,
  });
  await assert.rejects(sender({ message: 'Test reminder' }), /authenticated Joystick session unavailable/i);
});
