import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as zipZlib from 'node:zlib';
import * as preloadApiBoundary from '../electron/preload-api.js';
import { renderShellPage } from '../electron/shell-page.js';

type SupportLogOperation =
  | 'auth.sign-in'
  | 'auth.sign-out'
  | 'admin.set-lan-enabled'
  | 'admin.set-advertised-address'
  | 'joystick-whispers.save-settings'
  | 'joystick-chat-automations.save-drop-in'
  | 'joystick-chat-automations.save-slash-command'
  | 'todos.save'
  | 'reminders.save';

type SupportLogContext = {
  operation: SupportLogOperation;
  errorName?: string;
  errorCode?: string;
  appState?: 'offline' | 'signed-out' | 'opening-browser' | 'waiting-for-callback'
    | 'authenticated' | 'failure' | 'enabled' | 'disabled';
  inputField?: 'whisper-message' | 'drop-in-message' | 'slash-command-response'
    | 'todo-note' | 'reminder-message';
  inputValue?: string;
};

type ErrorReport = {
  source: 'main' | 'renderer';
  message: string;
  stack?: string;
  context?: SupportLogContext;
};

type SupportLogService = {
  reportError: (report: ErrorReport) => Promise<void>;
  exportLogs: () => Promise<void>;
};

type SupportLogServiceInput = {
  userDataPath: string;
  downloadsPath: string;
  now?: () => Date;
};

type SupportLogsPreloadApi = {
  reportError: (report: ErrorReport) => Promise<void>;
  exportLogs: () => Promise<void>;
};

type FakeElement = {
  id?: string;
  textContent: string;
  innerHTML: string;
  value: string;
  checked: boolean;
  hidden: boolean;
  disabled: boolean;
  className: string;
  onclick?: () => unknown;
  onchange?: (event?: { currentTarget?: FakeElement }) => unknown;
  onsubmit?: (event: { preventDefault(): void }) => unknown;
  classList: { add(...names: string[]): void; toggle(name: string, force?: boolean): boolean };
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | undefined;
  addEventListener(type: string, listener: (...args: any[]) => unknown): void;
  append(...children: unknown[]): void;
  replaceChildren(...children: unknown[]): void;
  querySelectorAll(selector: string): FakeElement[];
  focus(): void;
  style: Record<string, string>;
  dataset: Record<string, string>;
};

type ShellHarnessOptions = {
  reportError?: (report: ErrorReport) => Promise<void>;
  addTodo?: (input: { itemName: string; viewer?: string; note?: string }) => Promise<unknown>;
  signInWithJoystick?: () => Promise<void>;
  updateWhisperSettings?: (settings: unknown) => Promise<unknown>;
  updateChatAutomationSettings?: (settings: unknown) => Promise<unknown>;
  createReminder?: (settings: unknown) => Promise<unknown>;
  sendDirectMessage?: (text: string) => Promise<void>;
};

const mainSource = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
const supportLogsPreloadApiFactory = (preloadApiBoundary as unknown as {
  createSupportLogsPreloadApi?: (input: SupportLogsPreloadApi) => SupportLogsPreloadApi;
}).createSupportLogsPreloadApi;

async function createSupportLogService(input: SupportLogServiceInput): Promise<SupportLogService | undefined> {
  const modulePath = '../src/support-log.js';
  let boundary: {
    createSupportLogService?: (options: SupportLogServiceInput) => SupportLogService;
  };
  try {
    boundary = await import(modulePath) as typeof boundary;
  } catch (cause) {
    const moduleUrl = new URL('../src/support-log.js', import.meta.url).href;
    const missingExpectedModule = cause !== null
      && typeof cause === 'object'
      && 'code' in cause
      && cause.code === 'ERR_MODULE_NOT_FOUND'
      && 'url' in cause
      && cause.url === moduleUrl;
    if (!missingExpectedModule) throw cause;
    boundary = {};
  }
  assert.equal(typeof boundary.createSupportLogService, 'function',
    'desktop exposes a support-log service for persisted application errors and exports');
  return boundary.createSupportLogService?.(input);
}

async function withTempDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'prismata-support-log-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function filesUnder(directory: string): Promise<Array<{ path: string; contents: string }>> {
  const files: Array<{ path: string; contents: string }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push({ path, contents: await readFile(path, 'utf8') });
  }
  return files;
}

function readZipEntries(bytes: Buffer): Array<{ name: string; contents: Buffer }> {
  let endOffset = -1;
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) endOffset = offset;
  }
  assert.notEqual(endOffset, -1, 'export is a ZIP archive with an end-of-central-directory record');
  const entryCount = bytes.readUInt16LE(endOffset! + 10);
  let offset = bytes.readUInt32LE(endOffset! + 16);
  const entries: Array<{ name: string; contents: Buffer }> = [];

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'ZIP contains a valid central-directory entry');
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let contents: Buffer;
    if (method === 0) contents = Buffer.from(compressed);
    else if (method === 8) {
      contents = zipZlib.inflateRawSync(compressed);
    } else {
      assert.fail(`unsupported ZIP compression method ${method}`);
    }
    entries.push({ name, contents });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function createShellHarness(exportLogs: () => Promise<void>, options: ShellHarnessOptions = {}) {
  const elements = new Map<string, FakeElement>();
  const createdElements: FakeElement[] = [];
  const makeElement = (): FakeElement => {
    const element: FakeElement = {
      id: '',
      textContent: '',
      innerHTML: '',
      value: '',
      checked: false,
      hidden: false,
      disabled: false,
      className: '',
      classList: { add: () => {}, toggle: () => false },
      setAttribute: () => {},
      getAttribute: () => undefined,
      addEventListener: () => {},
      append: () => {},
      replaceChildren: () => {},
      querySelectorAll: () => [],
      focus: () => {},
      style: {},
      dataset: {},
    };
    createdElements.push(element);
    return element;
  };
  const document = {
    getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id)!;
    },
    createElement: makeElement,
    querySelectorAll: () => [],
  };
  const settings = Object.fromEntries(['followed', 'subscribed', 'resubscribed', 'giftSender']
    .map((rule) => [rule, { enabled: false, message: '' }]));
  const status = {
    state: 'offline',
    lanEnabled: false,
    protocol: 'https',
    discovery: 'stopped',
    host: '127.0.0.1',
  };
  const shellApi = {
    admin: {
      getStatus: async () => status,
      listNetworkInterfaces: async () => [],
      listDevices: async () => [],
      listConnectionRequests: async () => [],
      setLanEnabled: async () => status,
      setAdvertisedAddress: async () => status,
      retryAdvertising: async () => status,
      revokeDevice: async () => {},
      approveConnectionRequest: async () => {},
    },
    auth: {
      onStateChanged: () => () => {},
      getSnapshot: async () => ({ state: 'signed-out' }),
      signInWithJoystick: options.signInWithJoystick ?? (async () => {}),
      signOut: async () => {},
      cancel: async () => {},
    },
    joystickWhispers: {
      onStatusChanged: () => () => {},
      getStatus: async () => ({
        connection: { state: 'unavailable' },
        delivery: { state: 'idle' },
        stream: { state: 'offline', viewerCount: 0 },
      }),
      getSettings: async () => settings,
      updateSettings: options.updateWhisperSettings ?? (async (next: unknown) => next),
    },
    joystickChatAutomations: {
      getSettings: async () => ({ dropIn: { enabled: false, messages: [] }, slashCommands: { prefix: '!', commands: [] } }),
      updateSettings: options.updateChatAutomationSettings ?? (async (next: unknown) => next),
    },
    joystickChat: { list: async () => [], onListChanged: () => () => {} },
     directMessage: { send: options.sendDirectMessage ?? (async () => {}) },
    todos: {
      onListChanged: () => () => {},
      list: async () => [],
      add: options.addTodo ?? (async () => ({})),
      update: async () => {},
      complete: async () => {},
      undoComplete: async () => {},
      remove: async () => {},
    },
    tipHistory: { list: async () => [], onListChanged: () => () => {} },
    reminder: {
      list: async () => [],
      create: options.createReminder ?? (async () => {}),
      updateRecord: async () => {},
      remove: async () => {},
      test: async () => {},
      testRecord: async () => {},
    },
    supportLogs: {
      reportError: options.reportError ?? (async () => {}),
      exportLogs,
    },
  };
  const page = renderShellPage('offline', 'Prismata');
  const script = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, 'the shell includes its UI script');
  vm.runInNewContext(script!, {
    document,
    window: { prismataDesktop: shellApi, addEventListener: () => {} },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    confirm: () => true,
  });
  const buttonMarkup = page.match(/<button\b[^>]*id="([^"]*(?:support-logs|error-logs)[^"]*)"[^>]*>/);
  assert.ok(buttonMarkup, 'the top panel contains the support-log export button');
  return {
    elements,
    createdElements,
    element: (id: string) => document.getElementById(id),
    button: elements.get(buttonMarkup![1]!)!,
  };
}

function buttonCssStyle(page: string, className: string, hovered = false): Record<string, string> {
  const css = page.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectorText, body]) => ({
    selectors: selectorText!.split(',').map((selector) => selector.trim()),
    declarations: Object.fromEntries(body!.split(';').flatMap((declaration) => {
      const separator = declaration.indexOf(':');
      if (separator < 0) return [];
      return [[declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()]];
    })),
  }));
  const classes = new Set([className]);
  const style: Record<string, string> = {};

  for (const rule of rules) {
    const applies = rule.selectors.some((selector) => {
      const pseudoStates = [...selector.matchAll(/:([\w-]+)/g)].map((match) => match[1]);
      if (pseudoStates.some((state) => state !== 'hover' || !hovered)) return false;
      const simpleSelector = selector.replace(/:[\w-]+/g, '');
      if (/\s|[>+~#]/.test(simpleSelector)) return false;
      const tag = simpleSelector.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && tag.toLowerCase() !== 'button') return false;
      const requiredClasses = [...simpleSelector.matchAll(/\.([\w-]+)/g)].map((match) => match[1]!);
      return (tag === 'button' || requiredClasses.length > 0)
        && requiredClasses.every((requiredClass) => classes.has(requiredClass));
    });
    if (applies) Object.assign(style, rule.declarations);
  }

  if (style.color === 'inherit') {
    const root = rules.find((rule) => rule.selectors.includes(':root'));
    style.color = root?.declarations.color ?? style.color;
  }
  return style;
}

test('support-log service persists reported main and renderer errors, without a general diagnostics writer', async () => {
  await withTempDirectory(async (directory) => {
    const service = await createSupportLogService({
      userDataPath: join(directory, 'user-data'),
      downloadsPath: join(directory, 'Downloads'),
      now: () => new Date('2026-11-27T12:00:00.000Z'),
    });
    assert.ok(service, 'support-log service is available');
    if (!service) return;

    await service.reportError({
      source: 'main',
      message: 'Caught main application error access_token=secret-token-value',
      stack: 'Error: Caught main application error\n    at main-process\n    Bearer secret-token-value',
    });
    await service.reportError({
      source: 'renderer',
      message: 'Reported renderer application error',
      stack: 'Error: Reported renderer application error\n    at renderer',
    });
    await service.reportError({ source: 'renderer', message: 'm'.repeat(100_000), stack: 's'.repeat(200_000) });

    const persisted = await filesUnder(join(directory, 'user-data'));
    assert.ok(persisted.some(({ contents }) => contents.includes('Caught main application error')),
      'caught main-process errors are persisted');
    assert.ok(persisted.some(({ contents }) => contents.includes('Reported renderer application error')),
      'reported renderer errors are persisted');
    assert.ok(persisted.some(({ contents }) => contents.includes('main-process'))
      && persisted.some(({ contents }) => contents.includes('renderer')),
    'error records retain useful stack details');
    const persistedText = persisted.map(({ contents }) => contents).join('\n');
    assert.doesNotMatch(persistedText, /secret-token-value/,
      'known credential formats are redacted from error messages and stacks');
    assert.ok(Buffer.byteLength(persistedText) < 20_000,
      'oversized error messages and stacks are bounded before persistence');
    assert.deepEqual(Object.keys(service).sort(), ['exportLogs', 'reportError'],
      'the logger exposes error reporting and export, not a generic warning/info/debug writer');
  });
});

test('support-log persists only allowlisted failure context and bounds relevant user-entered values', async () => {
  await withTempDirectory(async (directory) => {
    const service = await createSupportLogService({
      userDataPath: join(directory, 'user-data'),
      downloadsPath: join(directory, 'Downloads'),
      now: () => new Date('2026-11-27T12:00:00.000Z'),
    });
    assert.ok(service, 'support-log service is available');
    if (!service) return;

    const longInputValue = 'relevant-private-user-text '.repeat(500);
    const report = {
      source: 'renderer',
      message: 'Unable to save the whisper message.',
      context: {
        operation: 'joystick-whispers.save-settings',
        errorName: 'Error',
        errorCode: 'EACCES',
        appState: 'failure',
        inputField: 'whisper-message',
        inputValue: longInputValue,
        password: 'do-not-log-password',
        token: 'do-not-log-token',
        oauthCode: 'do-not-log-oauth-code',
        oauthState: 'do-not-log-oauth-state',
        verifier: 'do-not-log-verifier',
        pairingCode: 'do-not-log-pairing-code',
        credentials: 'do-not-log-credentials',
        deviceId: 'do-not-log-device-id',
        requestId: 'do-not-log-request-id',
        id: 'do-not-log-id',
        state: 'do-not-log-auth-state',
        arbitraryField: 'do-not-log-unknown-context',
        details: {
          privateText: 'do-not-log-nested-arbitrary-object',
          token: 'do-not-log-nested-token',
        },
      },
      credentials: 'do-not-log-top-level-credentials',
      deviceId: 'do-not-log-top-level-device-id',
    } as ErrorReport;

    await service.reportError(report);
    await service.reportError({
      source: 'renderer',
      message: 'Inline credential redaction fixture',
      context: {
        operation: 'todos.save',
        inputField: 'todo-note',
        inputValue: 'Relevant note oauth_code=inline-oauth-code auth_state=inline-auth-state pairing_code=inline-pairing-code code_verifier=inline-verifier credentials=inline-credentials access_token=inline-token code=inline-bare-code state=inline-bare-state authorization_code=inline-authorization-code',
      },
    });

    const contents = await readFile(join(directory, 'user-data', 'logs', 'application-errors.jsonl'), 'utf8');
    const [record, redactedRecord] = contents.trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(record.context, {
      operation: 'joystick-whispers.save-settings',
      errorName: 'Error',
      errorCode: 'EACCES',
      appState: 'failure',
      inputField: 'whisper-message',
      inputValue: longInputValue.slice(0, 2_000),
    }, 'only static operation metadata and an allowlisted, bounded input field are persisted');
    assert.ok(record.context.inputValue.length <= 2_000, 'user-entered context is bounded');
    assert.doesNotMatch(contents,
      /do-not-log-(?:password|token|oauth-code|oauth-state|verifier|pairing-code|credentials|device-id|request-id|id|auth-state|unknown-context|nested-arbitrary-object|nested-token|top-level-credentials|top-level-device-id)/,
      'sensitive fields, identifiers, unknown fields, and nested arbitrary objects are not logged');
    assert.equal(Object.keys(record.context).some((key) => key === 'details' || key === 'arbitraryField'), false,
      'arbitrary context objects and properties are dropped');
    assert.equal(redactedRecord.context.inputValue,
      'Relevant note oauth_code=[REDACTED] auth_state=[REDACTED] pairing_code=[REDACTED] code_verifier=[REDACTED] credentials=[REDACTED] access_token=[REDACTED] code=[REDACTED] state=[REDACTED] authorization_code=[REDACTED]',
      'credentials and authorization codes are redacted even inside an explicitly selected user field');
    assert.doesNotMatch(contents, /inline-(?:oauth-code|auth-state|pairing-code|verifier|credentials|token|bare-code|bare-state|authorization-code)/,
      'inline OAuth/auth codes, pairing codes, verifiers, credentials, and tokens are absent from disk');
  });
});

test('support-log ZIP contains only the error log and is written under the supplied Downloads directory', async () => {
  await withTempDirectory(async (directory) => {
    const userDataPath = join(directory, 'user-data');
    const downloadsPath = join(directory, 'Downloads');
    const eventLogPath = join(userDataPath, 'logs', 'joystick-events-2026-11-27.jsonl');
    await mkdir(join(userDataPath, 'logs'), { recursive: true });
    await writeFile(eventLogPath, '{"event":{"id":"private-joystick-envelope"}}\n');

    const service = await createSupportLogService({
      userDataPath,
      downloadsPath,
      now: () => new Date('2026-11-27T12:00:00.000Z'),
    });
    assert.ok(service, 'support-log service is available');
    if (!service) return;
    await service.reportError({
      source: 'main',
      message: 'Archive this application error',
      context: {
        operation: 'todos.save',
        appState: 'signed-out',
        inputField: 'todo-note',
        inputValue: 'ZIP-ALLOWLISTED-USER-TEXT',
        token: 'do-not-export-zip-token',
        details: { privateText: 'do-not-export-zip-arbitrary-data' },
      },
    } as ErrorReport);
    await service.exportLogs();

    const archives = (await readdir(downloadsPath))
      .filter((name) => name.toLowerCase().endsWith('.zip'));
    assert.equal(archives.length, 1, 'one error-log ZIP is created in Downloads');
    const archive = await readFile(join(downloadsPath, archives[0]!));
    const entries = readZipEntries(archive);
    assert.equal(entries.length, 1, 'the archive contains only the support error log');
    assert.doesNotMatch(entries[0]!.name, /joystick|event-envelope/i,
      'Joystick event-envelope logs are never included');
    const exportedLog = entries[0]!.contents.toString('utf8');
    assert.match(exportedLog, /Archive this application error/,
      'the archive includes persisted application errors');
    assert.match(exportedLog, /ZIP-ALLOWLISTED-USER-TEXT/,
      'the archive includes explicitly selected, allowlisted user input');
    assert.doesNotMatch(exportedLog, /do-not-export-zip-(?:token|arbitrary-data)/,
      'secrets and arbitrary context are excluded from the exported error log');
    assert.doesNotMatch(entries[0]!.contents.toString('utf8'), /private-joystick-envelope/,
      'private Joystick event data is absent from the archive contents');
  });
});

test('a concurrent export waits for an error report already queued before the export', async () => {
  await withTempDirectory(async (directory) => {
    const downloadsPath = join(directory, 'Downloads');
    const service = await createSupportLogService({
      userDataPath: join(directory, 'user-data'),
      downloadsPath,
    });
    assert.ok(service, 'support-log service is available');
    if (!service) return;

    const report = service.reportError({ source: 'main', message: 'Queued before export' });
    const exportLogs = service.exportLogs();
    await Promise.all([report, exportLogs]);

    const [archiveName] = (await readdir(downloadsPath)).filter((name) => name.endsWith('.zip'));
    assert.ok(archiveName, 'the queued export creates an archive');
    const entries = readZipEntries(await readFile(join(downloadsPath, archiveName!)));
    assert.match(entries[0]!.contents.toString('utf8'), /Queued before export/,
      'the archive contains errors reported before its export request');
  });
});

test('support-log export rejects on archive failure so callers cannot treat a failed export as success', async () => {
  await withTempDirectory(async (directory) => {
    const userDataPath = join(directory, 'user-data');
    const downloadsPath = join(directory, 'not-a-directory');
    await writeFile(downloadsPath, 'block Downloads directory creation');
    const service = await createSupportLogService({ userDataPath, downloadsPath });
    assert.ok(service, 'support-log service is available');
    if (!service) return;

    await service.reportError({ source: 'renderer', message: 'Export failure fixture' });
    await assert.rejects(service.exportLogs(), 'an archive write failure is reported to the caller');
  });
});

test('typed support-log preload contract exposes only error reporting and ZIP export', async () => {
  assert.equal(typeof supportLogsPreloadApiFactory, 'function',
    'preload-api defines the typed support-log boundary');
  if (!supportLogsPreloadApiFactory) return;

  const reports: ErrorReport[] = [];
  let exportCalled = false;
  const api = supportLogsPreloadApiFactory({
    reportError: async (report) => { reports.push(report); },
    exportLogs: async () => { exportCalled = true; },
  });
  const report: ErrorReport = { source: 'renderer', message: 'UI error', stack: 'Error: UI error' };

  assert.deepEqual(Object.keys(api).sort(), ['exportLogs', 'reportError']);
  await api.reportError(report);
  await api.exportLogs();
  assert.deepEqual(reports, [report]);
  assert.equal(exportCalled, true);
});

test('sandboxed preload routes only narrow support-log calls over dedicated IPC channels', async () => {
  const exposed: Record<string, any> = {};
  const invocations: Array<{ channel: string; args: unknown[] }> = [];
  const ipcRenderer = {
    invoke: async (channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args });
      return undefined;
    },
  };

  vm.runInNewContext(preloadSource, {
    require: (specifier: string) => {
      assert.equal(specifier, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { exposed[name] = value; } },
        ipcRenderer,
      };
    },
  }, { filename: 'preload.mjs' });

  const api = exposed.prismataDesktop?.supportLogs as SupportLogsPreloadApi | undefined;
  assert.ok(api, 'preload exposes a supportLogs namespace');
  if (!api) return;
  assert.deepEqual(Object.keys(api).sort(), ['exportLogs', 'reportError']);
  const report: ErrorReport = { source: 'renderer', message: 'Renderer error' };
  await api.reportError(report);
  await api.exportLogs();
  assert.deepEqual(invocations.map(({ channel }) => channel), [
    'support-logs:report-error',
    'support-logs:export',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations[0]?.args)), [report]);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations[1]?.args)), []);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.(send|invoke)\s*\(\s*[^'"]/,
    'the preload does not expose arbitrary IPC channels');

  const longInputValue = 'relevant-private-user-text '.repeat(500);
  const untrustedReport = {
    source: 'renderer',
    message: 'Unable to save the whisper message.',
    stack: 'Error: save settings failed',
    context: {
      operation: 'joystick-whispers.save-settings',
      errorName: 'Error',
      errorCode: 'EACCES',
      appState: 'failure',
      inputField: 'whisper-message',
      inputValue: longInputValue,
      password: 'do-not-send-password',
      token: 'do-not-send-token',
      oauthCode: 'do-not-send-oauth-code',
      oauthState: 'do-not-send-oauth-state',
      verifier: 'do-not-send-verifier',
      pairingCode: 'do-not-send-pairing-code',
      credentials: 'do-not-send-credentials',
      deviceId: 'do-not-send-device-id',
      requestId: 'do-not-send-request-id',
      id: 'do-not-send-id',
      state: 'do-not-send-auth-state',
      arbitraryField: 'do-not-send-unknown-context',
      details: { privateText: 'do-not-send-nested-arbitrary-object' },
    },
    credentials: 'do-not-send-top-level-credentials',
    deviceId: 'do-not-send-top-level-device-id',
  } as ErrorReport;
  await api.reportError(untrustedReport);
  const ipcPayload = JSON.stringify(invocations[2]?.args);
  assert.deepEqual(JSON.parse(ipcPayload), [{
    source: 'renderer',
    message: 'Unable to save the whisper message.',
    stack: 'Error: save settings failed',
    context: {
      operation: 'joystick-whispers.save-settings',
      errorName: 'Error',
      errorCode: 'EACCES',
      appState: 'failure',
      inputField: 'whisper-message',
      inputValue: longInputValue.slice(0, 2_000),
    },
  }], 'the preload sanitizes renderer context before crossing into main-process IPC');
  assert.doesNotMatch(ipcPayload,
    /do-not-send-(?:password|token|oauth-code|oauth-state|verifier|pairing-code|credentials|device-id|request-id|id|auth-state|unknown-context|nested-arbitrary-object|top-level-credentials|top-level-device-id)/,
    'credentials, codes, identifiers, and unknown nested data never cross the IPC boundary');
});

test('main renderer-error IPC revalidates and projects structured context before support-log persistence', () => {
  const handler = mainSource.match(
    /handle\('support-logs:report-error',\s*async\s*\(event,\s*report\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/,
  )?.[1];
  assert.ok(handler, 'the renderer error IPC handler is registered');
  assert.match(handler!, /const context = sanitizeSupportLogContext\(report\.context\)/,
    'the main IPC handler validates renderer context through the main-process allowlist');
  assert.match(handler!, /\.\.\.\(context\s*\?\s*\{\s*context\s*\}\s*:\s*\{\}\)/,
    'only the projected context is forwarded to the support logger');
});

test('main captures uncaught exceptions and rejections as errors and wires only dedicated support-log IPC', () => {
  assert.ok(/process\.on\(\s*['"]uncaughtException['"]/.test(mainSource),
    'uncaught main-process exceptions are persisted');
  assert.ok(/process\.on\(\s*['"]unhandledRejection['"]/.test(mainSource),
    'unhandled main-process rejections are persisted');
  assert.ok(/support-logs:report-error/.test(mainSource),
    'renderer-reported errors use a dedicated IPC channel');
  assert.ok(/support-logs:export/.test(mainSource),
    'ZIP export uses a dedicated IPC channel');
  assert.ok(/app\.getPath\(\s*['"]downloads['"]\s*\)/.test(mainSource),
    'the export destination is Electron’s OS Downloads directory');
  assert.ok(/process\.on\(\s*['"]uncaughtException['"]\s*,\s*quitAfterMainError\s*\)/.test(mainSource));
  assert.ok(/process\.on\(\s*['"]unhandledRejection['"]\s*,\s*quitAfterMainError\s*\)/.test(mainSource));
  assert.ok(/function quitAfterMainError\(error\) \{[\s\S]*?process\.exitCode = 1;[\s\S]*?reportMainError\(error\)[\s\S]*?drainSupportLogWrites[\s\S]*?app\.quit\(\)/.test(mainSource),
    'fatal main-process errors are recorded and drained before a nonzero graceful quit');
  assert.ok(!/createJoystickEventLogger[\s\S]{0,500}exportLogs/.test(mainSource),
    'support-log export is not routed through the private Joystick event-envelope logger');
});

test('shell reports application errors and offers a bug-icon export beside Joystick with success only after export', () => {
  const page = renderShellPage('offline', 'Prismata');
  const controls = page.match(/<div class="empty-panel-controls">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(controls, 'the top-panel controls are rendered');
  assert.ok(/id="joystick-connect"/.test(controls!));
  assert.ok(/<button[^>]*(?:support-logs|error-logs)[^>]*>[\s\S]*?<svg[\s\S]*?<\/svg>[\s\S]*?<\/button>/.test(controls!),
    'a bug-icon button appears in the same top-panel controls opposite Joystick');
  assert.ok(/<button[^>]*aria-label="Download error logs"/.test(controls!),
    'the bug icon has an accessible action label');
  assert.ok(/\.empty-panel-controls\s*\{[^}]*justify-content:\s*space-between/.test(page),
    'the opposite controls are aligned to opposite sides of the top panel');

  const script = page.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? '';
  assert.ok(/addEventListener\(\s*['"]error['"]/.test(script),
    'uncaught renderer errors are reported');
  assert.ok(/addEventListener\(\s*['"]unhandledrejection['"]/.test(script),
    'unhandled renderer rejections are reported');
  assert.ok(/supportLogs\.reportError/.test(script),
    'caught and reported application errors reach the main-process log');
  assert.ok(/Logs downloaded to downloads folder/.test(script),
    'successful exports display the required exact toast');
  assert.ok(/await\s+[^;{}]*exportLogs\(\)[\s\S]{0,300}Logs downloaded to downloads folder/.test(script),
    'the success toast is shown only after the export promise resolves');
  assert.ok(/catch\s*\([^)]*\)\s*\{[^}]*showError/.test(script),
    'an export failure follows the error path instead of showing success');
});

test('top-panel export control shares the Joystick frame styling while retaining its own icon treatment', () => {
  const page = renderShellPage('offline', 'Prismata');
  const joystickStyle = buttonCssStyle(page, 'joystick-connect-button');
  const exportStyle = buttonCssStyle(page, 'support-log-button');
  const sharedFrameProperties = [
    'width', 'height', 'min-height', 'padding', 'border', 'border-radius', 'background', 'color',
  ];

  assert.deepEqual(
    Object.fromEntries(sharedFrameProperties.map((property) => [property, exportStyle[property]])),
    Object.fromEntries(sharedFrameProperties.map((property) => [property, joystickStyle[property]])),
    'the export and Joystick buttons share dimensions, border, radius, background, and foreground styling',
  );

  assert.equal(joystickStyle['flex-direction'], 'column',
    'Joystick retains its content-specific column layout');
  assert.match(page, /id="panel-live-indicator"[^>]*>LIVE<\/span>/,
    'Joystick retains its separate LIVE indicator');
  assert.equal(buttonCssStyle(page, 'joystick-logo').width, '2.9rem',
    'the Joystick logo keeps its own sizing');
  assert.equal(buttonCssStyle(page, 'joystick-logo').height, '2.9rem');
  assert.match(page, /id="support-logs-export"[^>]*>[\s\S]*?<svg/,
    'the export button retains its independent SVG icon');
  assert.match(page, /\.support-log-button svg\s*\{[^}]*width:\s*2\.1rem;[^}]*height:\s*2\.1rem/,
    'the export SVG keeps sizing separate from the Joystick logo');
});

test('top-panel export control does not add a unique hover treatment absent from Joystick', () => {
  const page = renderShellPage('offline', 'Prismata');
  const joystickHoverStyle = buttonCssStyle(page, 'joystick-connect-button', true);
  const exportHoverStyle = buttonCssStyle(page, 'support-log-button', true);

  assert.equal(exportHoverStyle.background, joystickHoverStyle.background,
    'hovering the export control does not change its background differently from Joystick');
});

test('clicking the top-panel bug button exports logs and shows the exact success toast', async () => {
  let exportCount = 0;
  const harness = createShellHarness(async () => { exportCount += 1; });
  assert.equal(exportCount, 0, 'rendering the shell does not start an export');
  assert.equal(typeof harness.button.onclick, 'function', 'the export control has a click action');
  await harness.button.onclick?.();

  assert.equal(exportCount, 1, 'click starts one support-log ZIP export');
  assert.ok([...harness.elements.values()].some((element) =>
    element.textContent === 'Logs downloaded to downloads folder'),
  'successful export displays the exact required toast');
});

test('failed top-panel export never displays the success toast', async () => {
  const harness = createShellHarness(async () => { throw new Error('archive write failed'); });
  assert.equal(typeof harness.button.onclick, 'function', 'the export control has a click action');
  await harness.button.onclick?.();

  assert.equal([...harness.elements.values()].some((element) =>
    element.textContent === 'Logs downloaded to downloads folder'), false,
  'an archive failure does not display success');
  assert.equal(harness.elements.get('desktop-error')?.hidden, false,
    'an archive failure is surfaced through the existing error alert');
  assert.equal(harness.elements.get('desktop-error-message')?.textContent, 'archive write failed');
});

test('caught TODO save failure reports static operation, safe app state, and only the relevant allowlisted input', async () => {
  const reports: ErrorReport[] = [];
  const unrelatedViewer = 'do-not-log-unrelated-viewer-identifier';
  const relevantNote = 'Private note text needed to diagnose this save failure.';
  const harness = createShellHarness(async () => {}, {
    reportError: async (report) => { reports.push(report); },
    addTodo: async () => { throw new Error('simulated TODO storage failure'); },
  });
  harness.element('todo-item-name').value = 'Weekly planning';
  harness.element('todo-viewer').value = unrelatedViewer;
  harness.element('todo-note').value = relevantNote;

  await harness.element('todo-add').onclick?.();

  assert.equal(reports.length, 1, 'the caught TODO save failure is reported once');
  const report = JSON.parse(JSON.stringify(reports[0])) as ErrorReport;
  assert.deepEqual(report.context, {
    operation: 'todos.save',
    appState: 'signed-out',
    inputField: 'todo-note',
    inputValue: relevantNote,
  }, 'the failure report carries a static operation, safe app state, and only the relevant allowlisted user value');
  assert.doesNotMatch(JSON.stringify(report), /do-not-log-unrelated-viewer-identifier/,
    'unrelated TODO form values are excluded from the failure report');
});

test('caught whisper-template save failure reports only the edited template and safe auth state', async () => {
  const reports: ErrorReport[] = [];
  const selectedTemplate = 'Selected template text for diagnosing this save failure.';
  const unrelatedTemplate = 'UNRELATED-EXISTING-TEMPLATE-SENTINEL';
  const harness = createShellHarness(async () => {}, {
    reportError: async (report) => { reports.push(report); },
    updateWhisperSettings: async () => { throw new Error('simulated whisper settings failure'); },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const editedField = harness.element('whisper-followed-message');
  editedField.value = selectedTemplate;
  harness.element('whisper-subscribed-message').value = unrelatedTemplate;

  editedField.onchange?.({ currentTarget: editedField });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(reports.length, 1, 'the caught whisper-template save failure is reported once');
  const report = JSON.parse(JSON.stringify(reports[0])) as ErrorReport;
  assert.deepEqual(report.context, {
    operation: 'joystick-whispers.save-settings',
    appState: 'signed-out',
    inputField: 'whisper-message',
    inputValue: selectedTemplate,
  }, 'the report names the save operation and contains only the edited allowlisted template');
  assert.doesNotMatch(JSON.stringify(report), /UNRELATED-EXISTING-TEMPLATE-SENTINEL/,
    'other saved templates are not dumped into the error report');
});

test('caught reminder save failure reports only static operation and safe app state', async () => {
  const reports: ErrorReport[] = [];
  const selectedMessage = 'Selected reminder text for diagnosing this save failure.';
  const harness = createShellHarness(async () => {}, {
    reportError: async (report) => { reports.push(report); },
    createReminder: async () => { throw new Error('simulated reminder storage failure'); },
  });

  await harness.element('reminder-add').onclick?.();
  const messageField = harness.createdElements.find((element) => element.id === 'reminder-message-0');
  assert.ok(messageField, 'opening the reminder editor creates its custom-message field');
  messageField!.value = selectedMessage;
  harness.element('reminder-message-list').querySelectorAll = () => [messageField!];
  messageField!.onchange?.({ currentTarget: messageField! });
  await harness.element('reminder-save').onclick?.();

  assert.equal(reports.length, 1, 'the caught reminder save failure is reported once');
  const report = JSON.parse(JSON.stringify(reports[0])) as ErrorReport;
  assert.deepEqual(report.context, {
    operation: 'reminders.save',
    appState: 'signed-out',
    inputField: 'reminder-message',
    inputValue: selectedMessage,
  }, 'the report includes only the selected custom message and safe app state, without record identifiers');
});

test('caught sign-in failure reports the operation and safe auth state without authentication material', async () => {
  const reports: ErrorReport[] = [];
  const harness = createShellHarness(async () => {}, {
    reportError: async (report) => { reports.push(report); },
    signInWithJoystick: async () => { throw new Error('simulated sign-in failure'); },
  });

  await harness.element('joystick-connect').onclick?.();

  assert.equal(reports.length, 1, 'the caught sign-in failure is reported once');
  const report = JSON.parse(JSON.stringify(reports[0])) as ErrorReport;
  assert.deepEqual(report.context, {
    operation: 'auth.sign-in',
    appState: 'signed-out',
  }, 'operation-only auth failures carry only a static operation and safe state');
  assert.doesNotMatch(JSON.stringify(report), /(?:oauth|auth)(?:Code|State)|verifier|token|pairing.?code/i,
    'auth codes, state, verifiers, tokens, and pairing codes are not included as context');
});

test('caught Drop-in automation save failure reports only the edited public message and safe auth state', async () => {
  const reports: ErrorReport[] = [];
  const selectedMessage = 'Selected public Drop-in message for diagnosis.';
  const harness = createShellHarness(async () => {}, {
    reportError: async (report) => { reports.push(report); },
    updateChatAutomationSettings: async () => { throw new Error('simulated automation settings failure'); },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const editedField = harness.createdElements.find((element) => element.id === 'drop-in-chat-message-0');
  assert.ok(editedField, 'the Drop-in settings render their first message field');
  editedField!.value = selectedMessage;
  harness.element('drop-in-message-list').querySelectorAll = () => [editedField!];
  harness.element('slash-command-prefix').value = 'UNRELATED-SLASH-PREFIX-SENTINEL';

  editedField!.onchange?.({ currentTarget: editedField! });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(reports.length, 1, 'the caught automation save failure is reported once');
  const report = JSON.parse(JSON.stringify(reports[0])) as ErrorReport;
  assert.deepEqual(report.context, {
    operation: 'joystick-chat-automations.save-drop-in',
    appState: 'signed-out',
    inputField: 'drop-in-message',
    inputValue: selectedMessage,
  }, 'the report contains only the edited allowlisted automation message');
  assert.doesNotMatch(JSON.stringify(report), /UNRELATED-SLASH-PREFIX-SENTINEL/,
    'unrelated automation settings are not dumped into the report');
});

test('failed direct-message sends log a static error instead of a server response that may echo message text', async () => {
  const reports: ErrorReport[] = [];
  const directMessageText = 'PRIVATE-DIRECT-MESSAGE-SENTINEL';
  const harness = createShellHarness(async () => {}, {
    reportError: async (report) => { reports.push(report); },
    sendDirectMessage: async () => { throw new Error(`Request rejected for message: ${directMessageText}`); },
  });
  harness.element('direct-message-input').value = directMessageText;

  await harness.element('direct-message-send').onclick?.();

  assert.equal(reports.length, 1, 'the caught send failure remains diagnosable');
  assert.equal(reports[0]?.message, 'Unable to send direct message.',
    'only a static safe failure is included in support logs');
  assert.doesNotMatch(JSON.stringify(reports[0]), /PRIVATE-DIRECT-MESSAGE-SENTINEL/,
    'direct-message text is not included in the support-log report');
  assert.match(harness.element('desktop-error-message').textContent, /PRIVATE-DIRECT-MESSAGE-SENTINEL/,
    'the full error remains available to the user in the UI');
});
