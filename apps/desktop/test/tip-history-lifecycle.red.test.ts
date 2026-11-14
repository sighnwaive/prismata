import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDesktopLifecycle } from '../src/desktop-lifecycle.js';
import { createDesktopService } from '../src/desktop-service.js';

type TipHistoryRecord = {
  eventId: string;
  title: string;
  viewer?: string;
  amount?: number;
  occurredAt?: string;
};

type TipHistoryLifecycle = {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  listTipHistory(): Promise<TipHistoryRecord[]>;
  addTipHistoryFromJoystickEvent(input: TipHistoryRecord): Promise<TipHistoryRecord | null>;
  onTipHistoryChanged(listener: (snapshot: TipHistoryRecord[]) => void): () => void;
  listTodos(): Promise<unknown[]>;
};

test('desktop lifecycle records and publishes independent history snapshots, then restores them after restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-tip-history-lifecycle-'));
  const dataFile = path.join(directory, 'state.sqlite');
  const entry: TipHistoryRecord = {
    eventId: 'lifecycle-tip-event',
    title: 'Blue heart',
    viewer: 'Cy',
    amount: 12,
    occurredAt: '2026-11-04T18:27:36.000Z',
  };
  let lifecycle: TipHistoryLifecycle | undefined;
  let unsubscribe = () => {};

  const createLifecycle = () => createDesktopLifecycle({
    dataFile,
    serviceFactory: async (options) => createDesktopService(options),
  }) as unknown as TipHistoryLifecycle;

  try {
    lifecycle = createLifecycle();
    await lifecycle.start();
    assert.equal(typeof lifecycle.listTipHistory, 'function', 'lifecycle exposes the separate history list');
    assert.equal(typeof lifecycle.addTipHistoryFromJoystickEvent, 'function', 'lifecycle routes live parsed tips to storage');
    assert.equal(typeof lifecycle.onTipHistoryChanged, 'function', 'lifecycle publishes independent history snapshots');
    if (!lifecycle.listTipHistory || !lifecycle.addTipHistoryFromJoystickEvent || !lifecycle.onTipHistoryChanged) return;

    assert.deepEqual(await lifecycle.listTipHistory(), [], 'history starts empty; prior diagnostic events are not backfilled');
    const updates: TipHistoryRecord[][] = [];
    unsubscribe = lifecycle.onTipHistoryChanged((snapshot) => updates.push(snapshot));
    assert.deepEqual(await lifecycle.addTipHistoryFromJoystickEvent(entry), entry);
    assert.deepEqual(updates, [[entry]], 'recording publishes a history snapshot');
    assert.deepEqual(await lifecycle.addTipHistoryFromJoystickEvent(entry), null, 'duplicate delivery publishes no duplicate entry');
    assert.equal(updates.length, 1, 'duplicate event delivery does not publish a redundant history row');
    assert.deepEqual(await lifecycle.listTodos(), [], 'recording history does not create or mutate TODOs');

    unsubscribe();
    await lifecycle.stop();
    lifecycle = createLifecycle();
    await lifecycle.start();
    assert.deepEqual(await lifecycle.listTipHistory(), [entry], 'lifecycle restart retains the permanent history record');
    assert.deepEqual(await lifecycle.listTodos(), [], 'TODO lifecycle remains separate after restart');
  } finally {
    unsubscribe();
    await lifecycle?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
