import assert from "node:assert/strict";
import test from "node:test";
import type { URLSearchParams as PolyfillURLSearchParams } from "react-native-url-polyfill";
import { parseIncomingPairingValue } from "../src/qr-scanner";

const pairingUrl =
  "prismata://pair?v=1&endpoint=https%3A%2F%2Fstudio.local%3A48123&challenge=one-use&expiresAt=2099-01-01T00%3A00%3A00.000Z&instanceId=desktop-1&fingerprint=" +
  "ab".repeat(32);
const urlSearchParamsGlobal = globalThis as typeof globalThis & {
  URLSearchParams: typeof PolyfillURLSearchParams;
};

test("mobile pairing parsing supports URLSearchParams.get", async () => {
  const NativeURLSearchParams = urlSearchParamsGlobal.URLSearchParams;
  const get = NativeURLSearchParams.prototype.get;
  NativeURLSearchParams.prototype.get = undefined as unknown as typeof get;

  try {
    await import("../src/mobile-polyfills");
    assert.equal(parseIncomingPairingValue(pairingUrl).instanceId, "desktop-1");
  } finally {
    urlSearchParamsGlobal.URLSearchParams = NativeURLSearchParams;
    NativeURLSearchParams.prototype.get = get;
  }
});
