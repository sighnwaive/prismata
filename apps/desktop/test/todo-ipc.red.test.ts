import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as mainBoundary from '../electron/main.js';
import * as preloadApiBoundary from '../electron/preload-api.js';

type TodoRecord = {
  id: string;
  itemName: string;
  viewer?: string;
  note?: string;
  createdAt: string;
  completedAt?: string;
  source?: 'Manual' | 'Tips' | 'Wheel spin' | 'Goal completion' | 'Drop In';
};

type ManualTodoInput = { itemName: string; viewer?: string; note?: string };
type TodoPreloadApi = {
  list: () => Promise<TodoRecord[]>;
  add: (input: ManualTodoInput) => Promise<TodoRecord>;
  update: (id: string, input: ManualTodoInput) => Promise<void>;
  complete: (id: string) => Promise<void>;
  undoComplete: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  onListChanged: (listener: (todos: TodoRecord[]) => void) => () => void;
};

const createTodoPreloadApi = (preloadApiBoundary as unknown as {
  createTodoPreloadApi?: (input: TodoPreloadApi) => TodoPreloadApi;
}).createTodoPreloadApi;

test('typed TODO preload API exposes only the task actions and list subscription', async () => {
  assert.equal(typeof createTodoPreloadApi, 'function', 'preload-api must define the typed TODO boundary');

  const task: TodoRecord = {
    id: 'todo-1',
    itemName: 'Send the reward',
    viewer: 'Ada',
    note: 'After the stream',
    createdAt: '2026-11-02T12:00:00.000Z',
  };
  let publish!: (todos: TodoRecord[]) => void;
  let unsubscribed = false;
  const api = createTodoPreloadApi!({
    list: async () => [task],
    add: async (input) => ({ ...task, ...input }),
    update: async () => {},
    complete: async () => {},
    undoComplete: async () => {},
    remove: async () => {},
    onListChanged(listener) {
      publish = listener;
      return () => { unsubscribed = true; };
    },
  });

  assert.deepEqual(Object.keys(api).sort(), ['add', 'complete', 'list', 'onListChanged', 'remove', 'undoComplete', 'update']);
  assert.deepEqual(await api.list(), [task]);
  assert.deepEqual(await api.add({ itemName: 'Send the reward', viewer: 'Ada', note: 'After the stream' }), {
    ...task,
  });
  await api.update(task.id, { itemName: 'Renamed reward', viewer: 'Ada', note: 'Tomorrow' });
  await api.complete(task.id);
  await api.undoComplete(task.id);
  await api.remove(task.id);

  const updates: TodoRecord[][] = [];
  const unsubscribe = api.onListChanged((todos) => updates.push(todos));
  publish([task]);
  unsubscribe();
  publish([]);
  assert.deepEqual(updates, [[task]]);
  assert.equal(unsubscribed, true, 'the subscription returns an unsubscribe function');
  assert.equal('database' in api, false);
  assert.equal('accessToken' in api, false);
  assert.equal('rawEvent' in api, false);
});

test('sandboxed preload exposes only narrow TODO IPC calls and removes its list listener', async () => {
  const source = await readFile(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
  const exposed: Record<string, any> = {};
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
  const invocations: Array<{ channel: string; args: unknown[] }> = [];
  const task: TodoRecord = {
    id: 'todo-2',
    itemName: 'Mail the item',
    createdAt: '2026-11-02T12:00:00.000Z',
  };
  const ipcRenderer = {
    invoke: async (channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args });
      if (channel === 'todos:list') return [task];
      if (channel === 'todos:add') return task;
      return undefined;
    },
    on: (channel: string, handler: (event: unknown, payload: unknown) => void) => listeners.set(channel, handler),
    removeListener: (channel: string, handler: (event: unknown, payload: unknown) => void) => {
      if (listeners.get(channel) === handler) listeners.delete(channel);
    },
  };

  assert.doesNotMatch(source, /^\s*import\s/m, 'the sandboxed preload remains runtime-compatible');
  vm.runInNewContext(source, {
    require: (specifier: string) => {
      assert.equal(specifier, 'electron');
      return { contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { exposed[name] = value; } }, ipcRenderer };
    },
  }, { filename: 'preload.mjs' });

  const todos = exposed.prismataDesktop?.todos as TodoPreloadApi | undefined;
  assert.ok(todos, 'preload must expose a TODO API under prismataDesktop');
  assert.deepEqual(Object.keys(todos!).sort(), ['add', 'complete', 'list', 'onListChanged', 'remove', 'undoComplete', 'update']);
  assert.deepEqual(await todos!.list(), [task]);
  assert.deepEqual(await todos!.add({ itemName: 'Mail the item' }), task);
  await todos!.update(task.id, { itemName: 'Mail the updated item' });
  await todos!.complete(task.id);
  await todos!.undoComplete(task.id);
  await todos!.remove(task.id);

  const updates: TodoRecord[][] = [];
  const unsubscribe = todos!.onListChanged((snapshot) => updates.push(snapshot));
  const handler = listeners.get('todos:listChanged');
  assert.equal(typeof handler, 'function', 'preload subscribes to task-list snapshots');
  handler?.({}, [task]);
  unsubscribe();
  assert.equal(listeners.has('todos:listChanged'), false);
  assert.deepEqual(updates, [[task]]);
  assert.deepEqual(invocations.map(({ channel }) => channel), ['todos:list', 'todos:add', 'todos:update', 'todos:complete', 'todos:undo-complete', 'todos:remove']);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations[1]?.args)), [{ itemName: 'Mail the item' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations[2]?.args)), [task.id, { itemName: 'Mail the updated item' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations[3]?.args)), [task.id]);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations[4]?.args)), [task.id]);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations[5]?.args)), [task.id]);
  assert.equal('database' in todos!, false);
  assert.equal('accessToken' in todos!, false);
  assert.equal('rawEvent' in todos!, false);
});

test('main-process TODO input validation accepts only bounded item, viewer, and note text', () => {
  const validateTodoInput = (mainBoundary as unknown as {
    validateTodoInput?: (input: unknown) => ManualTodoInput;
  }).validateTodoInput;
  assert.equal(typeof validateTodoInput, 'function', 'main must expose its TODO IPC input validator');

  const safe = validateTodoInput!({
    itemName: 'Custom reward',
    viewer: 'Ada',
    note: 'Blue one, please',
    accessToken: 'renderer-token-must-be-discarded',
    rawEvent: { private: 'payload-must-not-cross-ipc' },
  });
  assert.deepEqual(safe, { itemName: 'Custom reward', viewer: 'Ada', note: 'Blue one, please' });
  assert.deepEqual(Object.keys(safe).sort(), ['itemName', 'note', 'viewer']);

  for (const invalid of [
    null,
    [],
    {},
    { itemName: ' \n\t ' },
    { itemName: 'x'.repeat(201) },
    { itemName: 'Valid', viewer: 'v'.repeat(101) },
    { itemName: 'Valid', note: 'n'.repeat(2_001) },
    { itemName: 42 },
    { itemName: 'Valid', viewer: 42 },
    { itemName: 'Valid', note: null },
  ]) {
    assert.throws(() => validateTodoInput!(invalid), `invalid renderer input must be rejected: ${String(invalid)}`);
  }
});

test('completion IPC rejects missing, blank, non-text, and oversized task IDs', async () => {
  const validateTodoId = (mainBoundary as unknown as {
    validateTodoId?: (id: unknown) => string;
  }).validateTodoId;
  assert.equal(typeof validateTodoId, 'function', 'main must expose its TODO task-ID validator');
  assert.equal(validateTodoId!('todo-123'), 'todo-123');
  assert.equal(validateTodoId!('t'.repeat(200)), 't'.repeat(200), 'IDs at the configured bound remain valid');

  for (const invalid of [undefined, null, 42, {}, [], '', ' \n\t ', 't'.repeat(201)]) {
    assert.throws(() => validateTodoId!(invalid), `invalid completion ID must be rejected: ${String(invalid)}`);
  }

  const source = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const completeHandler = source.slice(source.indexOf("handle('todos:complete'"), source.indexOf("handle('auth:getSnapshot'"));
  assert.ok(completeHandler.includes('validateTodoId('), 'completion IPC validates the renderer-supplied task ID before lifecycle use');
  assert.ok(/activeLifecycle\.completeTodo\s*\(\s*validateTodoId\s*\(\s*id\s*\)/.test(completeHandler),
    'missing or invalid IDs cannot be passed through as a successful no-op completion');
});

test('main IPC routes TODO list/add/update/complete/undo/remove and forwards list snapshots to the renderer', async () => {
  const source = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');

  for (const channel of ['todos:list', 'todos:add', 'todos:update', 'todos:complete', 'todos:undo-complete', 'todos:remove']) {
    assert.ok(new RegExp(`handle\\(['"]${channel}['"]`).test(source), `main registers ${channel}`);
  }
  const addHandler = source.slice(source.indexOf('todos:add'), source.indexOf('todos:complete'));
  assert.ok(addHandler.includes('validateTodoInput('), 'the add IPC handler validates renderer input');
  assert.ok(addHandler.includes('activeLifecycle.addTodo('), 'only validated manual input is sent to the local lifecycle');
  assert.ok(/validateTodoInput\s*\(/.test(source), 'renderer-supplied add details are validated in main');
  assert.ok(/activeLifecycle\.listTodos\s*\(/.test(source), 'list requests use the active local lifecycle');
  assert.ok(/activeLifecycle\.addTodo\s*\(/.test(source), 'manual additions use the active local lifecycle');
  assert.ok(/activeLifecycle\.updateTodo\s*\(\s*validateTodoId\(id\)\s*,\s*validateTodoInput\(input\)\s*\)/.test(source), 'manual edits validate the id and fields before updating');
  assert.ok(/activeLifecycle\.completeTodo\s*\(/.test(source), 'completion uses the active local lifecycle');
  assert.ok(/activeLifecycle\.undoCompleteTodo\s*\(\s*validateTodoId\(id\)\s*\)/.test(source), 'undo validates its task ID before use');
  assert.ok(/activeLifecycle\.removeTodo\s*\(\s*validateTodoId\(id\)\s*\)/.test(source), 'remove validates its task ID before use');
  assert.ok(/onTodoListChanged\s*\(/.test(source), 'main subscribes to lifecycle list snapshots');
  assert.ok(/webContents\.send\(['"]todos:listChanged['"]/.test(source), 'main forwards list snapshots to the renderer');
});

test('initial renderer TODO IPC waits for the main lifecycle readiness barrier', async () => {
  const source = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const wireStart = source.indexOf('function wireIpc()');
  const createWindowStart = source.indexOf('async function createWindow()');
  assert.ok(wireStart >= 0 && createWindowStart > wireStart, 'main defines IPC wiring before window startup');
  const wiring = source.slice(wireStart, createWindowStart);

  function extractRegistration(channel: string): string {
    const start = wiring.indexOf(`handle('${channel}'`);
    assert.ok(start >= 0, `main wires ${channel}`);
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let cursor = wiring.indexOf('(', start); cursor < wiring.length; cursor += 1) {
      const character = wiring[cursor]!;
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          let end = cursor + 1;
          while (/\s/.test(wiring[end] ?? '')) end += 1;
          if (wiring[end] === ';') return wiring.slice(start, end + 1);
        }
      }
    }
    assert.fail(`could not extract main's ${channel} registration`);
  }

  let releaseLifecycleReady!: () => void;
  const lifecycleReady = new Promise<void>((resolve) => { releaseLifecycleReady = resolve; });
  const persistedTodo: TodoRecord = {
    id: 'persisted-todo',
    itemName: 'Persisted before startup',
    createdAt: '2026-11-02T12:00:00.000Z',
  };
  let ready = false;
  const calls: string[] = [];
  const activeLifecycle = {
    async listTodos() {
      calls.push('list');
      return ready ? [persistedTodo] : [];
    },
    async addTodo(input: ManualTodoInput) {
      calls.push('add');
      return { ...persistedTodo, id: 'added-todo', ...input };
    },
    async updateTodo(id: string, input: ManualTodoInput) {
      calls.push(`update:${id}:${input.itemName}`);
      return true;
    },
    async completeTodo(id: string) {
      calls.push(`complete:${id}`);
      return true;
    },
    async undoCompleteTodo(id: string) {
      calls.push(`undo:${id}`);
      return true;
    },
    async removeTodo(id: string) {
      calls.push(`remove:${id}`);
      return true;
    },
  };
  const handlers = new Map<string, (...args: any[]) => unknown>();
  for (const channel of ['todos:list', 'todos:add', 'todos:update', 'todos:complete', 'todos:undo-complete', 'todos:remove']) {
    vm.runInNewContext(extractRegistration(channel), {
      handle: (registeredChannel: string, listener: (...args: any[]) => unknown) => handlers.set(registeredChannel, listener),
      activeLifecycle,
      lifecycleReady,
      validateTodoInput: (input: ManualTodoInput) => input,
      validateTodoId: (id: string) => id,
    }, { filename: `main:${channel}` });
  }

  const list = handlers.get('todos:list')!();
  const add = handlers.get('todos:add')!(undefined, { itemName: 'A manual task' });
  const update = handlers.get('todos:update')!(undefined, persistedTodo.id, { itemName: 'Updated manual task' });
  const complete = handlers.get('todos:complete')!(undefined, persistedTodo.id);
  const undo = handlers.get('todos:undo-complete')!(undefined, persistedTodo.id);
  const remove = handlers.get('todos:remove')!(undefined, persistedTodo.id);
  await Promise.resolve();
  assert.deepEqual(calls, [], 'the initial renderer must not touch the unstarted lifecycle through any TODO IPC call');

  ready = true;
  releaseLifecycleReady();
  const [listed, added] = await Promise.all([list, add]) as [TodoRecord[], TodoRecord];
  await update;
  await complete;
  await undo;
  await remove;
  assert.deepEqual(listed, [persistedTodo], 'the post-start list includes persisted rows rather than an early empty snapshot');
  assert.equal(added.itemName, 'A manual task');
  assert.deepEqual(calls, ['list', 'add', `update:${persistedTodo.id}:Updated manual task`, `complete:${persistedTodo.id}`, `undo:${persistedTodo.id}`, `remove:${persistedTodo.id}`]);

  const startupError = new Error('lifecycle startup failed');
  let failLifecycleReady!: (error: Error) => void;
  const failedLifecycleReady = new Promise<void>((_resolve, reject) => { failLifecycleReady = reject; });
  const failedCalls: string[] = [];
  const failedLifecycle = {
    async listTodos() { failedCalls.push('list'); return [persistedTodo]; },
    async addTodo() { failedCalls.push('add'); return persistedTodo; },
    async updateTodo() { failedCalls.push('update'); return true; },
    async completeTodo() { failedCalls.push('complete'); return true; },
    async undoCompleteTodo() { failedCalls.push('undo'); return true; },
    async removeTodo() { failedCalls.push('remove'); return true; },
  };
  const failedHandlers = new Map<string, (...args: any[]) => unknown>();
  for (const channel of ['todos:list', 'todos:add', 'todos:update', 'todos:complete', 'todos:undo-complete', 'todos:remove']) {
    vm.runInNewContext(extractRegistration(channel), {
      handle: (registeredChannel: string, listener: (...args: any[]) => unknown) => failedHandlers.set(registeredChannel, listener),
      activeLifecycle: failedLifecycle,
      lifecycleReady: failedLifecycleReady,
      validateTodoInput: (input: ManualTodoInput) => input,
      validateTodoId: (id: string) => id,
    }, { filename: `failed-main:${channel}` });
  }
  const failedList = failedHandlers.get('todos:list')!();
  const failedAdd = failedHandlers.get('todos:add')!(undefined, { itemName: 'A manual task' });
  const failedUpdate = failedHandlers.get('todos:update')!(undefined, persistedTodo.id, { itemName: 'Updated task' });
  const failedComplete = failedHandlers.get('todos:complete')!(undefined, persistedTodo.id);
  const failedUndo = failedHandlers.get('todos:undo-complete')!(undefined, persistedTodo.id);
  const failedRemove = failedHandlers.get('todos:remove')!(undefined, persistedTodo.id);
  failLifecycleReady(startupError);
  for (const request of [failedList, failedAdd, failedUpdate, failedComplete, failedUndo, failedRemove]) {
    await assert.rejects(request, (error) => error === startupError, 'startup failure must propagate to each IPC caller');
  }
  assert.deepEqual(failedCalls, [], 'a failed startup never falls through to lifecycle service calls');

  const createWindow = source.slice(createWindowStart);
  const firstPageLoad = createWindow.indexOf('await window.loadURL(');
  const wireCall = createWindow.indexOf('wireIpc();');
  const barrierSetup = createWindow.indexOf('lifecycleReady = new Promise(');
  assert.ok(barrierSetup >= 0 && barrierSetup < wireCall,
    'main establishes this window’s lifecycle-ready promise before registering handlers');
  assert.ok(wireCall >= 0 && firstPageLoad > wireCall, 'IPC is wired before the first renderer page is loaded');
  assert.ok(/await\s+lifecycleReady/.test(extractRegistration('todos:list')), 'the list handler awaits lifecycle readiness');
  assert.ok(/await\s+lifecycleReady/.test(extractRegistration('todos:add')), 'the add handler awaits lifecycle readiness');
  assert.ok(/await\s+lifecycleReady/.test(extractRegistration('todos:update')), 'the update handler awaits lifecycle readiness');
  assert.ok(/await\s+lifecycleReady/.test(extractRegistration('todos:complete')), 'the completion handler awaits lifecycle readiness');
  assert.ok(/await\s+lifecycleReady/.test(extractRegistration('todos:undo-complete')), 'the undo handler awaits lifecycle readiness');
  assert.ok(/await\s+lifecycleReady/.test(extractRegistration('todos:remove')), 'the remove handler awaits lifecycle readiness');

  const lifecycleStart = createWindow.indexOf('await activeLifecycle.start()');
  const interactivePageLoad = createWindow.lastIndexOf('await window.loadURL(');
  const deferredRelease = createWindow.indexOf('resolveLifecycleReady(', lifecycleStart);
  const startPromiseBeforePage = /\blifecycleReady\s*=\s*activeLifecycle\.start\s*\(/.test(createWindow.slice(0, firstPageLoad));
  assert.ok(startPromiseBeforePage || (lifecycleStart >= 0 && deferredRelease > lifecycleStart && deferredRelease < interactivePageLoad),
    'the readiness promise only opens after lifecycle.start() succeeds and before the interactive page loads');
});
