import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { resolvePackagedEsbuildBinary } from './esbuild-runtime.mjs';

if (app.isPackaged) {
  try {
    const runtimeConfig = JSON.parse(readFileSync(join(process.resourcesPath, 'prismata-runtime-config.json'), 'utf8'));
    for (const key of ['JOYSTICK_CLIENT_ID', 'JOYSTICK_SCOPES', 'JOYSTICK_PROFILE_ENDPOINT']) {
      if (typeof runtimeConfig[key] === 'string' && !process.env[key]) {
        process.env[key] = runtimeConfig[key];
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const esbuildPath = resolvePackagedEsbuildBinary(import.meta.url);
  process.env.ESBUILD_BINARY_PATH = esbuildPath.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
}
await import('tsx/esm');

let supportLogService;
const pendingSupportLogWrites = new Set();

function persistSupportError(report) {
  if (!supportLogService) return Promise.resolve();
  const pending = supportLogService.reportError(report);
  pendingSupportLogWrites.add(pending);
  void pending.then(
    () => pendingSupportLogWrites.delete(pending),
    () => pendingSupportLogWrites.delete(pending),
  );
  return pending;
}

function reportMainError(error) {
  try {
    const isError = error instanceof Error;
    const message = isError ? error.message : typeof error === 'string' ? error : 'Unhandled non-Error rejection';
    return persistSupportError({
      source: 'main',
      message,
      ...(isError && error.stack ? { stack: error.stack } : {}),
    });
  } catch {
    return Promise.resolve();
  }
}

async function drainSupportLogWrites() {
  while (pendingSupportLogWrites.size > 0) {
    await Promise.allSettled([...pendingSupportLogWrites]);
  }
}

const { createSupportLogService, sanitizeSupportLogContext } = await import('../src/support-log.ts');
supportLogService = createSupportLogService({
  userDataPath: app.getPath('userData'),
  downloadsPath: app.getPath('downloads'),
});

function quitAfterMainError(error) {
  process.exitCode = 1;
  void reportMainError(error)
    .catch(() => {})
    .then(drainSupportLogWrites)
    .then(() => app.quit());
}

process.on('uncaughtException', quitAfterMainError);
process.on('unhandledRejection', quitAfterMainError);

function developmentLog(method, ...args) {
  if (method === 'error') void reportMainError(args[0]).catch(() => {});
  if (app.isPackaged) return;
  console[method](...args);
}

function traceStartup(marker) {
  if (process.env.PRISMATA_ELECTRON_STARTUP_TRACE === '1') {
    developmentLog('log', `[startup] ${marker}`);
  }
}

traceStartup('main-entry');

const [
  { appName },
  { desktopOAuthRedirectUri },
  { startDesktopApp },
  { createDesktopLifecycle },
  { parseJoystickTodoEvent, parseJoystickTipHistoryEvent },
  { createDesktopAuthCoordinator },
  { createElectronCredentialStore },
  { createLoopbackCallbackServer },
  { createDesktopJoystickBackend },
  { createDesktopShellContract, createBrowserWindowOptions, createDesktopLifecycleManager, getReminderSettings, getReminderRecords, requireReminderLifecycle, validateTodoInput, validateTodoId },
  { createFlipACoinScheduler },
  { createAuthenticatedJoystickChatSender, createJoystickChatClient, createJoystickChatCooldown, createJoystickChatEventHandler },
  { createJoystickChatFeed },
  { createDirectMessageSender },
  { normalizeReminderSettings },
  { renderShellPage },
  { createJoystickActionCableGateway },
  { createJoystickWhisperClient },
  { createJoystickWhisperRuntime },
  { createJoystickEventLogger },
] = await Promise.all([
  import('@prismata/core'),
  import('../src/auth-flow.ts'),
  import('../src/main.ts'),
  import('../src/desktop-lifecycle.ts'),
  import('../src/desktop-service.ts'),
  import('../src/auth-coordinator.ts'),
  import('./credential-store.ts'),
  import('./loopback.ts'),
  import('../src/joystick-oauth.ts'),
  import('./main.ts'),
  import('../src/flip-a-coin-scheduler.ts'),
  import('../src/joystick-chat.ts'),
  import('../src/joystick-chat-feed.ts'),
  import('../src/direct-message.ts'),
  import('../src/reminder-settings.ts'),
  import('./shell-page.ts'),
  import('../src/joystick-gateway.ts'),
  import('../src/joystick-whispers.ts'),
  import('./joystick-whisper-runtime.ts'),
  import('../src/joystick-event-log.ts'),
]);

traceStartup('ts-imports-loaded');

const contract = createDesktopShellContract({
  appName,
  oauthRedirectUri: desktopOAuthRedirectUri,
});

if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland') {
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

let activeLifecycle;
const lifecycleManager = createDesktopLifecycleManager(async () => createDesktopLifecycle({
  dataFile: `${app.getPath('userData')}/prismata.state.sqlite`,
  lanHost: process.env.PRISMATA_LAN_HOST,
}));
let activeAuth;
let activeWindow;
let activeJoystickWhisperRuntime;
let removeJoystickWhisperStatusListener;
let removeTodoListChangedListener;
let removeTipHistoryChangedListener;
let joystickEventLogger;
let joystickEventPruneTimer;
let runtimeShutdownPromise;
let ipcWired = false;
let lifecycleReady = Promise.resolve();
const authStateListeners = new Set();
const registeredIpcHandlers = new Set();
const getJoystickStreamState = () => activeJoystickWhisperRuntime?.getStatus().stream.state ?? 'unknown';
const joystickChatCooldown = createJoystickChatCooldown();
const joystickChatFeed = createJoystickChatFeed();
const addSentJoystickChatMessage = (text, response) => joystickChatFeed.onMessageSent(text, response);
async function sendDropInChatMessage(accessToken, text) {
  const session = activeAuth?.getSession();
  if (!session || session.accessToken !== accessToken || !session.grantedPermissions.includes('chat:write')) {
    throw new Error('Public chat permission is unavailable');
  }
  const client = createJoystickChatClient({ accessToken, getStreamState: getJoystickStreamState, onDiagnostic: joystickTrafficDiagnostic });
  // These messages are explicitly configured per Drop-in event, so do not apply
  // the generic identical-message cooldown used by scheduled chat sends.
  const response = await client.sendMessage({ text });
  addSentJoystickChatMessage(text, response);
  return response;
}
joystickChatFeed.onListChanged((messages) => {
  activeWindow?.webContents.send('joystick-chat:listChanged', messages);
});
const joystickTrafficDiagnostic = (event) => {
  developmentLog('debug', '[Joystick traffic]', event);
};

function notifyAuthStateListeners() {
  for (const listener of authStateListeners) listener();
}

function shutdownRuntime() {
  if (runtimeShutdownPromise) return runtimeShutdownPromise;

  flipACoinScheduler.stop();
  const runtime = activeJoystickWhisperRuntime;
  const auth = activeAuth;
  activeJoystickWhisperRuntime = undefined;
  activeAuth = undefined;

  runtimeShutdownPromise = Promise.all([
    runtime?.shutdown().catch(() => undefined),
    lifecycleManager.stop().catch(() => undefined),
    auth?.close().catch(() => undefined),
  ]).then(() => {
    activeLifecycle = undefined;
    removeJoystickWhisperStatusListener?.();
    removeJoystickWhisperStatusListener = undefined;
    removeTodoListChangedListener?.();
    removeTodoListChangedListener = undefined;
    removeTipHistoryChangedListener?.();
    removeTipHistoryChangedListener = undefined;
  });

  return runtimeShutdownPromise;
}

const flipACoinScheduler = createFlipACoinScheduler({
  getSettings: async () => (await activeLifecycle?.getSettings())?.settings ?? {},
  // Joystick's REST API targets the authenticated channel; it does not accept
  // a chat name. The scheduler therefore carries only the message text.
  send: createAuthenticatedJoystickChatSender({
    getAccessToken: () => activeAuth?.getSession()?.accessToken,
    getStreamState: getJoystickStreamState,
    cooldown: joystickChatCooldown,
    onMessageSent: addSentJoystickChatMessage,
    onDiagnostic: joystickTrafficDiagnostic,
    log: (message) => developmentLog('warn', `[Joystick] ${message}`),
  }),
});
const testReminderScheduler = createFlipACoinScheduler({
  send: createAuthenticatedJoystickChatSender({
    getAccessToken: () => activeAuth?.getSession()?.accessToken,
    getStreamState: getJoystickStreamState,
    cooldown: joystickChatCooldown,
    onMessageSent: addSentJoystickChatMessage,
    onDiagnostic: joystickTrafficDiagnostic,
    log: (message) => developmentLog('warn', `[Joystick] ${message}`),
    throwIfUnavailable: true,
    throwOnError: true,
  }),
});

function wireIpc() {
  if (ipcWired) return;
  ipcWired = true;
  const handle = (channel, listener) => {
    ipcMain.handle(channel, listener);
    registeredIpcHandlers.add(channel);
  };
  handle('desktop:getStatus', () => activeLifecycle.getStatus());
  handle('desktop:setLanEnabled', (_event, enabled) => enabled ? activeLifecycle.enableLan() : activeLifecycle.disableLan().then(() => activeLifecycle.getStatus()));
  ipcMain.handle('desktop:listNetworkInterfaces', () => activeLifecycle.listNetworkInterfaces());
  registeredIpcHandlers.add('desktop:listNetworkInterfaces');
  handle('desktop:setAdvertisedAddress', (_event, address) => activeLifecycle.setAdvertisedAddress(address));
  handle('desktop:retryAdvertising', () => activeLifecycle.retryAdvertising());
  handle('desktop:listDevices', () => activeLifecycle.listDevices());
  handle('desktop:revokeDevice', (_event, deviceId) => activeLifecycle.revokeDevice(deviceId).then(() => undefined));
  handle('desktop:listConnectionRequests', () => activeLifecycle.listConnectionRequests());
  handle('desktop:approveConnectionRequest', (_event, requestId, code) => activeLifecycle.approveConnectionRequest(requestId, code));
  handle('todos:list', async () => {
    await lifecycleReady;
    return activeLifecycle.listTodos();
  });
  handle('todos:add', async (_event, input) => {
    await lifecycleReady;
    return activeLifecycle.addTodo(validateTodoInput(input));
  });
  handle('todos:update', async (_event, id, input) => {
    await lifecycleReady;
    if (!await activeLifecycle.updateTodo(validateTodoId(id), validateTodoInput(input))) throw new Error('TODO not found, not editable, or already completed');
  });
  handle('todos:complete', async (_event, id) => {
    await lifecycleReady;
    if (!await activeLifecycle.completeTodo(validateTodoId(id))) throw new Error('TODO not found or already completed');
  });
  handle('todos:undo-complete', async (_event, id) => {
    await lifecycleReady;
    if (!await activeLifecycle.undoCompleteTodo(validateTodoId(id))) throw new Error('TODO undo window expired or item is not completed');
  });
  handle('todos:remove', async (_event, id) => {
    await lifecycleReady;
    if (!await activeLifecycle.removeTodo(validateTodoId(id))) throw new Error('TODO not found or countdown expired');
  });
  handle('tip-history:list', async () => {
    await lifecycleReady;
    return activeLifecycle.listTipHistory();
  });
  handle('joystick-chat:list', () => joystickChatFeed.list());
  handle('auth:getSnapshot', () => activeAuth.getSnapshot());
  handle('auth:signInWithJoystick', async () => {
    await activeAuth.signInWithJoystick();
  });
  ipcMain.handle('auth:cancel', () => activeAuth.cancel());
  registeredIpcHandlers.add('auth:cancel');
  handle('auth:signOut', async () => {
    try {
      await activeAuth.signOut();
    } catch (error) {
      void reportMainError(error).catch(() => {});
      if (!activeAuth?.getSession()) notifyAuthStateListeners();
      throw error;
    }
  });
  handle('support-logs:report-error', async (event, report) => {
    if (event.sender !== activeWindow?.webContents) throw new Error('Support logs are unavailable to this renderer');
    if (!report || typeof report !== 'object' || Array.isArray(report) || typeof report.message !== 'string') {
      throw new Error('Invalid renderer error report');
    }
    const context = sanitizeSupportLogContext(report.context);
    await persistSupportError({
      source: 'renderer',
      message: report.message,
      ...(typeof report.stack === 'string' ? { stack: report.stack } : {}),
      ...(context ? { context } : {}),
    });
  });
  handle('support-logs:export', (event) => {
    if (event.sender !== activeWindow?.webContents) throw new Error('Support logs are unavailable to this renderer');
    return supportLogService.exportLogs();
  });
  ipcMain.handle('reminder:get', async () => getReminderSettings(await activeLifecycle?.getSettings()));
  registeredIpcHandlers.add('reminder:get');
  ipcMain.handle('reminder:update', async (_event, settings) => {
    const lifecycle = requireReminderLifecycle(activeLifecycle);
    const current = await lifecycle.getSettings();
    const reminder = normalizeReminderSettings(settings);
    const records = getReminderRecords(current);
    const next = records.length ? records.map((record, index) => index === 0 ? { ...record, ...reminder } : record) : [{ id: 'legacy-reminder', ...reminder }];
    const saved = await lifecycle.saveSettings({ ...current.settings, reminders: next, reminder: next[0] });
    return normalizeReminderSettings(saved.settings.reminder);
  });
  registeredIpcHandlers.add('reminder:update');
  ipcMain.handle('reminder:test', async (_event, settings) => {
    await testReminderScheduler.testNow(normalizeReminderSettings(settings));
    return { ok: true };
  });
  registeredIpcHandlers.add('reminder:test');
  handle('reminder:list', async () => getReminderRecords(await activeLifecycle?.getSettings()));
  handle('reminder:create', async (_event, settings) => {
    const lifecycle = requireReminderLifecycle(activeLifecycle);
    const current = await lifecycle.getSettings();
    const records = getReminderRecords(current);
    const record = { id: randomUUID(), ...normalizeReminderSettings(settings) };
    const saved = await lifecycle.saveSettings({ ...current.settings, reminders: [...records, record], reminder: record });
    return getReminderRecords(saved).find((item) => item.id === record.id);
  });
  handle('reminder:update-record', async (_event, id, settings) => {
    const lifecycle = requireReminderLifecycle(activeLifecycle);
    const current = await lifecycle.getSettings();
    const records = getReminderRecords(current);
    if (!records.some((record) => record.id === id)) throw new Error('Reminder not found');
    const next = records.map((record) => record.id === id ? { id, ...normalizeReminderSettings(settings) } : record);
    const saved = await lifecycle.saveSettings({ ...current.settings, reminders: next, reminder: next[0] });
    return getReminderRecords(saved).find((record) => record.id === id);
  });
  handle('reminder:remove', async (_event, id) => {
    const lifecycle = requireReminderLifecycle(activeLifecycle);
    const current = await lifecycle.getSettings();
    const records = getReminderRecords(current);
    const next = records.filter((record) => record.id !== id);
    if (next.length === records.length) throw new Error('Reminder not found');
    await lifecycle.saveSettings({ ...current.settings, reminders: next, ...(next[0] ? { reminder: next[0] } : {}) });
  });
  handle('reminder:test-record', async (_event, id) => {
    const records = getReminderRecords(await activeLifecycle?.getSettings());
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error('Reminder not found');
    await testReminderScheduler.testNow(record);
    return { ok: true };
  });
  ipcMain.handle('direct-message:send', async (_event, text) => {
    await createDirectMessageSender({
      getAccessToken: () => activeAuth?.getSession()?.accessToken,
      getStreamState: getJoystickStreamState,
      onMessageSent: addSentJoystickChatMessage,
      onDiagnostic: joystickTrafficDiagnostic,
    })(text);
    return { ok: true };
  });
  registeredIpcHandlers.add('direct-message:send');
  handle('joystick-whispers:get-settings', () => activeJoystickWhisperRuntime.getSettings());
  handle('joystick-whispers:update-settings', (_event, settings) => activeJoystickWhisperRuntime.updateSettings(settings));
  handle('joystick-whispers:get-status', () => activeJoystickWhisperRuntime.getStatus());
  handle('joystick-chat-automations:get-settings', () => activeJoystickWhisperRuntime.getChatAutomationSettings());
  handle('joystick-chat-automations:update-settings', (_event, settings) => activeJoystickWhisperRuntime.updateChatAutomationSettings(settings));
}

async function createWindow() {
  if (runtimeShutdownPromise) {
    await runtimeShutdownPromise;
    runtimeShutdownPromise = undefined;
  }
  await activeJoystickWhisperRuntime?.shutdown();
  activeJoystickWhisperRuntime = undefined;
  await activeAuth?.close();
  activeAuth = undefined;
  activeLifecycle = await lifecycleManager.create();
  let resolveLifecycleReady;
  let rejectLifecycleReady;
  lifecycleReady = new Promise((resolve, reject) => {
    resolveLifecycleReady = resolve;
    rejectLifecycleReady = reject;
  });
  // Keep startup failures observable by IPC callers without an unhandled rejection
  // when the renderer has not issued a TODO request yet.
  void lifecycleReady.catch(() => {});
  activeAuth = createDesktopAuthCoordinator({
    backend: createDesktopJoystickBackend({
      clientId: process.env.JOYSTICK_CLIENT_ID ?? '',
      redirectUri: desktopOAuthRedirectUri,
      onDiagnostic: joystickTrafficDiagnostic,
    }),
    browser: (url) => shell.openExternal(url),
    store: createElectronCredentialStore(),
    createCallbackServer: createLoopbackCallbackServer,
    onStateChanged: (snapshot) => {
      activeWindow?.webContents.send('auth:stateChanged', snapshot);
      notifyAuthStateListeners();
    },
  });
  activeJoystickWhisperRuntime = createJoystickWhisperRuntime({
    desktopSettings: {
      getSettings: () => activeLifecycle.getSettings(),
      saveSettings: (settings) => activeLifecycle.saveSettings(settings),
    },
    auth: {
      getSession: () => activeAuth?.getSession() ?? null,
      onStateChanged: (listener) => {
        authStateListeners.add(listener);
        return () => authStateListeners.delete(listener);
      },
    },
    todoEventHandler: async (event) => {
      const parsed = parseJoystickTodoEvent(event);
      if (parsed) await activeLifecycle.addTodoFromJoystickEvent(parsed);
      const parsedHistory = parseJoystickTipHistoryEvent(event);
      if (parsedHistory) await activeLifecycle.addTipHistoryFromJoystickEvent(parsedHistory);
    },
    createGateway: (gatewayInput) => createJoystickActionCableGateway({
      ...gatewayInput,
      onEvent: createJoystickChatEventHandler(joystickChatCooldown, async (event) => {
        joystickChatFeed.onGatewayEvent(event);
        await gatewayInput.onEvent(event);
      }),
      onDiagnostic: joystickTrafficDiagnostic,
      onEventEnvelope: (event) => joystickEventLogger.write(event),
    }),
    attemptStore: {
      claimWhisperAttempt: (attempt) => activeLifecycle.claimWhisperAttempt(attempt),
      pruneWhisperAttempts: (now) => activeLifecycle.pruneWhisperAttempts(now),
    },
    sendWhisper: (accessToken, whisper) => createJoystickWhisperClient({
      accessToken,
      getStreamState: getJoystickStreamState,
      onDiagnostic: joystickTrafficDiagnostic,
    }).sendWhisper(whisper),
    logError: (message, diagnostic) => developmentLog('error', message, diagnostic),
    sendPublicChat: sendDropInChatMessage,
    fetchImpl: (url, init) => fetch(url, init),
  });
  removeJoystickWhisperStatusListener = activeJoystickWhisperRuntime.onStatusChanged((status) => {
    activeWindow?.webContents.send('joystick-whispers:status-changed', status);
  });
  wireIpc();
  const window = new BrowserWindow({ ...createBrowserWindowOptions(contract.preloadEntry), title: contract.windowTitle });
  activeWindow = window;
  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !input.control || !input.shift || input.alt || input.meta || input.key.toLowerCase() !== 'i') return;
      event.preventDefault();
      window.webContents.toggleDevTools();
    });
  }
  removeTodoListChangedListener = activeLifecycle.onTodoListChanged((todos) => {
    activeWindow?.webContents.send('todos:listChanged', todos);
  });
  removeTipHistoryChangedListener = activeLifecycle.onTipHistoryChanged((history) => {
    activeWindow?.webContents.send('tip-history:listChanged', history);
  });
  window.on('closed', () => {
    if (activeWindow === window) {
      activeWindow = undefined;
      removeJoystickWhisperStatusListener?.();
      removeJoystickWhisperStatusListener = undefined;
      removeTodoListChangedListener?.();
      removeTodoListChangedListener = undefined;
      removeTipHistoryChangedListener?.();
      removeTipHistoryChangedListener = undefined;
      // macOS keeps the app alive when its last window closes. Stop the
      // background runtime there; on Windows/Linux, before-quit owns teardown.
      if (process.platform === 'darwin') void shutdownRuntime();
    }
  });

  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(renderShellPage('starting desktop shell', contract.windowTitle))}`,
  );

  const status = await startDesktopApp();
  try {
    await activeLifecycle.start();
    resolveLifecycleReady();
  } catch (error) {
    void reportMainError(error).catch(() => {});
    rejectLifecycleReady(error);
    throw error;
  }
  await activeJoystickWhisperRuntime.start();
  flipACoinScheduler.start();
  void activeAuth.restoreOnStartup();
  const page = renderShellPage(status, contract.windowTitle);

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
}

app.whenReady().then(async () => {
  traceStartup('app-ready');
  Menu.setApplicationMenu(null);

  joystickEventLogger = createJoystickEventLogger({
    userDataPath: app.getPath('userData'),
    isDevelopment: !app.isPackaged,
  });
  await joystickEventLogger.start();
  developmentLog('log', joystickEventLogger.getCurrentLogFilePath());
  joystickEventPruneTimer = setInterval(() => { void joystickEventLogger.pruneExpired(); }, 24 * 60 * 60 * 1000);
  joystickEventPruneTimer.unref?.();

  if (process.env.PRISMATA_ELECTRON_SMOKE_TEST === '1') {
    process.exit(0);
    return;
  }

  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
}).catch((error) => {
  developmentLog('error', error);
  void drainSupportLogWrites().then(() => process.exit(1));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  if (joystickEventPruneTimer) clearInterval(joystickEventPruneTimer);
  void shutdownRuntime().then(async () => {
    await drainSupportLogWrites();
    try {
      await joystickEventLogger?.flush();
    } catch {
      // Diagnostic writes must never prevent the app from quitting.
    }
    removeJoystickWhisperStatusListener?.();
    removeJoystickWhisperStatusListener = undefined;
    removeTodoListChangedListener?.();
    removeTodoListChangedListener = undefined;
    for (const channel of registeredIpcHandlers) ipcMain.removeHandler(channel);
    registeredIpcHandlers.clear();
    ipcWired = false;
    app.quit();
  }).catch(() => app.quit());
});
