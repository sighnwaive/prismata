import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as desktopServiceBoundary from '../src/desktop-service.js';

type TipHistoryInput = {
  eventId: string;
  title: string;
  viewer?: string;
  amount?: number;
  occurredAt?: string;
  source?: 'Tips';
};

const parseJoystickTipHistoryEvent = (desktopServiceBoundary as unknown as {
  parseJoystickTipHistoryEvent?: (event: unknown) => TipHistoryInput | null;
}).parseJoystickTipHistoryEvent;

test('tip history parser archives only real tips and returns normalized allowlisted fields', () => {
  assert.equal(typeof parseJoystickTipHistoryEvent, 'function',
    'desktop service exposes a parser dedicated to normalized tip-history entries');
  if (!parseJoystickTipHistoryEvent) return;

  const event = {
    v: 2,
    type: 'tipped',
    id: 'tip-history-1',
    occurred_at: '2026-11-04T18:27:36.000-05:00',
    text: 'envelope text must not become the title',
    data: {
      who: '  Ada\n Lovelace  ',
      is_test: false,
      how_much: 18,
      tip_menu_item: { title: '  Blue\u0000 heart  ' },
      private_note: 'must not be retained',
      arbitrary_nested_data: { secret: 'must not be retained' },
    },
  };

  const parsed = parseJoystickTipHistoryEvent(event);
  assert.deepEqual(parsed, {
    eventId: 'tip-history-1',
    title: 'Blue heart',
    viewer: 'Ada Lovelace',
    amount: 18,
    occurredAt: '2026-11-04T23:27:36.000Z',
    source: 'Tips',
  });
  assert.deepEqual(Object.keys(parsed!).sort(), ['amount', 'eventId', 'occurredAt', 'source', 'title', 'viewer'],
    'the parser does not return an event envelope or unrelated data fields');
  assert.doesNotMatch(JSON.stringify(parsed), /envelope text|must not be retained|arbitrary_nested_data/);

  assert.deepEqual(parseJoystickTipHistoryEvent({
    v: 2,
    type: 'tipped',
    id: 'tip-history-generic',
    occurred_at: '2026-11-04T18:27:36.000Z',
    data: { who: 'Cy', is_test: false, how_much: 3, tip_menu_item: null },
  }), {
    eventId: 'tip-history-generic',
    title: 'Token tip',
    viewer: 'Cy',
    amount: 3,
    occurredAt: '2026-11-04T18:27:36.000Z',
    source: 'Tips',
  }, 'tips without a menu item still have a safe non-empty title');

  for (const ignored of [
    { v: 2, type: 'tipped', id: 'test-tip', data: { is_test: true } },
    { v: 2, type: 'tipped', id: 'unspecified-test-flag', data: {} },
    { v: 2, type: 'tipped', id: 'null-test-flag', data: { is_test: null } },
    { v: 2, type: 'tip_goal_increased', id: 'not-a-tip', data: { is_test: false } },
    { v: 1, type: 'tipped', id: 'wrong-version', data: { is_test: false } },
    { v: 2, type: 'tipped', id: 'missing-id', data: { is_test: false } },
    { v: 2, type: 'tipped', id: 'invalid-data', data: null },
  ]) {
    assert.equal(parseJoystickTipHistoryEvent(ignored), null,
      `only v2 tipped envelopes with data.is_test === false are archived: ${JSON.stringify(ignored)}`);
  }
});

test('Electron records history only from the live gateway event hook, without importing diagnostic logs', async () => {
  const source = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const hookStart = source.indexOf('todoEventHandler: async (event) =>');
  const hookEnd = source.indexOf('\n    createGateway:', hookStart);
  assert.ok(hookStart >= 0 && hookEnd > hookStart, 'main wires an event handler into the shared live gateway runtime');
  const hook = source.slice(hookStart, hookEnd);

  assert.match(hook, /const\s+\w+\s*=\s*parseJoystickTipHistoryEvent\s*\(\s*event\s*\)/,
    'the gateway-delivered envelope is parsed when received');
  assert.match(hook, /activeLifecycle\.addTipHistoryFromJoystickEvent\s*\(\s*\w+\s*\)/,
    'a valid parsed tip is persisted through the lifecycle');
  assert.doesNotMatch(hook, /joystickEventLogger|readFile|readdir|replay|backfill/i,
    'history is not seeded from diagnostic event logs');
});
