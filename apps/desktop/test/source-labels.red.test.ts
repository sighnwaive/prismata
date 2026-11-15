import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import * as desktopServiceBoundary from '../src/desktop-service.js';
import { createDesktopLifecycle } from '../src/desktop-lifecycle.js';
import { createLocalStore } from '../src/local-store.js';
import { validateTodoInput } from '../electron/main.js';
import { createTipHistoryPreloadApi, createTodoPreloadApi } from '../electron/preload-api.js';
import { renderShellPage } from '../electron/shell-page.js';

type Source = 'Manual' | 'Tips' | 'Wheel spin' | 'Goal completion' | 'Drop In';
type SourceRecord = { source?: Source };
type TodoRecord = SourceRecord & {
  id: string;
  itemName: string;
  viewer?: string;
  note?: string;
  tokenAmount?: number;
  occurredAt?: string;
  createdAt: string;
  completedAt?: string;
};
type TipHistoryRecord = SourceRecord & {
  eventId: string;
  title: string;
  viewer?: string;
  amount?: number;
  occurredAt?: string;
};
type SourceStore = {
  schemaVersion: number;
  addTodo(input: Record<string, unknown>): Promise<TodoRecord>;
  createJoystickTodoFromEvent(input: Record<string, unknown>): Promise<TodoRecord | null>;
  listTodos(): Promise<TodoRecord[]>;
  recordTipHistory(input: TipHistoryRecord): Promise<TipHistoryRecord | null>;
  listTipHistory(): Promise<TipHistoryRecord[]>;
  close(): void;
};
type SourceLifecycle = {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  addTodo(input: Record<string, unknown>): Promise<TodoRecord>;
  addTodoFromJoystickEvent(input: Record<string, unknown>): Promise<TodoRecord | null>;
  listTodos(): Promise<TodoRecord[]>;
  onTodoListChanged(listener: (snapshot: TodoRecord[]) => void): () => void;
  addTipHistoryFromJoystickEvent(input: TipHistoryRecord): Promise<TipHistoryRecord | null>;
  listTipHistory(): Promise<TipHistoryRecord[]>;
  onTipHistoryChanged(listener: (snapshot: TipHistoryRecord[]) => void): () => void;
};

const parseTodo = (desktopServiceBoundary as unknown as {
  parseJoystickTodoEvent?: (event: unknown) => (Record<string, unknown> & { eventId: string }) | null;
}).parseJoystickTodoEvent;
const parseTip = (desktopServiceBoundary as unknown as {
  parseJoystickTipHistoryEvent?: (event: unknown) => (Record<string, unknown> & { eventId: string }) | null;
}).parseJoystickTipHistoryEvent;
const openStore = createLocalStore as unknown as (file: string, options?: { now?: () => number }) => Promise<SourceStore>;
const occurredAt = '2026-11-04T18:27:36.000Z';

function tipEvent(id: string) {
  return {
    v: 2,
    type: 'tipped',
    topic: 'channel.tip',
    id,
    occurred_at: occurredAt,
    data: { is_test: false, who: 'Ada', how_much: 18, tip_menu_item: { title: 'Blue heart' } },
  };
}

test('verified Joystick event parsers map TODO and Tip History sources', () => {
  assert.equal(typeof parseTodo, 'function');
  assert.equal(typeof parseTip, 'function');
  if (!parseTodo || !parseTip) return;

  const tip = parseTodo(tipEvent('source-tip'));
  const wheel = parseTodo({
    v: 2, type: 'wheel_spin_claimed', id: 'source-wheel', occurred_at: occurredAt,
    data: { who: 'Cy', prize: 'Hydration break', how_much: 40 },
  });
  const goal = parseTodo({
    v: 2, type: 'milestone_completed', topic: 'channel.milestone.complete', id: 'source-goal', occurred_at: occurredAt,
    data: { who: 'Bea', title: 'Monthly goal', amount: 125 },
  });
  const dropIn = parseTodo({
    v: 2, type: 'stream_dropped_in', id: 'source-drop-in', data: { who: 'KimikoBobtail' },
  });
  const history = parseTip(tipEvent('source-history-tip'));

  assert.deepEqual({
    tip: tip?.source,
    wheel: wheel?.source,
    goal: goal?.source,
    dropIn: dropIn?.source,
    history: history?.source,
  }, {
    tip: 'Tips',
    wheel: 'Wheel spin',
    goal: 'Goal completion',
    dropIn: 'Drop In',
    history: 'Tips',
  });
  assert.equal(dropIn?.itemName, 'Drop In Control Link');
  assert.equal(dropIn?.viewer, 'KimikoBobtail');
});

test('store persists trusted source labels and manual input cannot spoof its source', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-source-store-'));
  const file = path.join(directory, 'state.sqlite');
  let store: SourceStore | undefined;

  try {
    store = await openStore(file, { now: () => Date.parse(occurredAt) });
    const validated = validateTodoInput({ itemName: 'Manual task', source: 'Tips' });
    assert.deepEqual(validated, { itemName: 'Manual task' }, 'the renderer cannot send a source through the manual-add validator');

    const manual = await store.addTodo({ itemName: 'Manual task', source: 'Tips' });
    const wheel = await store.createJoystickTodoFromEvent({
      eventId: 'stored-wheel', itemName: 'Hydration break', source: 'Wheel spin', occurredAt,
    });
    const dropIn = await store.createJoystickTodoFromEvent({
      eventId: 'stored-drop-in', itemName: 'Drop In Control Link', viewer: 'KimikoBobtail', source: 'Drop In',
    });
    const historyInput: TipHistoryRecord = {
      eventId: 'stored-tip', title: 'Blue heart', source: 'Tips', occurredAt,
    };
    const savedHistory = await store.recordTipHistory(historyInput);

    store.close();
    store = await openStore(file, { now: () => Date.parse(occurredAt) });
    const todos = await store.listTodos();
    assert.deepEqual({
      manual: manual.source,
      event: wheel?.source,
      dropIn: dropIn?.source,
      historyWrite: savedHistory?.source,
      manualAfterReopen: todos.find(({ id }) => id === manual.id)?.source,
      eventAfterReopen: todos.find(({ id }) => id === wheel?.id)?.source,
      dropInAfterReopen: todos.find(({ id }) => id === dropIn?.id)?.source,
      historyAfterReopen: (await store.listTipHistory())[0]?.source,
    }, {
      manual: 'Manual',
      event: 'Wheel spin',
      dropIn: 'Drop In',
      historyWrite: 'Tips',
      manualAfterReopen: 'Manual',
      eventAfterReopen: 'Wheel spin',
      dropInAfterReopen: 'Drop In',
      historyAfterReopen: 'Tips',
    }, 'trusted source labels persist while untrusted manual source input is ignored');
  } finally {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration leaves existing TODO and Tip History sources blank instead of guessing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-source-migration-'));
  const file = path.join(directory, 'state.sqlite');
  let store: SourceStore | undefined;

  try {
    store = await openStore(file, { now: () => Date.parse(occurredAt) });
    store.close();
    store = undefined;

    const legacy = new Database(file);
    try {
      const todoColumns = legacy.pragma('table_info(todos)') as Array<{ name: string }>;
      const historyColumns = legacy.pragma('table_info(tip_history)') as Array<{ name: string }>;
      if (todoColumns.some(({ name }) => name === 'source')) legacy.exec('ALTER TABLE todos DROP COLUMN source');
      if (historyColumns.some(({ name }) => name === 'source')) legacy.exec('ALTER TABLE tip_history DROP COLUMN source');
      legacy.prepare(`INSERT INTO todos
        (id, item_name, viewer, note, token_amount, occurred_at, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`)
        .run('legacy-todo', 'Old task', 'Ada', 'Keep this note', 42, occurredAt, occurredAt);
      legacy.prepare(`INSERT INTO tip_history (event_id, title, viewer, amount, occurred_at)
        VALUES (?, ?, ?, ?, ?)`)
        .run('legacy-tip', 'Old tip', 'Cy', 18, occurredAt);
      legacy.pragma('user_version = 8');
    } finally {
      legacy.close();
    }

    store = await openStore(file, { now: () => Date.parse(occurredAt) });
    const [todo] = await store.listTodos();
    const [history] = await store.listTipHistory();
    assert.equal(store.schemaVersion, 10, 'the source-label and tip placeholder cleanup migrations advance the schema version');
    assert.deepEqual(todo, {
      id: 'legacy-todo', itemName: 'Old task', viewer: 'Ada', note: 'Keep this note',
      tokenAmount: 42, occurredAt, createdAt: occurredAt,
    }, 'legacy TODO fields survive and an unknown source remains absent');
    assert.deepEqual(history, {
      eventId: 'legacy-tip', title: 'Old tip', viewer: 'Cy', amount: 18, occurredAt,
    }, 'legacy Tip History fields survive and an unknown source remains absent');
  } finally {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop lifecycle preserves parser-derived TODO sources and assigns Manual to forged manual input', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-source-todo-lifecycle-'));
  const lifecycle = createDesktopLifecycle({ dataFile: path.join(directory, 'state.sqlite') }) as unknown as SourceLifecycle;
  let unsubscribe = () => {};

  try {
    await lifecycle.start();
    const snapshots: TodoRecord[][] = [];
    unsubscribe = lifecycle.onTodoListChanged((snapshot) => snapshots.push(snapshot));
    const manual = await lifecycle.addTodo({ itemName: 'Manual task', source: 'Goal completion' });

    const parsed = parseTodo?.({
      v: 2, type: 'wheel_spin_claimed', id: 'lifecycle-wheel', occurred_at: occurredAt,
      data: { who: 'Cy', prize: 'Hydration break', how_much: 40 },
    });
    assert.ok(parsed, 'the verified wheel event parses into a TODO');
    const automatic = await lifecycle.addTodoFromJoystickEvent(parsed!);
    const lastSnapshot = snapshots[snapshots.length - 1];
    assert.deepEqual({
      manual: manual.source,
      automatic: automatic?.source,
      snapshot: lastSnapshot?.find(({ id }) => id === automatic?.id)?.source,
    }, {
      manual: 'Manual',
      automatic: 'Wheel spin',
      snapshot: 'Wheel spin',
    }, 'manual input cannot spoof its source and parser-derived source survives lifecycle snapshots');
  } finally {
    unsubscribe();
    await lifecycle.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Tip History source Tips survives lifecycle persistence and published snapshots', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-source-history-lifecycle-'));
  const lifecycle = createDesktopLifecycle({ dataFile: path.join(directory, 'state.sqlite') }) as unknown as SourceLifecycle;
  let unsubscribe = () => {};

  try {
    await lifecycle.start();
    const snapshots: TipHistoryRecord[][] = [];
    unsubscribe = lifecycle.onTipHistoryChanged((snapshot) => snapshots.push(snapshot));
    assert.ok(parseTip);
    const parsed = parseTip!(tipEvent('lifecycle-history-tip'));
    assert.ok(parsed);
    const saved = await lifecycle.addTipHistoryFromJoystickEvent(parsed as TipHistoryRecord);
    assert.deepEqual({
      saved: saved?.source,
      snapshot: snapshots[0]?.[0]?.source,
      persisted: (await lifecycle.listTipHistory())[0]?.source,
    }, {
      saved: 'Tips',
      snapshot: 'Tips',
      persisted: 'Tips',
    });
  } finally {
    unsubscribe();
    await lifecycle.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('typed TODO and Tip History preload APIs pass source fields through list snapshots', async () => {
  const todo: TodoRecord = {
    id: 'ipc-todo', itemName: 'Wheel prize', source: 'Wheel spin', createdAt: occurredAt,
  };
  const history: TipHistoryRecord = {
    eventId: 'ipc-tip', title: 'Blue heart', source: 'Tips', occurredAt,
  };
  let publishTodos!: (snapshot: TodoRecord[]) => void;
  let publishHistory!: (snapshot: TipHistoryRecord[]) => void;
  const todos = createTodoPreloadApi({
    list: async () => [todo],
    add: async () => todo,
    update: async () => {},
    complete: async () => {},
    undoComplete: async () => {},
    remove: async () => {},
    onListChanged(listener) { publishTodos = listener; return () => {}; },
  });
  const tipHistory = createTipHistoryPreloadApi({
    list: async () => [history],
    onListChanged(listener) { publishHistory = listener; return () => {}; },
  });
  const todoSnapshots: TodoRecord[][] = [];
  const historySnapshots: TipHistoryRecord[][] = [];
  todos.onListChanged((snapshot) => todoSnapshots.push(snapshot));
  tipHistory.onListChanged((snapshot) => historySnapshots.push(snapshot));

  assert.equal(((await todos.list()) as unknown as TodoRecord[])[0]?.source, 'Wheel spin');
  assert.equal(((await tipHistory.list()) as unknown as TipHistoryRecord[])[0]?.source, 'Tips');
  publishTodos([todo]);
  publishHistory([history]);
  assert.equal(todoSnapshots[0]?.[0]?.source, 'Wheel spin');
  assert.equal(historySnapshots[0]?.[0]?.source, 'Tips');
});

test('sandboxed preload preserves source fields from list and live-snapshot IPC', async () => {
  const source = await readFile(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
  const todo: TodoRecord = {
    id: 'sandbox-todo', itemName: 'Wheel prize', source: 'Wheel spin', createdAt: occurredAt,
  };
  const history: TipHistoryRecord = {
    eventId: 'sandbox-tip', title: 'Blue heart', source: 'Tips', occurredAt,
  };
  const exposed: Record<string, any> = {};
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
  const ipcRenderer = {
    invoke: async (channel: string) => channel === 'todos:list' ? [todo]
      : channel === 'tip-history:list' ? [history] : undefined,
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) => listeners.set(channel, listener),
    removeListener: (channel: string) => listeners.delete(channel),
  };

  vm.runInNewContext(source, {
    require: (specifier: string) => {
      assert.equal(specifier, 'electron');
      return { contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { exposed[name] = value; } }, ipcRenderer };
    },
  }, { filename: 'preload.mjs' });

  const desktop = exposed.prismataDesktop;
  assert.equal((await desktop.todos.list())[0]?.source, 'Wheel spin');
  assert.equal((await desktop.tipHistory.list())[0]?.source, 'Tips');
  const todoUpdates: TodoRecord[][] = [];
  const historyUpdates: TipHistoryRecord[][] = [];
  desktop.todos.onListChanged((snapshot: TodoRecord[]) => todoUpdates.push(snapshot));
  desktop.tipHistory.onListChanged((snapshot: TipHistoryRecord[]) => historyUpdates.push(snapshot));
  listeners.get('todos:listChanged')?.({}, [todo]);
  listeners.get('tip-history:listChanged')?.({}, [history]);
  assert.equal(todoUpdates[0]?.[0]?.source, 'Wheel spin');
  assert.equal(historyUpdates[0]?.[0]?.source, 'Tips');
});

test('TODO and Tip History rows render a source label only when a source is present', () => {
  const page = renderShellPage('offline', 'Prismata');
  assert.deepEqual({
    todoLabel: /if\s*\(todo\.source\)\s*\{[^}]*source\.textContent\s*=\s*'Source: '\s*\+\s*todo\.source/.test(page),
    historyLabel: /if\s*\(tip\.source\)\s*\{[^}]*source\.textContent\s*=\s*'Source: '\s*\+\s*tip\.source/.test(page),
  }, {
    todoLabel: true,
    historyLabel: true,
  }, 'each list uses a conditional text-only source label so absent legacy values stay hidden');
});
