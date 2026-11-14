export type NativeKeychain = {
  getGenericPassword: (options: { service: string }) => Promise<false | { password: string }>;
  setGenericPassword: (
    username: string,
    password: string,
    options: { service: string },
  ) => Promise<unknown>;
  resetGenericPassword: (options: { service: string }) => Promise<boolean>;
};

export type MobileSecureStorage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

const unavailable = () => new Error('native secure storage unavailable');

export function createNativeMobileSecureStorage(input: {
  keychain?: NativeKeychain | null;
} = {}): MobileSecureStorage {
  let keychain = input.keychain;
  const resolveKeychain = () => {
    if (keychain === undefined) {
      // Keep the native module out of test/Node evaluation; React Native resolves this require on-device.
      const nativeModuleName = 'react-native-keychain';
      try {
        keychain = (eval('require') as (name: string) => unknown)(nativeModuleName) as NativeKeychain;
      } catch {
        keychain = null;
      }
    }
    return keychain;
  };

  return {
    async get(key) {
      const resolved = resolveKeychain();
      if (!resolved) throw unavailable();
      const credentials = await resolved.getGenericPassword({ service: key });
      return credentials === false ? null : credentials.password;
    },
    async set(key, value) {
      const resolved = resolveKeychain();
      if (!resolved) throw unavailable();
      await resolved.setGenericPassword('prismata', value, { service: key });
    },
    async remove(key) {
      const resolved = resolveKeychain();
      if (!resolved) throw unavailable();
      await resolved.resetGenericPassword({ service: key });
    },
  };
}
