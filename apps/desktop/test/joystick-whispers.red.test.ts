import assert from 'node:assert/strict';
import test from 'node:test';
import { createJoystickWhisperAutomation, createJoystickWhisperClient } from '../src/joystick-whispers.js';

const enabledRules = () => ({
  followed: { enabled: true, message: 'Thanks for following' },
  subscribed: { enabled: true, message: 'Thanks for subscribing' },
  resubscribed: { enabled: true, message: 'Thanks for resubscribing' },
  giftSender: { enabled: true, message: 'Thanks for the gifted subs' },
});

function v2Event(type: string, id: string, who?: string) {
  return {
    v: 2,
    type,
    id,
    channel_id: 'channel-1',
    occurred_at: '2026-10-25T12:00:00Z',
    text: who,
    data: who ? { who } : {},
  };
}

test('Joystick whisper POST uses the documented endpoint, bearer auth, and exact username/text body', async () => {
  let call: { url: string; init?: RequestInit } | undefined;
  const client = createJoystickWhisperClient({
    accessToken: 'access-token',
    getStreamState: () => 'live',
    fetchImpl: async (url, init) => {
      call = { url: String(url), init };
      return new Response(JSON.stringify({ sent: true, username: 'Follower' }), { status: 200 });
    },
  });

  await client.sendWhisper({ username: 'Follower', text: 'Thanks for following' });

  assert.equal(call?.url, 'https://api.joystick.tv/api/v1/chat/whispers');
  assert.equal(call?.init?.method, 'POST');
  assert.deepEqual(Object.fromEntries(new Headers(call?.init?.headers).entries()), {
    authorization: 'Bearer access-token',
    'content-type': 'application/json',
  });
  assert.equal(call?.init?.body, JSON.stringify({ username: 'Follower', text: 'Thanks for following' }));
});

test('Joystick whisper 2xx responses require a confirmed matching recipient and are never automatically retried', async () => {
  const invalidBodies = [
    ['malformed JSON', '{not-json'],
    ['missing confirmation fields', JSON.stringify({ username: 'Follower' })],
    ['explicitly not sent', JSON.stringify({ sent: false, username: 'Follower' })],
    ['a different confirmed username', JSON.stringify({ sent: true, username: 'SomeoneElse' })],
  ] as const;

  for (const [label, body] of invalidBodies) {
    let requests = 0;
    const client = createJoystickWhisperClient({
      accessToken: 'access-token',
      getStreamState: () => 'live',
      fetchImpl: async () => {
        requests += 1;
        return new Response(body, { status: 200 });
      },
    });

    await assert.rejects(
      client.sendWhisper({ username: 'Follower', text: 'Thanks for following' }),
      `a 2xx response with ${label} must not confirm delivery`,
    );
    assert.equal(requests, 1, `a 2xx response with ${label} must not trigger an automatic retry`);
  }
});

test('Joystick whisper transport fails closed while non-live and resumes only after a live state', async () => {
  let streamState: 'live' | 'offline' = 'offline';
  let requests = 0;
  const client = createJoystickWhisperClient({
    accessToken: 'access-token',
    getStreamState: () => streamState,
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ sent: true, username: 'Follower' }), { status: 200 });
    },
  });

  await assert.rejects(
    client.sendWhisper({ username: 'Follower', text: 'Thanks for following' }),
    /only available while your stream is live/,
  );
  assert.equal(requests, 0, 'a blocked whisper must not reach the HTTP transport');

  streamState = 'live';
  await client.sendWhisper({ username: 'Follower', text: 'Thanks for following' });
  assert.equal(requests, 1, 'the HTTP transport resumes when the authoritative state becomes live');
});

test('confirmed v2 followed, subscribed, and resubscribed events use their separate rules', async () => {
  const sent: Array<{ username: string; text: string }> = [];
  const automation = createJoystickWhisperAutomation({
    rules: enabledRules(),
    getStreamState: () => 'live',
    sendWhisper: async (whisper: { username: string; text: string }) => { sent.push(whisper); },
  });

  for (const [type, id, username] of [
    ['followed', 'follow-1', 'Follower'],
    ['subscribed', 'subscribe-1', 'Subscriber'],
    ['resubscribed', 'resubscribe-1', 'ReturningSubscriber'],
  ]) {
    await automation.handleEvent(v2Event(type, id, username), { subscriptionConfirmed: true });
  }

  assert.deepEqual(sent, [
    { username: 'Follower', text: 'Thanks for following' },
    { username: 'Subscriber', text: 'Thanks for subscribing' },
    { username: 'ReturningSubscriber', text: 'Thanks for resubscribing' },
  ]);
});

test('unconfirmed, malformed, unknown, or recipient-less events fail closed', async () => {
  const sent: Array<{ username: string; text: string }> = [];
  const automation = createJoystickWhisperAutomation({
    rules: enabledRules(),
    getStreamState: () => 'live',
    sendWhisper: async (whisper: { username: string; text: string }) => { sent.push(whisper); },
  });

  await automation.handleEvent(v2Event('followed', 'not-confirmed', 'Follower'), { subscriptionConfirmed: false });
  await automation.handleEvent({ ...v2Event('followed', 'wrong-version', 'Follower'), v: 1 }, { subscriptionConfirmed: true });
  await automation.handleEvent(v2Event('unknown_event', 'unknown-1', 'Follower'), { subscriptionConfirmed: true });
  await automation.handleEvent({ ...v2Event('followed', '', 'Follower') }, { subscriptionConfirmed: true });
  await automation.handleEvent(v2Event('followed', 'missing-username'), { subscriptionConfirmed: true });
  await automation.handleEvent(v2Event('gifted_subscriptions', 'gift-without-recipient-data', 'GiftSender'), { subscriptionConfirmed: true });

  assert.deepEqual(sent, [{ username: 'GiftSender', text: 'Thanks for the gifted subs' }]);
});

test('gift recipients remain unverified until a complete list is explicitly supplied; sender routes separately', async () => {
  const sent: Array<{ username: string; text: string }> = [];
  let recipientResolution: { status: 'unverified' } | { status: 'complete'; usernames: string[] } = { status: 'unverified' };
  const automation = createJoystickWhisperAutomation({
    rules: enabledRules(),
    getStreamState: () => 'live',
    sendWhisper: async (whisper: { username: string; text: string }) => { sent.push(whisper); },
    resolveGiftRecipients: () => recipientResolution,
  });

  await automation.handleEvent(v2Event('gifted_subscriptions', 'gift-unverified', 'GiftSender'), { subscriptionConfirmed: true });
  assert.deepEqual(sent, [{ username: 'GiftSender', text: 'Thanks for the gifted subs' }]);

  recipientResolution = { status: 'complete', usernames: ['RecipientOne', 'RecipientTwo'] };
  await automation.handleEvent(v2Event('gifted_subscriptions', 'gift-complete', 'GiftSender'), { subscriptionConfirmed: true });
  assert.deepEqual(sent.slice(1), [
    { username: 'RecipientOne', text: 'Thanks for subscribing' },
    { username: 'RecipientTwo', text: 'Thanks for subscribing' },
    { username: 'GiftSender', text: 'Thanks for the gifted subs' },
  ]);
});

test('duplicate event and recipient attempts are suppressed while distinct gift rules can target the same actor', async () => {
  const sent: Array<{ username: string; text: string }> = [];
  const automation = createJoystickWhisperAutomation({
    rules: enabledRules(),
    getStreamState: () => 'live',
    sendWhisper: async (whisper: { username: string; text: string }) => { sent.push(whisper); },
    resolveGiftRecipients: () => ({ status: 'complete', usernames: ['GiftSender', 'GiftSender'] }),
  });
  const event = v2Event('gifted_subscriptions', 'gift-duplicate', 'GiftSender');

  await automation.handleEvent(event, { subscriptionConfirmed: true });
  await automation.handleEvent(event, { subscriptionConfirmed: true });

  assert.deepEqual(sent, [
    { username: 'GiftSender', text: 'Thanks for subscribing' },
    { username: 'GiftSender', text: 'Thanks for the gifted subs' },
  ]);
});

test('an ambiguous whisper failure is recorded as an attempt and is not automatically retried', async () => {
  let attempts = 0;
  const automation = createJoystickWhisperAutomation({
    rules: enabledRules(),
    getStreamState: () => 'live',
    sendWhisper: async () => {
      attempts += 1;
      throw new Error('network timeout; delivery status unknown');
    },
  });
  const event = v2Event('followed', 'follow-timeout', 'Follower');

  await assert.rejects(automation.handleEvent(event, { subscriptionConfirmed: true }), /delivery status unknown/);
  await automation.handleEvent(event, { subscriptionConfirmed: true });

  assert.equal(attempts, 1);
});

test('automation rechecks stream state immediately before sending after a durable claim', async () => {
  let streamState: 'live' | 'offline' = 'live';
  const attempts: string[] = [];
  const sent: Array<{ username: string; text: string }> = [];
  const automation = createJoystickWhisperAutomation({
    rules: enabledRules(),
    getStreamState: () => streamState,
    attemptStore: {
      claimWhisperAttempt: async ({ eventId }) => {
        attempts.push(eventId);
        streamState = 'offline';
        return true;
      },
    },
    sendWhisper: async (whisper: { username: string; text: string }) => { sent.push(whisper); },
  });

  await automation.handleEvent(v2Event('followed', 'live-then-offline', 'Follower'), { subscriptionConfirmed: true });

  assert.deepEqual(attempts, ['live-then-offline'], 'the attempt was validly claimed while the stream was live');
  assert.deepEqual(sent, [], 'a stream that turns non-live before transport must not send');
});
