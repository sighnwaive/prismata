import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeMobileSecureStorage } from '../src/mobile-secure-storage';

test('native mobile secure storage fails closed when the native keychain is unavailable', async () => {
  const storage = createNativeMobileSecureStorage({
    keychain: null,
  });

  await assert.rejects(storage.get('session'), /native secure storage unavailable/);
  await assert.rejects(storage.set('session', 'secret'), /native secure storage unavailable/);
  await assert.rejects(storage.remove('session'), /native secure storage unavailable/);
});

test('production adapter does not silently degrade when native loading fails', async () => {
  const storage = createNativeMobileSecureStorage();

  await assert.rejects(storage.get('session'), /native secure storage unavailable/);
});

test('native mobile secure storage delegates string values to the native keychain', async () => {
  const values = new Map<string, string>();
  const storage = createNativeMobileSecureStorage({
    keychain: {
      getGenericPassword: async ({ service }) => {
        const value = values.get(service);
        return value ? { username: 'prismata', password: value, service } : false;
      },
      setGenericPassword: async (_username, password, { service }) => {
        values.set(service, password);
        return { service, storage: 'keychain' };
      },
      resetGenericPassword: async ({ service }) => {
        values.delete(service);
        return true;
      },
    },
  });

  await storage.set('session', 'secret');
  assert.equal(await storage.get('session'), 'secret');
  await storage.remove('session');
  assert.equal(await storage.get('session'), null);
});
