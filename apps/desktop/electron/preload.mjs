const { contextBridge, ipcRenderer } = require('electron');

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
});
