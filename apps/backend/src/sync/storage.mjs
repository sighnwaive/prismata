const requiredSyncStorageMethods = [
  'getSession',
  'getUserSettings',
  'upsertDevice',
];

export const assertValidSyncStorage = (syncStorage) => {
  for (const methodName of requiredSyncStorageMethods) {
    if (typeof syncStorage?.[methodName] !== 'function') {
      throw new TypeError(`syncStorage must implement ${methodName}()`);
    }
  }

  return syncStorage;
};
