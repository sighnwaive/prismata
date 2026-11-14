import assert from 'node:assert/strict';
import test from 'node:test';

import type { BackendSession } from '@prismata/sync';
import { createDesktopAuthCoordinator } from '../src/auth-coordinator.js';

const now = Date.parse('2026-10-25T12:00:00.000Z');
const refreshLeadWindowMs = 5 * 60_000;

test('sign-in refreshes before expiry, persists the rotated pair before publishing it, and reschedules', async () => {
  const clock = new TestClock(now);
  try {
    const initial = session('initial-access', 'initial-refresh', now + 15 * 60_000);
    const rotated = session('rotated-access', 'rotated-refresh', now + 2 * 60 * 60_000);
    const harness = createHarness({ clock, signInSession: initial, refreshSessions: [rotated] });

    await harness.coordinator.signInWithJoystick();

    const firstRefreshAt = scheduledRefreshAt(clock, initial);
    await clock.advanceTo(firstRefreshAt - 1);
    assert.equal(harness.refreshInputs.length, 0, 'refresh must not fire before its deadline');
    await clock.advanceTo(firstRefreshAt);

    assert.deepEqual(harness.refreshInputs, [initial]);
    assert.deepEqual(harness.coordinator.getSession(), rotated);
    assert.deepEqual(await harness.store.get('prismata.auth.session'), rotated);

    const persistedIndex = harness.events.findIndex((event) => event.type === 'persisted' && event.session.accessToken === rotated.accessToken);
    const publishedIndex = harness.events.findIndex((event) => event.type === 'authenticated' && event.session?.accessToken === rotated.accessToken);
    assert.notEqual(persistedIndex, -1, 'the full rotated token pair must be persisted');
    assert.notEqual(publishedIndex, -1, 'the gateway listener must receive an authenticated event for the rotated session');
    assert.ok(persistedIndex < publishedIndex, 'persist the rotated pair before publishing authenticated state');
    assert.equal(harness.events[persistedIndex]?.session.refreshToken, rotated.refreshToken);
    assert.equal(harness.events[publishedIndex]?.session.refreshToken, rotated.refreshToken);

    const secondRefreshAt = scheduledRefreshAt(clock, rotated);
    assert.ok(secondRefreshAt > firstRefreshAt, 'the next refresh deadline must use the rotated expiry');
    await clock.advanceTo(secondRefreshAt);
    assert.deepEqual(harness.refreshInputs, [initial, rotated]);
  } finally {
    clock.restore();
  }
});

test('a restored session gets a proactive refresh scheduled from its expiry', async () => {
  const clock = new TestClock(now);
  try {
    const restored = session('restored-access', 'restored-refresh', now + 20 * 60_000);
    const rotated = session('startup-rotated-access', 'startup-rotated-refresh', now + 40 * 60_000);
    const harness = createHarness({
      clock,
      storedSession: restored,
      restoredSession: restored,
      refreshSessions: [rotated],
    });

    await harness.coordinator.restoreOnStartup();

    const refreshAt = scheduledRefreshAt(clock, restored);
    await clock.advanceTo(refreshAt);
    assert.deepEqual(harness.refreshInputs, [restored]);
    assert.deepEqual(await harness.store.get('prismata.auth.session'), rotated);
    assert.equal(harness.coordinator.getSnapshot().state, 'authenticated');
    assert.ok(scheduledRefreshAt(clock, rotated) > refreshAt);
  } finally {
    clock.restore();
  }
});

test('sign-out cancels a pending proactive refresh', async () => {
  const clock = new TestClock(now);
  try {
    const initial = session('signout-access', 'signout-refresh', now + 10 * 60_000);
    const harness = createHarness({ clock, signInSession: initial });
    await harness.coordinator.signInWithJoystick();
    const refreshAt = scheduledRefreshAt(clock, initial);

    await harness.coordinator.signOut();

    assert.equal(clock.pendingCount, 0);
    await clock.advanceTo(refreshAt);
    assert.deepEqual(harness.refreshInputs, []);
  } finally {
    clock.restore();
  }
});

test('close cancels a pending proactive refresh', async () => {
  const clock = new TestClock(now);
  try {
    const initial = session('close-access', 'close-refresh', now + 10 * 60_000);
    const harness = createHarness({ clock, signInSession: initial });
    await harness.coordinator.signInWithJoystick();
    const refreshAt = scheduledRefreshAt(clock, initial);

    await harness.coordinator.close();

    assert.equal(clock.pendingCount, 0);
    await clock.advanceTo(refreshAt);
    assert.deepEqual(harness.refreshInputs, []);
  } finally {
    clock.restore();
  }
});

test('a failed runtime refresh fails closed instead of retaining an authenticated session', async () => {
  const clock = new TestClock(now);
  try {
    const restored = session('expired-soon-access', 'expired-soon-refresh', now + 10 * 60_000);
    const harness = createHarness({
      clock,
      storedSession: restored,
      restoredSession: restored,
      refreshError: new Error('refresh rejected'),
    });
    await harness.coordinator.restoreOnStartup();

    const refreshAt = scheduledRefreshAt(clock, restored);
    await clock.advanceTo(refreshAt);

    assert.deepEqual(harness.refreshInputs, [restored]);
    assert.notEqual(harness.coordinator.getSnapshot().state, 'authenticated');
    assert.equal(harness.coordinator.getSession(), null);
    assert.match(harness.coordinator.getSnapshot().error ?? '', /refresh rejected/);
  } finally {
    clock.restore();
  }
});

type TestEvent =
  | { type: 'persisted'; session: BackendSession }
  | { type: 'authenticated'; session: BackendSession | null };

function createHarness(input: {
  clock: TestClock;
  signInSession?: BackendSession;
  storedSession?: BackendSession;
  restoredSession?: BackendSession | null;
  refreshSessions?: BackendSession[];
  refreshError?: Error;
}) {
  const values = new Map<string, unknown>();
  if (input.storedSession) values.set('prismata.auth.session', input.storedSession);
  const refreshInputs: BackendSession[] = [];
  const events: TestEvent[] = [];
  const coordinator = createDesktopAuthCoordinator({
    backend: {
      start: async () => ({ authorizeUrl: 'https://joystick.test/authorize', state: 'oauth-state', redirectUri: '' }),
      complete: async () => {
        if (!input.signInSession) throw new Error('unexpected sign-in completion');
        return input.signInSession;
      },
      restore: async () => input.restoredSession ?? null,
      refresh: async (current) => {
        refreshInputs.push(current);
        if (input.refreshError) throw input.refreshError;
        const next = input.refreshSessions?.shift();
        if (!next) throw new Error('unexpected refresh');
        return next;
      },
      signOut: async () => undefined,
      registerDevice: async () => undefined,
      pullSettings: async () => undefined,
    },
    browser: async () => undefined,
    store: {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value);
        if (key === 'prismata.auth.session') events.push({ type: 'persisted', session: value as BackendSession });
      },
      delete: async (key) => { values.delete(key); },
    },
    createCallbackServer: async () => ({
      redirectUri: 'http://127.0.0.1:43110/auth/callback',
      waitForCallback: async () => 'http://127.0.0.1:43110/auth/callback?code=code&state=oauth-state',
      close: async () => undefined,
    }),
    onStateChanged: (snapshot) => {
      if (snapshot.state === 'authenticated') events.push({ type: 'authenticated', session: coordinator.getSession() });
    },
  });
  return {
    coordinator,
    events,
    refreshInputs,
    store: { get: async (key: string) => values.get(key) ?? null },
  };
}

function session(accessToken: string, refreshToken: string, expiresAt: number): BackendSession {
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(expiresAt).toISOString(),
    state: 'authenticated',
    userId: 'user-123',
  };
}

function scheduledRefreshAt(clock: TestClock, current: BackendSession): number {
  const expiresAt = Date.parse(current.expiresAt);
  const deadline = clock.nextDeadline;
  assert.notEqual(deadline, null, `a proactive refresh must be scheduled for expiry ${current.expiresAt}`);
  assert.ok(deadline! < expiresAt, 'refresh must be scheduled before token expiry');
  assert.ok(deadline! >= expiresAt - refreshLeadWindowMs, 'refresh should be shortly before token expiry');
  return deadline!;
}

type ScheduledTask = {
  callback: (...args: unknown[]) => unknown;
  args: unknown[];
  dueAt: number;
};

class TestClock {
  private nextId = 0;
  private readonly tasks = new Map<object, ScheduledTask>();
  private readonly originalNow = Date.now;
  private readonly originalSetTimeout = globalThis.setTimeout;
  private readonly originalClearTimeout = globalThis.clearTimeout;
  private currentTime: number;

  constructor(initialTime: number) {
    this.currentTime = initialTime;
    Date.now = () => this.currentTime;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => unknown, delay = 0, ...args: unknown[]) => {
      const handle = { id: ++this.nextId };
      this.tasks.set(handle, { callback, args, dueAt: this.currentTime + Math.max(0, Number(delay) || 0) });
      return handle as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout> | undefined) => {
      if (handle && typeof handle === 'object') this.tasks.delete(handle as unknown as object);
    }) as typeof clearTimeout;
  }

  get nextDeadline(): number | null {
    return [...this.tasks.values()].reduce<number | null>((next, task) => next === null || task.dueAt < next ? task.dueAt : next, null);
  }

  get pendingCount(): number { return this.tasks.size; }

  async advanceTo(target: number): Promise<void> {
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) break;
      const [handle, task] = next;
      this.tasks.delete(handle);
      this.currentTime = task.dueAt;
      const result = task.callback(...task.args);
      if (result && typeof (result as Promise<unknown>).then === 'function') await result;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.currentTime = target;
  }

  restore(): void {
    Date.now = this.originalNow;
    globalThis.setTimeout = this.originalSetTimeout;
    globalThis.clearTimeout = this.originalClearTimeout;
  }
}
