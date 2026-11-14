import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');

test('sandboxed preload executes as a runtime-compatible script and exposes the complete bridge', () => {
  const exposed = {};
  const listeners = new Map();
  const ipcRenderer = {
    invoke: (channel, ...args) => Promise.resolve({ channel, args }),
    on: (channel, handler) => listeners.set(channel, handler),
    removeListener: (channel, handler) => {
      if (listeners.get(channel) === handler) listeners.delete(channel);
    },
  };

  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotThrow(() => vm.runInNewContext(source, {
    require: (specifier) => {
      assert.equal(specifier, 'electron');
      return { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer };
    },
  }, { filename: 'preload.mjs' }));

  assert.deepEqual(Object.keys(exposed.prismataDesktop.auth).sort(), [
    'cancel', 'getSnapshot', 'onStateChanged', 'signInWithJoystick', 'signOut',
  ]);
  assert.deepEqual(Object.keys(exposed.prismataDesktop.admin).sort(), [
    'approveConnectionRequest', 'getStatus', 'listConnectionRequests', 'listDevices',
    'listNetworkInterfaces', 'retryAdvertising', 'revokeDevice', 'setAdvertisedAddress',
    'setLanEnabled',
  ]);
});
