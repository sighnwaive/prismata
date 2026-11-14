import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDesktopService } from '../src/desktop-service.js';
import { createDesktopLifecycle } from '../src/desktop-lifecycle.js';
import { createTransportIdentityStore } from '../src/transport-identity.js';

type TodoRecord = {
  id: string;
  itemName: string;
  viewer?: string;
  note?: string;
  createdAt: string;
  completedAt?: string;
};

type TodoLifecycle = {
  start: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  disableLan: () => Promise<unknown>;
  listTodos: () => Promise<TodoRecord[]>;
  addTodo: (input: { itemName: string; viewer?: string; note?: string }) => Promise<TodoRecord>;
  updateTodo: (id: string, input: { itemName: string; viewer?: string; note?: string }) => Promise<boolean>;
  completeTodo: (id: string) => Promise<boolean>;
  undoCompleteTodo: (id: string) => Promise<boolean>;
  removeTodo: (id: string) => Promise<boolean>;
  onTodoListChanged: (listener: (snapshot: TodoRecord[]) => void) => () => void;
};

async function withFakeTimeouts(run: (clock: {
  scheduledDelays: () => number[];
  async advanceAll(): Promise<void>;
}) => Promise<void>) {
  const timers = new Map<number, { delay: number; callback: () => unknown }>();
  let nextId = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = ((callback: (...args: unknown[]) => unknown, delay = 0, ...args: unknown[]) => {
    const id = ++nextId;
    timers.set(id, { delay: Number(delay), callback: () => callback(...args) });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: unknown) => { timers.delete(Number(id)); }) as typeof clearTimeout;

  try {
    await run({
      scheduledDelays: () => [...timers.values()].map(({ delay }) => delay),
      async advanceAll() {
        const pending = [...timers.entries()];
        timers.clear();
        for (const [, timer] of pending) await timer.callback();
        for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
      },
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

test('desktop lifecycle routes TODOs through the local service and publishes add, complete, and expiry snapshots', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-todo-lifecycle-'));
  const dataFile = path.join(directory, 'state.sqlite');
  const initialTime = Date.parse('2026-11-02T12:00:00.000Z');
  let now = initialTime;
  let lifecycle: TodoLifecycle | undefined;
  let unsubscribe = () => {};

  try {
    await withFakeTimeouts(async (clock) => {
      const createLifecycle = () => createDesktopLifecycle({
        dataFile,
        serviceFactory: async (options) => createDesktopService({ ...options, now: () => now }),
      }) as unknown as TodoLifecycle;

      lifecycle = createLifecycle();
      await lifecycle.start();
      assert.equal(typeof lifecycle.listTodos, 'function', 'lifecycle exposes a TODO list backed by the local service');
      assert.equal(typeof lifecycle.addTodo, 'function', 'lifecycle exposes manual TODO creation');
      assert.equal(typeof lifecycle.updateTodo, 'function', 'lifecycle exposes manual TODO editing');
      assert.equal(typeof lifecycle.completeTodo, 'function', 'lifecycle exposes TODO completion');
      assert.equal(typeof lifecycle.onTodoListChanged, 'function', 'lifecycle publishes task-list snapshots');

      const persisted = await lifecycle.addTodo({ itemName: 'Keep across lifecycle restart', viewer: 'Ada' });
      assert.deepEqual(await lifecycle.listTodos(), [persisted]);
      await lifecycle.stop();

      now = initialTime + 10_000;
      lifecycle = createLifecycle();
      await lifecycle.start();
      assert.deepEqual(await lifecycle.listTodos(), [persisted], 'lifecycle reads persisted TODO data from the local store');

      const updates: TodoRecord[][] = [];
      unsubscribe = lifecycle.onTodoListChanged((snapshot) => updates.push(snapshot));
      assert.equal(await lifecycle.updateTodo(persisted.id, { itemName: 'Edited across restart', viewer: 'Bea' }), true);
      const edited = (await lifecycle.listTodos()).find(({ id }) => id === persisted.id)!;
      assert.equal(edited.itemName, 'Edited across restart');
      assert.equal(edited.createdAt, persisted.createdAt, 'editing does not change the creation timestamp');
      assert.deepEqual(updates.at(-1), [edited], 'editing publishes an updated snapshot');
      now += 1;
      const expiring = await lifecycle.addTodo({ itemName: 'Complete and expire', note: 'Local note' });
      assert.deepEqual(updates.at(-1), [edited, expiring], 'adding publishes the latest full task-list snapshot');

      now += 1;
      assert.equal(await lifecycle.completeTodo(expiring.id), true);
      const completedSnapshot = updates.at(-1);
      assert.equal(completedSnapshot?.length, 2, 'the completed row remains visible during its retention window');
      assert.equal(completedSnapshot?.find((todo) => todo.id === expiring.id)?.completedAt, new Date(now).toISOString());
      assert.deepEqual(clock.scheduledDelays(), [30_000], 'expiry is scheduled from completion for 30 seconds');

      assert.equal(await lifecycle.undoCompleteTodo(expiring.id), true);
      assert.equal(updates.at(-1)?.find((todo) => todo.id === expiring.id)?.completedAt, undefined,
        'undo publishes the task as open again');
      assert.deepEqual(clock.scheduledDelays(), [], 'undo cancels the completion expiry timer');
      assert.equal(await lifecycle.completeTodo(expiring.id), true, 'the restored task can be completed again');
      assert.deepEqual(clock.scheduledDelays(), [30_000], 're-completion starts a fresh timer');

      now += 30_000;
      await clock.advanceAll();
      assert.deepEqual(updates.at(-1), [edited], 'expiry publishes a fresh snapshot without the completed task');
      assert.deepEqual(await lifecycle.listTodos(), [edited]);

      const dismissible = await lifecycle.addTodo({ itemName: 'Remove pending task' });
      assert.deepEqual(updates.at(-1), [edited, dismissible]);
      assert.equal(await lifecycle.removeTodo(dismissible.id), false, 'open tasks cannot use the countdown removal action');
      assert.equal(await lifecycle.completeTodo(dismissible.id), true);
      assert.equal(await lifecycle.removeTodo(dismissible.id), true);
      assert.deepEqual(updates.at(-1), [edited], 'removal publishes the list without the pending task');
      assert.equal(await lifecycle.removeTodo(dismissible.id), false, 'removal fails after the task is gone');

      unsubscribe();
      const updateCount = updates.length;
      now += 1;
      await lifecycle.addTodo({ itemName: 'No longer observed' });
      assert.equal(updates.length, updateCount, 'unsubscribed renderer listeners receive no later snapshots');
    });
  } finally {
    unsubscribe();
    await lifecycle?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('TODO expiry stays active offline, stop clears timers, and restart keeps the original completion deadline', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-todo-offline-'));
  const dataFile = path.join(directory, 'state.sqlite');
  const completedAt = Date.parse('2026-11-02T12:00:00.000Z');
  let now = completedAt;
  let lifecycle: TodoLifecycle | undefined;
  let unsubscribe = () => {};

  try {
    await withFakeTimeouts(async (clock) => {
      const createLifecycle = () => createDesktopLifecycle({
        dataFile,
        serviceFactory: async (options) => createDesktopService({ ...options, now: () => now }),
      }) as unknown as TodoLifecycle;

      lifecycle = createLifecycle();
      await lifecycle.start();
      const added = await lifecycle.addTodo({ itemName: 'Keep the original deadline' });
      assert.equal(await lifecycle.completeTodo(added.id), true);
      assert.deepEqual(clock.scheduledDelays(), [30_000]);

      await lifecycle.disableLan();
      assert.equal((await lifecycle.listTodos())[0]?.completedAt, new Date(completedAt).toISOString(),
        'disabling LAN keeps the local TODO store available');
      assert.deepEqual(clock.scheduledDelays(), [30_000], 'expiry remains scheduled while LAN is disabled');

      now += 10_000;
      await lifecycle.stop();
      assert.deepEqual(clock.scheduledDelays(), [], 'stopping the lifecycle clears pending expiry timers');

      lifecycle = createLifecycle();
      await lifecycle.start();
      const updates: TodoRecord[][] = [];
      unsubscribe = lifecycle.onTodoListChanged((snapshot) => updates.push(snapshot));
      assert.equal((await lifecycle.listTodos())[0]?.completedAt, new Date(completedAt).toISOString());
      assert.deepEqual(clock.scheduledDelays(), [20_000], 'restart schedules only the remaining persisted retention window');

      now = completedAt + 30_000;
      await clock.advanceAll();
      assert.deepEqual(updates.at(-1), [], 'the restarted lifecycle publishes expiry at the original deadline');
      assert.deepEqual(await lifecycle.listTodos(), []);
    });
  } finally {
    unsubscribe();
    await lifecycle?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('throwing TODO listeners cannot reject persisted mutations or block later listeners', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-todo-listener-failure-'));
  const lifecycle = createDesktopLifecycle({ dataFile: path.join(directory, 'state.sqlite') }) as unknown as TodoLifecycle;
  const laterSnapshots: TodoRecord[][] = [];
  let unsubscribeThrowing = () => {};
  let unsubscribeLater = () => {};

  try {
    await lifecycle.start();
    unsubscribeThrowing = lifecycle.onTodoListChanged(() => { throw new Error('renderer listener failure'); });
    unsubscribeLater = lifecycle.onTodoListChanged((snapshot) => laterSnapshots.push(snapshot));

    const addOutcome = await lifecycle.addTodo({ itemName: 'Persist despite listener failure' })
      .then((todo) => ({ fulfilled: true as const, todo }), () => ({ fulfilled: false as const, todo: undefined }));
    const afterAdd = await lifecycle.listTodos();
    const added = afterAdd.find((todo) => todo.itemName === 'Persist despite listener failure');
    const completeOutcome = added
      ? await lifecycle.completeTodo(added.id).then(
        (completed) => ({ fulfilled: true as const, completed }),
        () => ({ fulfilled: false as const, completed: false }),
      )
      : { fulfilled: false as const, completed: false };
    const afterComplete = await lifecycle.listTodos();

    assert.deepEqual({
      addFulfilled: addOutcome.fulfilled,
      addPersisted: added !== undefined,
      laterListenerSawAdd: laterSnapshots[0]?.map((todo) => todo.id),
      completeFulfilled: completeOutcome.fulfilled,
      completionResult: completeOutcome.completed,
      completePersisted: afterComplete.find((todo) => todo.id === added?.id)?.completedAt !== undefined,
      laterListenerSawCompletion: laterSnapshots[1]?.find((todo) => todo.id === added?.id)?.completedAt !== undefined,
    }, {
      addFulfilled: true,
      addPersisted: true,
      laterListenerSawAdd: [added?.id],
      completeFulfilled: true,
      completionResult: true,
      completePersisted: true,
      laterListenerSawCompletion: true,
    });
  } finally {
    unsubscribeThrowing();
    unsubscribeLater();
    await lifecycle.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed LAN service replacement leaves the local TODO list and add operations usable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-todo-lan-failure-'));
  let factoryCalls = 0;
  const lifecycle = createDesktopLifecycle({
    dataFile: path.join(directory, 'state.sqlite'),
    lanHost: '192.168.1.20',
    networkInterfaces: () => ({ lan: [{ address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '192.168.1.20/24' }] }),
    discovery: { start: async () => {}, stop: async () => {} },
    identityStore: createTransportIdentityStore({ get: async () => null, set: async () => {} }),
    serviceFactory: async (options) => {
      factoryCalls += 1;
      if (factoryCalls === 2) throw new Error('LAN replacement failed');
      return createDesktopService(options);
    },
  }) as unknown as TodoLifecycle;

  try {
    await lifecycle.start();
    const beforeFailure = await lifecycle.addTodo({ itemName: 'Already local' });
    const lanStatus = await (lifecycle as TodoLifecycle & { enableLan: () => Promise<{ lanEnabled: boolean }> }).enableLan();
    const listOutcome = await lifecycle.listTodos().then(
      (todos) => ({ fulfilled: true as const, todos }),
      () => ({ fulfilled: false as const, todos: [] as TodoRecord[] }),
    );
    const addOutcome = await lifecycle.addTodo({ itemName: 'Added after LAN failure' }).then(
      (todo) => ({ fulfilled: true as const, todo }),
      () => ({ fulfilled: false as const }),
    );
    const afterAdd = await lifecycle.listTodos();

    assert.deepEqual({
      replacementFailed: lanStatus.lanEnabled === false && factoryCalls === 2,
      listStillWorks: listOutcome.fulfilled && listOutcome.todos.some((todo) => todo.id === beforeFailure.id),
      addStillWorks: addOutcome.fulfilled && listOutcome.fulfilled,
      addedTodoAppears: addOutcome.fulfilled && afterAdd.some((todo) => todo.id === addOutcome.todo?.id),
    }, {
      replacementFailed: true,
      listStillWorks: true,
      addStillWorks: true,
      addedTodoAppears: true,
    });
  } finally {
    await lifecycle.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
