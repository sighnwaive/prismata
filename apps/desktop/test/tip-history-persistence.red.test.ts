import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalStore } from '../src/local-store.js';

type TipHistoryRecord = {
  eventId: string;
  title: string;
  viewer?: string;
  amount?: number;
  occurredAt?: string;
  source?: 'Tips';
};

type TipHistoryStore = {
  schemaVersion: number;
  recordTipHistory(input: TipHistoryRecord): Promise<TipHistoryRecord | null>;
  listTipHistory(): Promise<TipHistoryRecord[]>;
  addTodo(input: { itemName: unknown }): Promise<{ id: string }>;
  completeTodo(id: string): Promise<unknown>;
  listTodos(): Promise<unknown[]>;
  close(): void;
};

const openLocalStore = createLocalStore as unknown as (
  file: string,
  options?: { now?: () => number },
) => Promise<TipHistoryStore>;

test('tip history survives SQLite reopen and TODO expiry without expiration or duplicate event IDs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-tip-history-'));
  const file = path.join(directory, 'state.sqlite');
  const initialTime = Date.parse('2026-11-04T18:30:00.000Z');
  let now = initialTime;
  const stores = new Set<TipHistoryStore>();
  const open = async () => {
    const store = await openLocalStore(file, { now: () => now });
    stores.add(store);
    return store;
  };
  const close = (store: TipHistoryStore) => { store.close(); stores.delete(store); };

  try {
    const first = await open();
    assert.equal(first.schemaVersion, 9, 'the store reports the schema version that includes Tip History and source labels');
    assert.equal(typeof first.recordTipHistory, 'function', 'SQLite store exposes durable tip-history recording');
    assert.equal(typeof first.listTipHistory, 'function', 'SQLite store exposes a distinct tip-history list');
    if (typeof first.recordTipHistory !== 'function' || typeof first.listTipHistory !== 'function') return;

    const entry: TipHistoryRecord = {
      eventId: 'durable-tip-event',
      title: 'Hydration break',
      viewer: 'Ada',
      amount: 18,
      occurredAt: '2026-11-04T18:27:36.000Z',
    };
    const unsafeInput = {
      ...entry,
      rawEnvelope: { data: { privateMarker: 'raw-tip-envelope-must-not-be-persisted' } },
    } as TipHistoryRecord;

    const inserted = await first.recordTipHistory(unsafeInput);
    assert.deepEqual(inserted, entry, 'the store returns only the safe normalized fields');
    assert.equal(await first.recordTipHistory(entry), null, 'duplicate event IDs do not create duplicate history rows');

    const todo = await first.addTodo({ itemName: 'Temporary TODO' });
    await first.completeTodo(todo.id);
    close(first);

    now = initialTime + 60_000;
    const reopened = await open();
    assert.deepEqual(await reopened.listTipHistory(), [entry], 'history survives closing and reopening SQLite');
    assert.deepEqual(await reopened.listTodos(), [], 'completed TODOs still expire independently');
    assert.equal(await reopened.recordTipHistory(entry), null, 'event-ID uniqueness survives a restart');
    close(reopened);

    now += 100 * 365 * 24 * 60 * 60 * 1_000;
    const farFuture = await open();
    assert.deepEqual(await farFuture.listTipHistory(), [entry], 'history does not auto-expire over time');
    assert.equal(await farFuture.recordTipHistory(entry), null, 'history event IDs are not pruned with TODO dedupe metadata');
    close(farFuture);

    const inspection = new Database(file, { readonly: true });
    try {
      assert.equal(inspection.pragma('user_version', { simple: true }), 9,
        'the on-disk SQLite schema is migrated through the source-label version');
      const tableNames = (inspection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map(({ name }) => name);
      const storedRows = tableNames.flatMap((name) => {
        const quotedName = `"${name.replace(/"/g, '""')}"`;
        return inspection.prepare(`SELECT * FROM ${quotedName}`).all();
      });
      assert.doesNotMatch(JSON.stringify(storedRows), /raw-tip-envelope-must-not-be-persisted/,
        'SQLite stores no raw event envelope or untrusted extra fields');
      const schema = tableNames.map((name) => inspection.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all()).flat();
      assert.doesNotMatch(JSON.stringify(schema), /raw|payload|envelope/i,
        'the persistent schema contains no raw-envelope field');
    } finally {
      inspection.close();
    }
  } finally {
    for (const store of stores) store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
