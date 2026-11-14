import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalStore } from '../src/local-store.js';
import { createJoystickWhisperAutomation } from '../src/joystick-whispers.js';

type WhisperRule = 'followed' | 'subscribed' | 'resubscribed' | 'giftSender';
type WhisperAttempt = { eventId: string; rule: WhisperRule; recipient: string; attemptedAt: string };
type DurableAttemptStore = {
  claimWhisperAttempt(attempt: WhisperAttempt): Promise<boolean>;
  pruneWhisperAttempts(now: number): Promise<number>;
};

const rules = {
  followed: { enabled: true, message: 'Thanks for following' },
  subscribed: { enabled: true, message: 'Thanks for subscribing' },
  resubscribed: { enabled: true, message: 'Thanks for resubscribing' },
  giftSender: { enabled: true, message: 'Thanks for the gifts' },
};

function event(id: string) {
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

test('durable attempt keys include event ID, rule, and recipient and survive store reopen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-whisper-attempts-'));
  const file = path.join(directory, 'state.sqlite');
  const now = Date.parse('2026-10-25T12:00:00Z');
  const attempt: WhisperAttempt = {
    eventId: 'event-1', rule: 'subscribed', recipient: 'SameRecipient', attemptedAt: new Date(now).toISOString(),
  };
  const first = await createLocalStore(file) as Awaited<ReturnType<typeof createLocalStore>> & DurableAttemptStore;

  assert.equal(await first.claimWhisperAttempt(attempt), true);
  assert.equal(await first.claimWhisperAttempt(attempt), false);
  assert.equal(await first.claimWhisperAttempt({ ...attempt, rule: 'giftSender' }), true);
  assert.equal(await first.claimWhisperAttempt({ ...attempt, recipient: 'AnotherRecipient' }), true);
  assert.equal(await first.claimWhisperAttempt({ ...attempt, eventId: 'event-2' }), true);
  first.close();

  const reopened = await createLocalStore(file) as Awaited<ReturnType<typeof createLocalStore>> & DurableAttemptStore;
  assert.equal(await reopened.claimWhisperAttempt(attempt), false);
  reopened.close();
});

test('automatic whisper attempts remain suppressed after restart and expire after 30 days', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-whisper-restart-'));
  const file = path.join(directory, 'state.sqlite');
  const now = Date.parse('2026-10-25T12:00:00Z');
  const sent: Array<{ username: string; text: string }> = [];
  const makeAutomation = (store: DurableAttemptStore) => createJoystickWhisperAutomation({
    rules,
    getStreamState: () => 'live',
    sendWhisper: async (whisper: { username: string; text: string }) => { sent.push(whisper); },
    attemptStore: store,
    now: () => now,
  } as Parameters<typeof createJoystickWhisperAutomation>[0] & { attemptStore: DurableAttemptStore; now: () => number });

  const firstStore = await createLocalStore(file) as Awaited<ReturnType<typeof createLocalStore>> & DurableAttemptStore;
  await makeAutomation(firstStore).handleEvent(event('restart-duplicate'), { subscriptionConfirmed: true });
  firstStore.close();

  const reopenedStore = await createLocalStore(file) as Awaited<ReturnType<typeof createLocalStore>> & DurableAttemptStore;
  await makeAutomation(reopenedStore).handleEvent(event('restart-duplicate'), { subscriptionConfirmed: true });
  assert.equal(sent.length, 1, 'reopening the store must not permit an automatic duplicate');

  const staleAttempt: WhisperAttempt = {
    eventId: 'expires-after-retention',
    rule: 'followed',
    recipient: 'Follower',
    attemptedAt: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString(),
  };
  assert.equal(await reopenedStore.claimWhisperAttempt(staleAttempt), true);
  assert.ok(await reopenedStore.pruneWhisperAttempts(now) >= 1);
  assert.equal(await reopenedStore.claimWhisperAttempt({ ...staleAttempt, attemptedAt: new Date(now).toISOString() }), true);
  reopenedStore.close();
});
