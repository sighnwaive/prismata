import assert from "node:assert/strict";
import test from "node:test";
import type { URLSearchParams as PolyfillURLSearchParams } from "react-native-url-polyfill";

test("mobile entrypoint loads URLSearchParams before registering the app", async () => {
  const state = globalThis as typeof globalThis & {
    __prismataUrlSearchParamsReadyAtRegistration?: boolean;
  };
  const urlSearchParamsGlobal = globalThis as typeof globalThis & {
    URLSearchParams: typeof PolyfillURLSearchParams;
  };
  const NativeURLSearchParams = urlSearchParamsGlobal.URLSearchParams;
  const get = NativeURLSearchParams.prototype.get;
  NativeURLSearchParams.prototype.get = undefined as unknown as typeof get;

  try {
    // The React Native entrypoint is JavaScript and intentionally has no TS API.
    // @ts-expect-error importing the real JavaScript bootstrap is the behavior under test.
    await import("../index.js");
    assert.equal(state.__prismataUrlSearchParamsReadyAtRegistration, true);
  } finally {
    urlSearchParamsGlobal.URLSearchParams = NativeURLSearchParams;
    NativeURLSearchParams.prototype.get = get;
  }
});
