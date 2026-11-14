import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalStore } from '../src/local-store.js';

type TodoRecord = {
  id: string;
  itemName: string;
  viewer?: string;
  note?: string;
  tokenAmount?: number;
  occurredAt?: string;
  createdAt: string;
  completedAt?: string;
};

type TodoStore = {
  addTodo(input: { itemName: unknown; viewer?: unknown; note?: unknown }): Promise<TodoRecord>;
  updateTodo(id: string, input: { itemName: unknown; viewer?: unknown; note?: unknown }): Promise<boolean>;
  listTodos(): Promise<TodoRecord[]>;
  completeTodo(id: string): Promise<unknown>;
  undoCompleteTodo(id: string): Promise<boolean>;
  removeTodo(id: string): Promise<boolean>;
  claimJoystickTodoEventId(eventId: string): Promise<boolean>;
  createJoystickTodoFromEvent?: (input: {
    eventId: string;
    itemName: string;
    viewer?: string;
    note?: string;
    tokenAmount: number;
    occurredAt: string;
    rawEnvelope?: unknown;
  }) => Promise<TodoRecord | null>;
  close(): void;
};

type TodoStoreFactory = (file: string, options?: { now?: () => number }) => Promise<TodoStore>;
const createTodoStore = createLocalStore as unknown as TodoStoreFactory;
const COMPLETED_TODO_RETENTION_MS = 30_000;

function assertTodoStore(store: TodoStore): void {
  for (const method of ['addTodo', 'updateTodo', 'listTodos', 'completeTodo', 'undoCompleteTodo', 'removeTodo', 'claimJoystickTodoEventId'] as const) {
    assert.equal(typeof store[method], 'function', `local store must expose ${method} for TODO persistence`);
  }
}

async function withTodoStore(run: (context: {
  file: string;
  open(now: () => number): Promise<TodoStore>;
  close(store: TodoStore): void;
}) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-todo-store-'));
  const file = path.join(directory, 'state.sqlite');
  const openStores = new Set<TodoStore>();
  const context = {
    file,
    async open(now: () => number) {
      const store = await createTodoStore(file, { now });
      openStores.add(store);
      assertTodoStore(store);
      return store;
    },
    close(store: TodoStore) {
      store.close();
      openStores.delete(store);
    },
  };

  try {
    await run(context);
  } finally {
    for (const store of openStores) store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('manual TODOs require a nonblank bounded item name and keep viewer/note optional', async () => {
  await withTodoStore(async ({ open, close }) => {
    const store = await open(() => Date.parse('2026-11-02T12:00:00.000Z'));

    await assert.rejects(store.addTodo({ itemName: ' \n\t ' }), /item name|required/i);
    await assert.rejects(store.addTodo({ itemName: 'x'.repeat(100_000) }));
    await assert.rejects(store.addTodo({ itemName: 'Valid', viewer: 'v'.repeat(101) }));
    await assert.rejects(store.addTodo({ itemName: 'Valid', note: 'n'.repeat(2_001) }));
    await assert.rejects(store.addTodo({ itemName: 'Valid', viewer: 42 }));
    await assert.rejects(store.addTodo({ itemName: 'Valid', note: null }));

    const withDetails = await store.addTodo({ itemName: 'Custom reward', viewer: 'Ada', note: 'Blue one, please' });
    assert.deepEqual(
      { itemName: withDetails.itemName, viewer: withDetails.viewer, note: withDetails.note },
      { itemName: 'Custom reward', viewer: 'Ada', note: 'Blue one, please' },
    );

    const withoutOptionalDetails = await store.addTodo({ itemName: 'Another reward' });
    assert.equal(withoutOptionalDetails.itemName, 'Another reward');
    assert.equal(withoutOptionalDetails.viewer, undefined);
    assert.equal(withoutOptionalDetails.note, undefined);
    close(store);
  });
});

test('editing updates only open Manual TODO details and preserves their identity and creation time', async () => {
  await withTodoStore(async ({ open, close }) => {
    let now = Date.parse('2026-11-04T18:30:00.000Z');
    const store = await open(() => now);
    const manual = await store.addTodo({ itemName: 'Original name', viewer: 'Ada', note: 'Original note' });
    now += 5_000;
    assert.equal(await store.updateTodo(manual.id, { itemName: 'Updated name', viewer: 'Bea' }), true);
    const updated = (await store.listTodos()).find(({ id }) => id === manual.id);
    assert.deepEqual(updated, {
      id: manual.id,
      itemName: 'Updated name',
      viewer: 'Bea',
      createdAt: manual.createdAt,
      source: 'Manual',
    });
    assert.equal(await store.updateTodo('missing-todo', { itemName: 'No such task' }), false);

    const automatic = await store.createJoystickTodoFromEvent?.({
      eventId: 'edit-guard-event', itemName: 'Automatic task', source: 'Tips',
    });
    assert.ok(automatic);
    assert.equal(await store.updateTodo(automatic!.id, { itemName: 'Forged manual task' }), false,
      'automatically sourced TODOs cannot be edited');
    assert.equal(await store.completeTodo(manual.id), true);
    assert.equal(await store.updateTodo(manual.id, { itemName: 'Edit completed task' }), false,
      'completed TODOs cannot be edited');
    assert.equal(await store.undoCompleteTodo(manual.id), true, 'a completed task can be restored during its timer window');
    assert.equal((await store.listTodos()).find(({ id }) => id === manual.id)?.completedAt, undefined,
      'undo clears completion while preserving the TODO');
    assert.equal(await store.completeTodo(manual.id), true);
    now += 30_000;
    assert.equal(await store.undoCompleteTodo(manual.id), false, 'undo is rejected once the retention timer expires');
    const dismissible = await store.addTodo({ itemName: 'Dismiss this pending task' });
    assert.equal(await store.removeTodo(dismissible.id), false, 'an open TODO cannot be removed with the countdown action');
    assert.equal(await store.completeTodo(dismissible.id), true);
    assert.equal(await store.removeTodo(dismissible.id), true, 'a completed TODO can be removed during its countdown');
    assert.equal(await store.removeTodo(dismissible.id), false, 'a removed TODO cannot be removed twice');
    assert.equal((await store.listTodos()).some(({ id }) => id === dismissible.id), false);
    assert.equal(await store.removeTodo(automatic!.id), false, 'an open automatic TODO cannot be removed');
    assert.equal(await store.completeTodo(automatic!.id), true);
    assert.equal(await store.removeTodo(automatic!.id), true, 'a completed automatic TODO can be removed during its countdown');
    const expired = await store.addTodo({ itemName: 'Countdown already expired' });
    assert.equal(await store.completeTodo(expired.id), true);
    now += 30_000;
    assert.equal(await store.removeTodo(expired.id), false, 'expired completed TODOs cannot be removed through the countdown action');
    await assert.rejects(store.updateTodo(manual.id, { itemName: ' ' }), /item name|required/i);
    await assert.rejects(store.updateTodo(manual.id, { itemName: 'Valid', viewer: 42 }), /viewer.*text/i);
    close(store);
  });
});

test('redemption TODO row creation is atomic with durable event-ID dedupe and stores only mapped metadata', async () => {
  await withTodoStore(async ({ file, open, close }) => {
    let now = Date.parse('2026-11-04T18:30:00.000Z');
    const store = await open(() => now);
    assert.equal(typeof store.createJoystickTodoFromEvent, 'function',
      'local store exposes an atomic event-ID claim and TODO creation operation');
    if (!store.createJoystickTodoFromEvent) return;

    const input = {
      eventId: 'durable-redemption-event',
      itemName: 'Hydration break',
      viewer: 'Cy',
      tokenAmount: 40,
      occurredAt: '2026-11-04T18:27:36.000Z',
      rawEnvelope: { data: { privateMarker: 'raw-envelope-must-not-be-persisted' } },
    };

    const inspection = new Database(file);
    try {
      inspection.exec(`CREATE TRIGGER fail_todo_insert BEFORE INSERT ON todos
        BEGIN SELECT RAISE(ABORT, 'forced TODO insert failure'); END;`);
      await assert.rejects(store.createJoystickTodoFromEvent!(input), /forced TODO insert failure/);
      inspection.exec('DROP TRIGGER fail_todo_insert');
    } finally {
      inspection.close();
    }

    const added = await store.createJoystickTodoFromEvent(input);
    assert.ok(added, 'a failed TODO insert rolls back its event-ID claim so delivery can be retried');
    assert.deepEqual({
      itemName: added?.itemName,
      viewer: added?.viewer,
      tokenAmount: added?.tokenAmount,
      occurredAt: added?.occurredAt,
    }, {
      itemName: 'Hydration break',
      viewer: 'Cy',
      tokenAmount: 40,
      occurredAt: '2026-11-04T18:27:36.000Z',
    });
    assert.equal(await store.createJoystickTodoFromEvent(input), null, 'duplicate delivery does not create a second TODO');

    close(store);
    const reopened = await open(() => now);
    assert.deepEqual(await reopened.listTodos(), [added], 'allowlisted time and amount metadata survive reopening');
    assert.equal(await reopened.createJoystickTodoFromEvent!(input), null, 'event-ID dedupe survives restart');

    const db = new Database(file, { readonly: true });
    try {
      const todoColumns = db.pragma('table_info(todos)') as Array<{ name: string }>;
      assert.ok(todoColumns.some(({ name }) => name === 'token_amount'), 'TODO schema persists the mapped token amount');
      assert.ok(todoColumns.some(({ name }) => name === 'occurred_at'), 'TODO schema persists the verified event timestamp');
      assert.ok(!todoColumns.some(({ name }) => /raw|payload|envelope/i.test(name)), 'TODO schema has no raw-envelope column');
      const dedupeRow = db.prepare('SELECT event_id AS eventId FROM joystick_todo_event_ids WHERE event_id = ?').get(input.eventId);
      assert.deepEqual(dedupeRow, { eventId: input.eventId }, 'event ID is retained only as bounded dedupe metadata');
      const rows = db.prepare('SELECT * FROM todos').all();
      assert.doesNotMatch(JSON.stringify(rows), /raw-envelope-must-not-be-persisted/);
    } finally {
      db.close();
    }

    await reopened.completeTodo(added!.id);
    now += COMPLETED_TODO_RETENTION_MS;
    assert.deepEqual(await reopened.listTodos(), [], 'the visible TODO can expire independently of its dedupe claim');
    assert.equal(await reopened.createJoystickTodoFromEvent!(input), null,
      'the expired visible row is not recreated while its durable event-ID claim is retained');
    close(reopened);
  });
});

test('open TODOs survive closing and reopening the SQLite local store', async () => {
  await withTodoStore(async ({ open, close }) => {
    const now = Date.parse('2026-11-02T12:00:00.000Z');
    const first = await open(() => now);
    const added = await first.addTodo({ itemName: 'Send the reward', viewer: 'Ada', note: 'After the stream' });
    close(first);

    const reopened = await open(() => now + 60_000);
    assert.deepEqual(await reopened.listTodos(), [added]);
    close(reopened);
  });
});

test('completion persists completedAt, cannot be changed again, and is visible for exactly 30 seconds', async () => {
  await withTodoStore(async ({ open, close }) => {
    let now = Date.parse('2026-11-02T12:00:00.000Z');
    const store = await open(() => now);
    const added = await store.addTodo({ itemName: 'Fulfill the request' });

    await store.completeTodo(added.id);
    const completedAt = new Date(now).toISOString();
    assert.equal((await store.listTodos()).find((todo) => todo.id === added.id)?.completedAt, completedAt);

    now += 5_000;
    await store.completeTodo(added.id).catch(() => undefined);
    assert.equal((await store.listTodos()).find((todo) => todo.id === added.id)?.completedAt, completedAt,
      'a completed task cannot be completed again or have its deadline reset');

    now = Date.parse(completedAt) + COMPLETED_TODO_RETENTION_MS - 1;
    assert.ok((await store.listTodos()).some((todo) => todo.id === added.id), 'the row remains visible just before its deadline');
    now += 1;
    assert.equal((await store.listTodos()).some((todo) => todo.id === added.id), false, 'the row is omitted at completedAt + 30 seconds');
    close(store);
  });
});

test('reopening does not restart completion expiry and startup prunes an expired row', async () => {
  await withTodoStore(async ({ open, close }) => {
    const completedAtMs = Date.parse('2026-11-02T12:00:00.000Z');
    let now = completedAtMs;
    const first = await open(() => now);
    const added = await first.addTodo({ itemName: 'Finish the request' });
    await first.completeTodo(added.id);
    close(first);

    now = completedAtMs + 20_000;
    const beforeExpiry = await open(() => now);
    const pending = (await beforeExpiry.listTodos()).find((todo) => todo.id === added.id);
    assert.equal(pending?.completedAt, new Date(completedAtMs).toISOString());
    close(beforeExpiry);

    now = completedAtMs + COMPLETED_TODO_RETENTION_MS;
    const afterExpiry = await open(() => now);
    assert.equal((await afterExpiry.listTodos()).some((todo) => todo.id === added.id), false,
      'an expired completion is absent immediately after reopening');
    close(afterExpiry);

    now = completedAtMs + 25_000;
    const movedBackWithinOriginalWindow = await open(() => now);
    assert.equal((await movedBackWithinOriginalWindow.listTodos()).some((todo) => todo.id === added.id), false,
      'startup pruning removes the expired row rather than granting it a fresh 30-second window');
    close(movedBackWithinOriginalWindow);
  });
});

test('Joystick event IDs are claimed once and remain deduplicated after their visible task expires', async () => {
  await withTodoStore(async ({ open, close }) => {
    const start = Date.parse('2026-11-02T12:00:00.000Z');
    let now = start;
    const first = await open(() => now);
    const eventId = 'joystick-event-id-only';
    assert.equal(await first.claimJoystickTodoEventId(eventId), true);
    assert.equal(await first.claimJoystickTodoEventId(eventId), false);

    const visibleTask = await first.addTodo({ itemName: 'Visible task for expiry' });
    await first.completeTodo(visibleTask.id);
    close(first);

    now = start + COMPLETED_TODO_RETENTION_MS;
    const reopened = await open(() => now);
    assert.equal((await reopened.listTodos()).some((todo) => todo.id === visibleTask.id), false);
    assert.equal(await reopened.claimJoystickTodoEventId(eventId), false,
      'visible-task expiry must not clear the separately retained event-ID claim');
    close(reopened);

    now = start + 100 * 365 * 24 * 60 * 60 * 1_000;
    const afterBoundedRetention = await open(() => now);
    assert.equal(await afterBoundedRetention.claimJoystickTodoEventId(eventId), true,
      'event-ID deduplication metadata must eventually be pruned rather than retained forever');
    close(afterBoundedRetention);
  });
});
