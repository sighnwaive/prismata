import assert from 'node:assert/strict';
import { appendFile as appendFileToDisk, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJoystickActionCableGateway } from '../src/joystick-gateway.js';

type SocketEvent = { data?: string; code?: number; reason?: string };
type SocketListener = (event: SocketEvent) => void;

class FakeSocket {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, SocketListener[]>();

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string) { this.sent.push(value); }
  close() {}
  emit(type: string, event: SocketEvent = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  frame(value: unknown) { this.emit('message', { data: JSON.stringify(value) }); }
}

const gatewayIdentifier = JSON.stringify({ channel: 'GatewayChannel', event_version: 'v2' });

function createGateway(onEventEnvelope: (event: unknown) => unknown, onEvent: (event: unknown) => unknown) {
  const sockets: FakeSocket[] = [];
  const gateway = createJoystickActionCableGateway({
    getAccessToken: () => 'gateway-token-must-not-be-logged',
    getGrantedPermissions: () => ['stream:read', 'chat:whisper:write'],
    socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    onEventEnvelope,
    onEvent,
  } as Parameters<typeof createJoystickActionCableGateway>[0] & {
    onEventEnvelope: (event: unknown) => unknown;
  });
  return { gateway, sockets };
}

async function confirmSubscription(socket: FakeSocket) {
  socket.frame({ type: 'welcome' });
  socket.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
}

test('gateway observes every post-confirmation event envelope before feature validation, but no ActionCable/control frames', async () => {
  const seen: unknown[] = [];
  const consumed: unknown[] = [];
  const order: string[] = [];
  const acceptedByFeature = { v: 2, type: 'tipped', id: 'accepted', data: { viewer: 'Ada', note: 'full note' } };
  const unknownType = { v: 2, type: 'future_joystick_event', id: 'unknown', data: { marker: 'unknown-envelope' } };
  const malformedType = { v: 2, type: 19, id: 'malformed-type', data: { marker: 'malformed-envelope' } };
  const malformedShape = { v: 1, type: 'tipped', id: 'wrong-version', data: { marker: 'invalid-version' } };
  const { gateway, sockets } = createGateway((envelope) => {
    seen.push(envelope);
    order.push(`log:${(envelope as { id?: string }).id}`);
  }, (envelope) => {
    const event = envelope as { type?: unknown; id?: unknown };
    order.push(`consumer:${String(event.id)}`);
    if (event.type === 'tipped' && typeof event.id === 'string') consumed.push(envelope);
  });

  await gateway.start();
  const socket = sockets[0]!;
  socket.frame({ type: 'message', identifier: gatewayIdentifier, message: acceptedByFeature });
  await confirmSubscription(socket);
  socket.frame({ type: 'welcome' });
  socket.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
  socket.frame({ type: 'ping', message: { id: 'control-ping' } });
  socket.frame({ type: 'disconnect', message: { id: 'control-disconnect' } });
  socket.frame({ type: 'reject_subscription', identifier: gatewayIdentifier, message: { id: 'control-reject' } });
  socket.frame({ type: 'message', identifier: JSON.stringify({ channel: 'OtherChannel', event_version: 'v2' }), message: { v: 2, type: 'tipped', id: 'foreign-channel', data: {} } });
  socket.frame({ type: 'message', message: { v: 2, type: 'tipped', id: 'missing-identifier', data: {} } });
  socket.frame({ type: 'message', identifier: gatewayIdentifier, message: acceptedByFeature });
  socket.frame({ type: 'message', identifier: gatewayIdentifier, message: unknownType });
  socket.frame({ type: 'message', identifier: gatewayIdentifier, message: malformedType });
  socket.frame({ type: 'message', identifier: gatewayIdentifier, message: malformedShape });

  assert.deepEqual({ seen, consumed }, {
    seen: [acceptedByFeature, unknownType, malformedType, malformedShape],
    consumed: [acceptedByFeature],
  }, 'only the exact confirmed identifier reaches diagnostics and feature consumers');
  assert.deepEqual(order.slice(0, 2), ['log:accepted', 'consumer:accepted'], 'logging must run before the feature consumer');
  assert.deepEqual(consumed, [acceptedByFeature], 'unknown and malformed event types remain available to diagnostics but not feature handling');
  assert.equal(order.some((entry) => entry.includes('control-')), false, 'ActionCable control frames are not event envelopes');
  await gateway.stop();
});

test('a rejected/throwing event logger does not suppress downstream event consumers', async () => {
  const event = { v: 2, type: 'tipped', id: 'logger-failure', data: { viewer: 'Ada' } };
  const logged: unknown[] = [];
  const consumed: unknown[] = [];
  const { gateway, sockets } = createGateway(async (envelope) => {
    logged.push(envelope);
    throw new Error('disk failure; must not include event contents');
  }, (envelope) => { consumed.push(envelope); });

  await gateway.start();
  await confirmSubscription(sockets[0]!);
  sockets[0]!.frame({ type: 'message', identifier: gatewayIdentifier, message: event });
  await Promise.resolve();

  assert.deepEqual(logged, [event], 'logger must be attempted before downstream processing');
  assert.deepEqual(consumed, [event], 'a diagnostic write failure cannot break whisper or other event consumers');
  await gateway.stop();
});

test('a downstream consumer failure does not prevent the envelope logger from seeing the event', async () => {
  const event = { v: 2, type: 'tipped', id: 'consumer-failure', data: { viewer: 'Ada' } };
  const logged: unknown[] = [];
  const { gateway, sockets } = createGateway((envelope) => { logged.push(envelope); }, () => {
    throw new Error('consumer failure');
  });

  await gateway.start();
  await confirmSubscription(sockets[0]!);
  sockets[0]!.frame({ type: 'message', identifier: gatewayIdentifier, message: event });

  assert.deepEqual(logged, [event]);
  await gateway.stop();
});

type EventLogger = {
  start: () => Promise<void>;
  write: (event: unknown) => Promise<void>;
  pruneExpired: () => Promise<void>;
  getCurrentLogFilePath?: () => string | undefined;
  flush?: () => Promise<void>;
  drain?: () => Promise<void>;
};

type EventLoggerInput = {
  userDataPath: string;
  isDevelopment: boolean;
  now?: () => Date;
  appendFile?: (...args: any[]) => Promise<unknown>;
};

async function createEventLogger(input: {
  userDataPath: string;
  isDevelopment: boolean;
  now?: () => Date;
  appendFile?: (...args: any[]) => Promise<unknown>;
}): Promise<EventLogger> {
  const loggerModulePath = '../src/joystick-event-log.js';
  const boundary = await import(loggerModulePath) as {
    createJoystickEventLogger?: (options: EventLoggerInput) => EventLogger;
  };
  assert.equal(typeof boundary.createJoystickEventLogger, 'function', 'desktop must expose its local Joystick event-log service');
  return boundary.createJoystickEventLogger!(input);
}

async function withTempDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'prismata-joystick-event-log-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test('development logging appends one JSONL record with UTC receive time and the complete unredacted event', async () => {
  await withTempDirectory(async (userDataPath) => {
    const logger = await createEventLogger({
      userDataPath,
      isDevelopment: true,
      now: () => new Date('2026-03-01T00:30:00+02:00'),
    });
    const event = {
      v: 2,
      type: 'tipped',
      id: 'sensitive-event-id',
      data: { viewer_id: 'viewer-123', viewer: 'Ada', note: 'unredacted private note', tokens: 42 },
    };

    await logger.start();
    await logger.write(event);

    const file = join(userDataPath, 'logs', 'joystick-events-2026-02-28.jsonl');
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
    assert.equal(lines.length, 1, 'one event produces one JSON line');
    const record = JSON.parse(lines[0]!) as { receivedAt: string; event: unknown };
    assert.deepEqual(record, { receivedAt: '2026-02-28T22:30:00.000Z', event });
    assert.deepEqual(JSON.parse(JSON.stringify(record.event)), event, 'viewer identity and note remain full and unredacted');
    await logger.pruneExpired();
  });
});

test('development logger resolves the current UTC-dated JSONL path under userData', async () => {
  await withTempDirectory(async (userDataPath) => {
    const logger = await createEventLogger({
      userDataPath,
      isDevelopment: true,
      now: () => new Date('2026-11-02T00:30:00+02:00'),
    });
    await logger.start();

    assert.equal(typeof logger.getCurrentLogFilePath, 'function', 'logger exposes the active development log path');
    assert.equal(
      logger.getCurrentLogFilePath!(),
      join(userDataPath, 'logs', 'joystick-events-2026-11-01.jsonl'),
      'the active filename uses the current UTC date, not the local calendar date',
    );
  });
});

test('concurrent writes produce complete JSONL records in receipt order', async () => {
  await withTempDirectory(async (userDataPath) => {
    const firstAppendStarted = deferred<void>();
    const releaseFirstAppend = deferred<void>();
    const secondAppendStarted = deferred<void>();
    const secondAppendFinished = deferred<void>();
    const appendContents: string[] = [];
    const logger = await createEventLogger({
      userDataPath,
      isDevelopment: true,
      now: () => new Date('2026-11-02T12:00:00.000Z'),
      appendFile: async (file: string, content: string, options: { encoding: 'utf8'; mode: number }) => {
        appendContents.push(content);
        if (content.includes('receipt-first')) {
          firstAppendStarted.resolve(undefined);
          await releaseFirstAppend.promise;
        } else if (content.includes('receipt-second')) {
          secondAppendStarted.resolve(undefined);
        }
        await appendFileToDisk(file, content, options);
        if (content.includes('receipt-second')) secondAppendFinished.resolve(undefined);
      },
    });
    await logger.start();

    const firstEvent = { id: 'receipt-first', data: { note: 'first complete record' } };
    const secondEvent = { id: 'receipt-second', data: { note: 'second complete record' } };
    const firstWrite = logger.write(firstEvent);
    const secondWrite = logger.write(secondEvent);
    await firstAppendStarted.promise;

    // Hold the first injected append until the second enters. The timeout is only a
    // deadlock escape if a serialized implementation correctly keeps the second queued.
    let releaseTimeout: ReturnType<typeof setTimeout> | undefined;
    const secondEntered = await Promise.race([
      secondAppendStarted.promise.then(() => true),
      new Promise<boolean>((resolve) => { releaseTimeout = setTimeout(() => resolve(false), 1000); }),
    ]);
    if (releaseTimeout) clearTimeout(releaseTimeout);
    const secondAppendEnteredBeforeRelease = secondEntered;
    if (secondAppendEnteredBeforeRelease) await secondAppendFinished.promise;
    releaseFirstAppend.resolve(undefined);
    await Promise.all([firstWrite, secondWrite]);

    const file = join(userDataPath, 'logs', 'joystick-events-2026-11-02.jsonl');
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
    const records = lines.map((line) => JSON.parse(line) as { receivedAt: string; event: unknown });
    assert.equal(records.length, 2, 'each concurrent event is stored as its own complete JSONL record');
    assert.deepEqual(records.map((record) => record.event), [firstEvent, secondEvent], 'records retain receipt order');
    assert.equal(secondAppendEnteredBeforeRelease, false, 'the next append waits for the in-flight record instead of racing it');
    assert.deepEqual(records.map((record) => record.receivedAt), [
      '2026-11-02T12:00:00.000Z',
      '2026-11-02T12:00:00.000Z',
    ]);
  });
});

test('logger flush/drain waits for writes already in flight', async () => {
  await withTempDirectory(async (userDataPath) => {
    const appendStarted = deferred<void>();
    const releaseAppend = deferred<void>();
    const appended: Array<{ file: string; content: string }> = [];
    const logger = await createEventLogger({
      userDataPath,
      isDevelopment: true,
      now: () => new Date('2026-11-02T12:00:00.000Z'),
      appendFile: async (file: string, content: string) => {
        appendStarted.resolve(undefined);
        await releaseAppend.promise;
        appended.push({ file, content });
      },
    });
    await logger.start();

    const drain = logger.flush ?? logger.drain;
    assert.equal(typeof drain, 'function', 'the logger exposes an awaitable flush/drain operation');
    const writePromise = logger.write({ id: 'write-in-flight', data: { note: 'diagnostic event' } });
    const writerWasInjected = await Promise.race([
      appendStarted.promise.then(() => true),
      writePromise.then(() => false),
    ]);
    assert.equal(writerWasInjected, true, 'the deferred append writer starts before drain is requested');

    let drainSettled = false;
    const drainPromise = drain!.call(logger).then(() => { drainSettled = true; });
    await Promise.resolve();
    const settledBeforeAppend = drainSettled;
    releaseAppend.resolve(undefined);
    await Promise.all([writePromise, drainPromise]);

    assert.equal(settledBeforeAppend, false, 'drain remains pending while an append is blocked');
    assert.equal(drainSettled, true, 'drain resolves after the append settles');
    assert.equal(appended.length, 1);
    assert.match(appended[0]!.content, /write-in-flight/);
  });
});

test('production/packaged mode creates and appends no diagnostic log files', async () => {
  await withTempDirectory(async (userDataPath) => {
    const logger = await createEventLogger({ userDataPath, isDevelopment: false });
    await logger.start();
    assert.equal(typeof logger.getCurrentLogFilePath, 'function', 'logger exposes whether an active log path exists');
    assert.equal(logger.getCurrentLogFilePath!(), undefined, 'packaged mode has no active event-log path');
    await logger.write({ v: 2, type: 'tipped', id: 'production-must-not-write' });
    await assert.rejects(readdir(join(userDataPath, 'logs')), { code: 'ENOENT' });
  });
});

test('startup and runtime pruning delete only Joystick logs older than 30 days', async () => {
  await withTempDirectory(async (userDataPath) => {
    const logs = join(userDataPath, 'logs');
    await mkdir(logs);
    await writeFile(join(logs, 'joystick-events-2026-10-01.jsonl'), 'old');
    await writeFile(join(logs, 'joystick-events-2026-10-04.jsonl'), 'within-retention');
    await writeFile(join(logs, 'other-log.jsonl'), 'unrelated');
    const logger = await createEventLogger({
      userDataPath,
      isDevelopment: true,
      now: () => new Date('2026-11-02T00:00:00.000Z'),
    });

    await logger.start();
    assert.deepEqual((await readdir(logs)).sort(), [
      'joystick-events-2026-10-04.jsonl',
      'other-log.jsonl',
    ], 'startup removes only dated Joystick files beyond the 30-day window');

    await writeFile(join(logs, 'joystick-events-2026-10-01.jsonl'), 'reintroduced-old-file');
    await logger.pruneExpired();
    assert.deepEqual((await readdir(logs)).sort(), [
      'joystick-events-2026-10-04.jsonl',
      'other-log.jsonl',
    ], 'the pruning operation remains usable while logging is active');
  });
});

test('write and pruning diagnostics never expose unredacted event values when filesystem operations fail', async () => {
  await withTempDirectory(async (directory) => {
    const userDataPath = join(directory, 'not-a-directory');
    await writeFile(userDataPath, 'block directory creation');
    const event = { v: 2, type: 'tipped', id: 'private-event-id', data: { note: 'private-viewer-note' } };
    const logger = await createEventLogger({ userDataPath, isDevelopment: true });
    const calls: unknown[][] = [];
    const failures: unknown[] = [];
    const originals = {
      log: console.log,
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
    const capture = (...args: unknown[]) => { calls.push(args); };
    console.log = capture;
    console.debug = capture;
    console.info = capture;
    console.warn = capture;
    console.error = capture;
    try {
      await logger.start().catch((error) => { failures.push(error); });
      await logger.write(event).catch((error) => { failures.push(error); });
      await logger.pruneExpired().catch((error) => { failures.push(error); });
      const diagnostics = JSON.stringify([calls, failures]);
      assert.doesNotMatch(diagnostics, /private-event-id|private-viewer-note/);
      assert.doesNotMatch(diagnostics, /gateway-token|Authorization:|api\.joystick\.tv/);
    } finally {
      console.log = originals.log;
      console.debug = originals.debug;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
    }
  });
});

test('main process wires local logging only for development and prunes during runtime', async () => {
  const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  assert.ok(/joystick-event-log/.test(mainSource), 'main must import the local event logger');
  assert.ok(/getPath\(['"]userData['"]\)/.test(mainSource), 'logs must live under Electron userData');
  assert.ok(/isDevelopment\s*:\s*!app\.isPackaged/.test(mainSource), 'packaged builds must explicitly disable logging');
  assert.ok(/pruneExpired/.test(mainSource), 'main must prune expired files at startup');
  assert.ok(/setInterval|schedulePrun/i.test(mainSource), 'retention pruning must continue after application startup');
});

test('Electron startup prints the development log path once after logger initialization without event data or credentials', async () => {
  const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const startupStart = mainSource.indexOf('app.whenReady().then');
  const startupEnd = mainSource.indexOf('}).catch((error) =>', startupStart);
  assert.ok(startupStart >= 0 && startupEnd > startupStart, 'main has a bounded app-ready startup callback');
  const startupSource = mainSource.slice(startupStart, startupEnd);
  const loggerStart = startupSource.indexOf('await joystickEventLogger.start();');
  assert.ok(loggerStart >= 0, 'the event logger is initialized before the path is printed');

  const pathPrints = [...startupSource.matchAll(/developmentLog\('log',\s*(joystickEventLogger\.getCurrentLogFilePath\(\))\);/g)];
  assert.equal(pathPrints.length, 1, 'startup prints the active event-log path exactly once');
  assert.equal(
    pathPrints[0]![1]!.trim(),
    'joystickEventLogger.getCurrentLogFilePath()',
    'the sole printed value is the path, not an event envelope or credential',
  );
  assert.ok(pathPrints[0]!.index! > loggerStart, 'the path is printed only after logger.start() completes');
  assert.match(
    startupSource,
    /developmentLog\('log',\s*joystickEventLogger\.getCurrentLogFilePath\(\)\);/,
    'only unpackaged development startup prints the path through the guarded logger',
  );
  assert.match(mainSource, /function developmentLog\(method, \.\.\.args\)[\s\S]*?if\s*\(app\.isPackaged\)\s*return;[\s\S]*?console\[method\]\(\.\.\.args\)/,
    'the shared console logger suppresses all app output in packaged builds');
  assert.doesNotMatch(pathPrints[0]![1]!, /envelope|viewer|tokens?|credential|authorization/i);
});

test('main shutdown drains event writes after gateway shutdown and before quitting', async () => {
  const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const runtimeSource = await readFile(new URL('../electron/joystick-whisper-runtime.ts', import.meta.url), 'utf8');
  const beforeQuit = mainSource.slice(mainSource.indexOf("app.on('before-quit'"));
  const shutdownContinuation = beforeQuit.match(/Promise\.all\(\[([\s\S]*?)\]\)\.(?:then|finally)\(\s*(async\s*)?\(\)\s*=>\s*\{([\s\S]*?)\}\)/);

  const runtimeShutdown = runtimeSource.slice(runtimeSource.indexOf('async shutdown()'), runtimeSource.indexOf('async getSettings()', runtimeSource.indexOf('async shutdown()')));
  assert.match(runtimeShutdown, /await gateway\.stop\(\)/, 'runtime shutdown awaits gateway stop before resolving');
  assert.ok(shutdownContinuation, 'shutdown waits for its cleanup promise before final quit');
  assert.match(shutdownContinuation![1]!, /activeJoystickWhisperRuntime\?\.shutdown\(\)/,
    'the cleanup promise waits for the runtime to stop its gateway');
  assert.match(shutdownContinuation![3]!, /await\s+joystickEventLogger\??\.(?:flush|drain)\(\)/,
    'the logger is drained only after the gateway shutdown promise resolves');
  assert.ok(shutdownContinuation![2], 'the post-shutdown continuation is async so it can await log draining');
  assert.ok(shutdownContinuation![3]!.indexOf('joystickEventLogger') < shutdownContinuation![3]!.indexOf('app.quit()'),
    'Electron quits only after diagnostic log writes have drained');
});

test('root README documents the platform userData location and diagnostic-log privacy and retention', async () => {
  const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
  assert.ok(/userData/i.test(readme), 'README must identify the Electron userData directory');
  assert.ok(/logs\/joystick-events-YYYY-MM-DD\.jsonl/.test(readme), 'README must give the exact daily log path');
  assert.ok(/Windows/i.test(readme) && /macOS/i.test(readme) && /Linux/i.test(readme), 'README must help locate the directory on each desktop platform');
  assert.ok(/%APPDATA%/i.test(readme), 'README must name the Windows app-data root');
  assert.ok(/Library\/Application Support/i.test(readme), 'README must name the macOS app-data root');
  assert.ok(/XDG_CONFIG_HOME|~\/.config/i.test(readme), 'README must name the Linux app-data root');
  assert.ok(/development-only/i.test(readme), 'README must state the development-only scope');
  assert.ok(/unredacted/i.test(readme), 'README must warn that event data is unredacted');
  assert.ok(/30 days/i.test(readme), 'README must state the retention period');
  assert.ok(/no (maximum )?size cap|no size limit/i.test(readme), 'README must warn that there is no size cap');
});
