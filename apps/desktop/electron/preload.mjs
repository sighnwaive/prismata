const { contextBridge, ipcRenderer } = require('electron');

const supportLogInputFieldsByOperation = {
  'auth.sign-in': [],
  'auth.sign-out': [],
  'admin.set-lan-enabled': [],
  'admin.set-advertised-address': [],
  'joystick-whispers.save-settings': ['whisper-message'],
  'joystick-chat-automations.save-drop-in': ['drop-in-message'],
  'joystick-chat-automations.save-slash-command': ['slash-command-response'],
  'todos.save': ['todo-note'],
  'reminders.save': ['reminder-message'],
};
const supportLogAppStates = new Set([
  'offline', 'signed-out', 'opening-browser', 'waiting-for-callback',
  'authenticated', 'failure', 'enabled', 'disabled',
]);
function redactSupportLogSecrets(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(authorization|authorization[_-]?(?:code|state)|access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|password|oauth[_-]?(?:code|state)|auth[_-]?(?:code|state)|pairing[_-]?code|code[_-]?verifier|verifier|credentials?|code|state)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|password|oauth[_-]?code|oauth[_-]?state|auth[_-]?code|auth[_-]?state|pairing[_-]?code|code[_-]?verifier|verifier|credentials?|code|state)=)[^&#\s]*/gi, '$1[REDACTED]');
}
function sanitizeSupportLogContext(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || typeof input.operation !== 'string'
      || !Object.prototype.hasOwnProperty.call(supportLogInputFieldsByOperation, input.operation)) return undefined;
    const context = { operation: input.operation };
    const errorName = typeof input.errorName === 'string'
      ? redactSupportLogSecrets(input.errorName.slice(0, 128)).slice(0, 64)
      : '';
    const errorCode = typeof input.errorCode === 'string'
      ? redactSupportLogSecrets(input.errorCode.slice(0, 128)).slice(0, 64)
      : '';
    if (/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(errorName)) context.errorName = errorName;
    if (/^[A-Za-z0-9_.-]{1,64}$/.test(errorCode)) context.errorCode = errorCode;
    if (supportLogAppStates.has(input.appState)) context.appState = input.appState;
    const fields = supportLogInputFieldsByOperation[input.operation];
    if (fields.includes(input.inputField) && typeof input.inputValue === 'string') {
      context.inputField = input.inputField;
      context.inputValue = redactSupportLogSecrets(input.inputValue.slice(0, 4_000)).slice(0, 2_000);
    }
    return context;
  } catch {
    return undefined;
  }
}
function sanitizeSupportLogReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { source: 'renderer', message: 'Renderer application error' };
  }
  const safeReport = {
    source: 'renderer',
    message: typeof report.message === 'string' ? report.message : 'Renderer application error',
  };
  if (typeof report.stack === 'string') safeReport.stack = report.stack;
  const context = sanitizeSupportLogContext(report.context);
  if (context) safeReport.context = context;
  return safeReport;
}

contextBridge.exposeInMainWorld('prismataDesktop', {
  auth: {
    getSnapshot: () => ipcRenderer.invoke('auth:getSnapshot'),
    signInWithJoystick: () => ipcRenderer.invoke('auth:signInWithJoystick'),
    cancel: () => ipcRenderer.invoke('auth:cancel'),
    signOut: () => ipcRenderer.invoke('auth:signOut'),
    onStateChanged: (listener) => {
      const handler = (_event, snapshot) => listener(snapshot);
      ipcRenderer.on('auth:stateChanged', handler);
      return () => ipcRenderer.removeListener('auth:stateChanged', handler);
    },
  },
  admin: {
    getStatus: () => ipcRenderer.invoke('desktop:getStatus'),
    setLanEnabled: (enabled) => ipcRenderer.invoke('desktop:setLanEnabled', enabled),
    listNetworkInterfaces: () => ipcRenderer.invoke('desktop:listNetworkInterfaces'),
    setAdvertisedAddress: (address) => ipcRenderer.invoke('desktop:setAdvertisedAddress', address),
    retryAdvertising: () => ipcRenderer.invoke('desktop:retryAdvertising'),
    listDevices: () => ipcRenderer.invoke('desktop:listDevices'),
    revokeDevice: (deviceId) => ipcRenderer.invoke('desktop:revokeDevice', deviceId),
    listConnectionRequests: () => ipcRenderer.invoke('desktop:listConnectionRequests'),
    approveConnectionRequest: (requestId, code) => ipcRenderer.invoke('desktop:approveConnectionRequest', requestId, code),
  },
  todos: {
    list: () => ipcRenderer.invoke('todos:list'),
    add: (input) => ipcRenderer.invoke('todos:add', input),
    update: (id, input) => ipcRenderer.invoke('todos:update', id, input),
    complete: (id) => ipcRenderer.invoke('todos:complete', id),
    undoComplete: (id) => ipcRenderer.invoke('todos:undo-complete', id),
    remove: (id) => ipcRenderer.invoke('todos:remove', id),
    onListChanged: (listener) => {
      const handler = (_event, todos) => listener(todos);
      ipcRenderer.on('todos:listChanged', handler);
      return () => ipcRenderer.removeListener('todos:listChanged', handler);
    },
  },
  tipHistory: {
    list: () => ipcRenderer.invoke('tip-history:list'),
    onListChanged: (listener) => {
      const handler = (_event, history) => listener(history);
      ipcRenderer.on('tip-history:listChanged', handler);
      return () => ipcRenderer.removeListener('tip-history:listChanged', handler);
    },
  },
  joystickChat: {
    list: () => ipcRenderer.invoke('joystick-chat:list'),
    onListChanged: (listener) => {
      const handler = (_event, messages) => listener(messages);
      ipcRenderer.on('joystick-chat:listChanged', handler);
      return () => ipcRenderer.removeListener('joystick-chat:listChanged', handler);
    },
  },
  reminder: {
    get: () => ipcRenderer.invoke('reminder:get'),
    update: (settings) => ipcRenderer.invoke('reminder:update', settings),
    test: (settings) => ipcRenderer.invoke('reminder:test', settings),
    list: () => ipcRenderer.invoke('reminder:list'),
    create: (settings) => ipcRenderer.invoke('reminder:create', settings),
    updateRecord: (id, settings) => ipcRenderer.invoke('reminder:update-record', id, settings),
    remove: (id) => ipcRenderer.invoke('reminder:remove', id),
    testRecord: (id) => ipcRenderer.invoke('reminder:test-record', id),
  },
  directMessage: {
    send: (text) => ipcRenderer.invoke('direct-message:send', text),
  },
  joystickWhispers: {
    getSettings: () => ipcRenderer.invoke('joystick-whispers:get-settings'),
    updateSettings: (settings) => ipcRenderer.invoke('joystick-whispers:update-settings', settings),
    getStatus: () => ipcRenderer.invoke('joystick-whispers:get-status'),
    onStatusChanged: (listener) => {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on('joystick-whispers:status-changed', handler);
      return () => ipcRenderer.removeListener('joystick-whispers:status-changed', handler);
    },
  },
  joystickChatAutomations: {
    getSettings: () => ipcRenderer.invoke('joystick-chat-automations:get-settings'),
    updateSettings: (settings) => ipcRenderer.invoke('joystick-chat-automations:update-settings', settings),
  },
  supportLogs: {
    reportError: (report) => ipcRenderer.invoke('support-logs:report-error', sanitizeSupportLogReport(report)),
    exportLogs: () => ipcRenderer.invoke('support-logs:export'),
  },
});
