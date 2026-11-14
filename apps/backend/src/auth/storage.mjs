const requiredAuthStorageMethods = [
  'persistAuthState',
  'consumeAuthState',
  'createSession',
];

// This is the narrow seam a future Postgres adapter should satisfy for
// auth_states, sessions, users, auth_accounts, devices, and user_settings.
export const assertValidAuthStorage = (authStorage) => {
  for (const methodName of requiredAuthStorageMethods) {
    if (typeof authStorage?.[methodName] !== 'function') {
      throw new TypeError(`authStorage must implement ${methodName}()`);
    }
  }

  return authStorage;
};
