import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as preloadApiBoundary from '../electron/preload-api.js';

type TipHistoryRecord = {
  eventId: string;
  title: string;
  viewer?: string;
  amount?: number;
  occurredAt?: string;
};

type TipHistoryPreloadApi = {
  list: () => Promise<TipHistoryRecord[]>;
  onListChanged: (listener: (history: TipHistoryRecord[]) => void) => () => void;
};

const createTipHistoryPreloadApi = (preloadApiBoundary as unknown as {
  createTipHistoryPreloadApi?: (input: TipHistoryPreloadApi) => TipHistoryPreloadApi;
}).createTipHistoryPreloadApi;

test('typed Tip History preload API is read-only and unsubscribes safely', async () => {
  assert.equal(typeof createTipHistoryPreloadApi, 'function', 'preload-api defines a typed Tip History boundary');
  if (!createTipHistoryPreloadApi) return;

  const entry: TipHistoryRecord = {
    eventId: 'preload-tip', title: 'Blue heart', viewer: 'Ada', amount: 18,
    occurredAt: '2026-11-04T18:27:36.000Z',
  };
  let publish!: (snapshot: TipHistoryRecord[]) => void;
  let unsubscribed = false;
  const api = createTipHistoryPreloadApi({
    list: async () => [entry],
    onListChanged(listener) {
      publish = listener;
      return () => { unsubscribed = true; };
    },
  });

  assert.deepEqual(Object.keys(api).sort(), ['list', 'onListChanged'], 'history has no add, edit, delete, or clear operation');
  assert.deepEqual(await api.list(), [entry]);
  const received: TipHistoryRecord[][] = [];
  const unsubscribe = api.onListChanged((snapshot) => received.push(snapshot));
  publish([entry]);
  unsubscribe();
  publish([]);
  assert.deepEqual(received, [[entry]]);
  assert.equal(unsubscribed, true);
});

test('sandboxed preload exposes Tip History list and subscription on dedicated IPC channels', async () => {
  const source = await readFile(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
  const exposed: Record<string, any> = {};
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
  const invocations: string[] = [];
  const entry: TipHistoryRecord = {
    eventId: 'preload-tip', title: 'Blue heart', amount: 18,
    occurredAt: '2026-11-04T18:27:36.000Z',
  };
  const ipcRenderer = {
    invoke: async (channel: string) => {
      invocations.push(channel);
      return channel === 'tip-history:list' ? [entry] : undefined;
    },
    on: (channel: string, handler: (event: unknown, payload: unknown) => void) => listeners.set(channel, handler),
    removeListener: (channel: string, handler: (event: unknown, payload: unknown) => void) => {
      if (listeners.get(channel) === handler) listeners.delete(channel);
    },
  };

  vm.runInNewContext(source, {
    require: (specifier: string) => {
      assert.equal(specifier, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { exposed[name] = value; } },
        ipcRenderer,
      };
    },
  }, { filename: 'preload.mjs' });

  const api = exposed.prismataDesktop?.tipHistory as TipHistoryPreloadApi | undefined;
  assert.ok(api, 'preload exposes a Tip History namespace');
  if (!api) return;
  assert.deepEqual(Object.keys(api).sort(), ['list', 'onListChanged']);
  assert.deepEqual(await api.list(), [entry]);
  const snapshots: TipHistoryRecord[][] = [];
  const unsubscribe = api.onListChanged((snapshot) => snapshots.push(snapshot));
  const listener = listeners.get('tip-history:listChanged');
  assert.equal(typeof listener, 'function');
  listener?.({}, [entry]);
  unsubscribe();
  assert.equal(listeners.has('tip-history:listChanged'), false);
  assert.deepEqual(snapshots, [[entry]]);
  assert.deepEqual(invocations, ['tip-history:list']);
});

test('main process routes history IPC through the ready lifecycle and publishes separate snapshots', async () => {
  const source = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const listStart = source.indexOf("handle('tip-history:list'");
  assert.ok(listStart >= 0, 'main registers a dedicated Tip History list channel');
  const listEnd = source.indexOf('\n  });', listStart);
  assert.ok(listEnd > listStart, 'history list registration has a bounded handler');
  const listHandler = source.slice(listStart, listEnd);
  assert.match(listHandler, /await\s+lifecycleReady/, 'history reads wait for lifecycle startup');
  assert.match(listHandler, /activeLifecycle\.listTipHistory\s*\(\)/, 'history reads do not use the TODO list');
  assert.match(source, /onTipHistoryChanged\s*\(/, 'main subscribes to lifecycle history updates');
  assert.match(source, /webContents\.send\(['"]tip-history:listChanged['"]/, 'history snapshots use a dedicated renderer event');
});
