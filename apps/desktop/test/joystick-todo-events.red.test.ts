import assert from 'node:assert/strict';
import test from 'node:test';
import * as desktopServiceBoundary from '../src/desktop-service.js';

type ParsedJoystickTodo = {
  eventId: string;
  itemName: string;
  viewer?: string;
  note?: string;
  tokenAmount?: number;
  occurredAt?: string;
  source?: 'Tips' | 'Wheel spin' | 'Goal completion' | 'Drop In';
};

const parseJoystickTodoEvent = (desktopServiceBoundary as unknown as {
  parseJoystickTodoEvent?: (event: unknown) => ParsedJoystickTodo | null;
}).parseJoystickTodoEvent;

const occurredAt = '2026-11-04T18:27:36.000Z';

test('stream drop-in events create the Drop In Control Link TODO for the dropping viewer', () => {
  assert.equal(typeof parseJoystickTodoEvent, 'function', 'desktop service exposes the verified redemption event parser');
  if (!parseJoystickTodoEvent) return;

  const droppedIn = parseJoystickTodoEvent({
    v: 2,
    type: 'stream_dropped_in',
    id: 'stream-drop-in-1',
    data: { who: 'KimikoBobtail' },
  });

  assert.ok(droppedIn, 'a stream drop-in creates an automatic TODO');
  assert.equal(droppedIn.itemName, 'Drop In Control Link');
  assert.equal(droppedIn.source, 'Drop In');
  assert.equal(droppedIn.viewer, 'KimikoBobtail');
});

test('milestone completion without the verified topic is ignored', () => {
  assert.equal(typeof parseJoystickTodoEvent, 'function', 'desktop service exposes the verified redemption event parser');
  if (!parseJoystickTodoEvent) return;

  assert.equal(parseJoystickTodoEvent({
    v: 2,
    type: 'milestone_completed',
    id: 'milestone-missing-topic',
    occurred_at: occurredAt,
    data: { who: 'Bea', title: 'Monthly milestone', amount: 125 },
  }), null);
});

test('milestone completion with a different topic is ignored', () => {
  assert.equal(typeof parseJoystickTodoEvent, 'function', 'desktop service exposes the verified redemption event parser');
  if (!parseJoystickTodoEvent) return;

  assert.equal(parseJoystickTodoEvent({
    v: 2,
    type: 'milestone_completed',
    topic: 'channel.milestone.progress',
    id: 'milestone-wrong-topic',
    occurred_at: occurredAt,
    data: { who: 'Bea', title: 'Monthly milestone', amount: 125 },
  }), null);
});

test('tip events require channel.tip and a menu item before creating TODOs', () => {
  assert.equal(typeof parseJoystickTodoEvent, 'function', 'desktop service exposes the verified redemption event parser');
  if (!parseJoystickTodoEvent) return;

  const base = {
    v: 2,
    type: 'tipped',
    id: 'tip-filtered',
    occurred_at: occurredAt,
    data: { is_test: false, tip_menu_item: { title: 'Blue heart' } },
  };
  assert.equal(parseJoystickTodoEvent(base), null, 'tip events without a topic are ignored');
  assert.equal(parseJoystickTodoEvent({ ...base, topic: 'channel.tip_menu' }), null, 'other topics are ignored');
  assert.equal(parseJoystickTodoEvent({ ...base, topic: 'channel.tip', data: { ...base.data, tip_menu_item: null } }), null,
    'tips without a menu item do not create TODOs');
  assert.equal(parseJoystickTodoEvent({ ...base, topic: 'channel.tip', data: { is_test: false } }), null,
    'tips with no menu-item field do not create TODOs');
});

test('verified Joystick redemption envelopes map only allowlisted TODO fields and reject unrelated or malformed events', () => {
  assert.equal(typeof parseJoystickTodoEvent, 'function', 'desktop service exposes the verified redemption event parser');
  if (!parseJoystickTodoEvent) return;

  const tip = parseJoystickTodoEvent({
    v: 2,
    type: 'tipped',
    topic: 'channel.tip',
    id: 'tip-real-1',
    occurred_at: occurredAt,
    text: 'new_message',
    data: { who: 'Ada', is_test: false, how_much: 18, tip_menu_item: { title: 'Blue heart' } },
  });
  assert.equal(tip?.eventId, 'tip-real-1');
  assert.equal(tip?.itemName, 'Tip menu: Blue heart');
  assert.equal(tip?.viewer, 'Ada');
  assert.equal(tip?.tokenAmount, 18);
  assert.equal(tip?.occurredAt, occurredAt);
  assert.equal(tip?.note, undefined, 'top-level text is not guessed to be a viewer note');

  const milestone = parseJoystickTodoEvent({
    v: 2,
    type: 'milestone_completed',
    topic: 'channel.milestone.complete',
    id: 'milestone-1',
    occurred_at: occurredAt,
    text: 'new_message',
    data: { who: 'Bea', title: 'Monthly milestone', amount: 125 },
  });
  assert.deepEqual(milestone, {
    eventId: 'milestone-1',
    itemName: 'Monthly milestone',
    viewer: 'Bea',
    tokenAmount: 125,
    occurredAt,
    source: 'Goal completion',
  }, 'milestone title, viewer, amount, and timestamp map without treating new_message as a note');

  const wheel = parseJoystickTodoEvent({
    v: 2,
    type: 'wheel_spin_claimed',
    topic: '',
    id: 'wheel-1',
    occurred_at: occurredAt,
    text: 'Prize claimed',
    data: { who: 'Cy', prize: 'Hydration break', how_much: 40, sub_spin: true },
  });
  assert.deepEqual(wheel, {
    eventId: 'wheel-1',
    itemName: 'Hydration break',
    viewer: 'Cy',
    tokenAmount: 40,
    occurredAt,
    source: 'Wheel spin',
  }, 'wheel prize, viewer, observed token amount, and timestamp map without inferring sub_spin');

  for (const [name, event] of [
    ['milestone title absent', { v: 2, type: 'milestone_completed', topic: 'channel.milestone.complete', id: 'milestone-generic', occurred_at: occurredAt, data: { who: 'Bea', amount: 4 } }],
    ['wheel prize absent', { v: 2, type: 'wheel_spin_claimed', id: 'wheel-generic', occurred_at: occurredAt, data: { who: 'Cy', how_much: 5 } }],
  ] as const) {
    const mapped = parseJoystickTodoEvent(event);
    assert.ok(mapped?.itemName.trim(), `${name} still gets a non-empty generic label`);
    assert.notEqual(mapped?.itemName, 'new_message', `${name} must not use envelope text as its label`);
  }

  for (const [name, event] of [
    ['tip optional details absent', { v: 2, type: 'tipped', topic: 'channel.tip', id: 'tip-optional-absent', data: { is_test: false, tip_menu_item: 'Blue heart' } }],
    ['milestone optional details malformed', { v: 2, type: 'milestone_completed', topic: 'channel.milestone.complete', id: 'milestone-optional-malformed', occurred_at: 'not-a-date', data: { who: 42, amount: 'ten' } }],
    ['wheel optional details absent or malformed', { v: 2, type: 'wheel_spin_claimed', id: 'wheel-optional-mixed', occurred_at: null, data: { who: 42, how_much: '40' } }],
  ] as const) {
    const mapped = parseJoystickTodoEvent(event);
    assert.ok(mapped, `${name} still creates a TODO`);
    assert.equal(mapped?.eventId, event.id);
    assert.ok(mapped?.itemName.trim(), `${name} gets a non-empty generic label`);
    assert.notEqual(mapped?.itemName, 'new_message', `${name} must not use envelope text as its label`);
    assert.equal(mapped?.viewer, undefined, `${name} omits absent or malformed viewer metadata`);
    assert.equal(mapped?.tokenAmount, undefined, `${name} omits absent or malformed amount metadata`);
    assert.equal(mapped?.occurredAt, undefined, `${name} omits absent or malformed time metadata`);
  }

  assert.equal(parseJoystickTodoEvent({
    v: 2,
    type: 'tipped',
    topic: 'channel.tip',
    id: 'tip-test-only',
    occurred_at: occurredAt,
    data: { who: 'Ada', is_test: true, how_much: 18, tip_menu_item: { title: 'Test menu item' } },
  }), null, 'test tips are ignored even when they contain a menu item');

  const ignored: unknown[] = [
    { v: 2, type: 'tip_goal_increased', id: 'goal-progress', occurred_at: occurredAt, data: { who: 'Ada', amount: 10 } },
    { v: 2, type: 'new_message', id: 'chat-command', occurred_at: occurredAt, data: { who: 'Ada', message: '!tip please' } },
    { v: 2, type: 'unknown_redemption_like_event', id: 'unknown', occurred_at: occurredAt, data: { who: 'Ada', amount: 10 } },
    { v: 1, type: 'tipped', topic: 'channel.tip', id: 'wrong-version', occurred_at: occurredAt, data: { who: 'Ada', is_test: false, how_much: 10 } },
    { type: 'tipped', topic: 'channel.tip', id: 'missing-version', data: { is_test: false } },
    { v: 2, id: 'missing-type', data: { is_test: false } },
    { v: 2, type: 'tipped', data: { is_test: false } },
    { v: 2, type: 'tipped', topic: 'channel.tip', id: ' ', occurred_at: occurredAt, data: { who: 'Ada', is_test: false, how_much: 10 } },
    { v: 2, type: 'tipped', id: 'bad-envelope-data', occurred_at: occurredAt, data: null },
    { v: 2, type: 'tipped', id: 'missing-envelope-data' },
  ];
  for (const event of ignored) assert.equal(parseJoystickTodoEvent(event), null, `ignored event: ${JSON.stringify(event)}`);
});
