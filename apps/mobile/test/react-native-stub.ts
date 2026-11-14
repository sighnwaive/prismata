export const NativeModules: Record<string, unknown> = {};
export const Platform = { OS: "android", Version: "current" };
export const AppState = {
  addEventListener: () => ({ remove: () => undefined }),
};
export const Linking = {
  addEventListener: () => ({ remove: () => undefined }),
  getInitialURL: async () => null,
  openSettings: async () => undefined,
};
export const AppRegistry = {
  registerComponent: (_name: string, _componentProvider: () => unknown) => {
    const state = globalThis as typeof globalThis & {
      __prismataUrlSearchParamsReadyAtRegistration?: boolean;
    };
    state.__prismataUrlSearchParamsReadyAtRegistration =
      typeof globalThis.URLSearchParams?.prototype.get === "function";
  },
};
export const StyleSheet = {
  absoluteFill: {},
  create: <T>(styles: T) => styles,
};
export const Button = () => null;
export const ScrollView = () => null;
export const Text = () => null;
export const TextInput = () => null;
export const View = () => null;
