import assert from "node:assert/strict";
import test from "node:test";
import {
  parseIncomingPairingValue,
  parseScannedPairingValue,
  validateScannedPairingValue,
} from "../src/qr-scanner";
import { getScannerPresentation } from "../src/scanner-state";

const pairingUrl = `prismata://pair?v=1&endpoint=${encodeURIComponent(
  "https://studio.local:48123"
)}&challenge=one-use&expiresAt=2099-01-01T00%3A00%3A00.000Z&instanceId=desktop-1&fingerprint=${"ab".repeat(
  32
)}`;

test("scanner accepts only a valid Prismata pairing payload", () => {
  assert.equal(parseScannedPairingValue(pairingUrl).instanceId, "desktop-1");
  assert.throws(
    () => parseScannedPairingValue("https://example.com"),
    /unsupported pairing payload/
  );
});

test("scanner parses QR text directly without attempting to open its custom protocol", () => {
  assert.equal(
    parseScannedPairingValue(`  ${pairingUrl}  `).endpoint,
    "https://studio.local:48123"
  );
  assert.equal(
    parseScannedPairingValue(encodeURIComponent(pairingUrl)).instanceId,
    "desktop-1"
  );
  assert.throws(
    () => parseScannedPairingValue("prismata%3A%2F%2Fpair%3Fv%3D1"),
    /invalid pairing payload/
  );
});

test("scanner accepts the desktop-generated payload with whitespace and URL encoding", () => {
  const desktopPayload = `\n ${encodeURIComponent(pairingUrl)} \t`;
  const result = validateScannedPairingValue(desktopPayload);
  assert.equal(result.state, "confirming");
  if (result.state === "confirming")
    assert.equal(result.payload.endpoint, "https://studio.local:48123");
});

test("scanner turns malformed payloads into an actionable validation error", () => {
  const result = validateScannedPairingValue("not a pairing payload");
  assert.equal(result.state, "error");
  if (result.state === "error")
    assert.match(result.message, /invalid|unsupported/);
});

test("scanner catches parser exceptions instead of leaving the flow unmounted", () => {
  const result = validateScannedPairingValue(pairingUrl, () => {
    throw new Error("parser unavailable");
  });
  assert.deepEqual(result, { state: "error", message: "parser unavailable" });
});

test("a detected QR transitions to confirmation or error after validation", () => {
  assert.equal(validateScannedPairingValue(pairingUrl).state, "confirming");
  assert.equal(
    validateScannedPairingValue("prismata://pair?v=1").state,
    "error"
  );
});

test("deep links use the same raw-value parser as QR scans", () => {
  assert.deepEqual(
    parseIncomingPairingValue(`\n${pairingUrl}\t`),
    parseScannedPairingValue(pairingUrl)
  );
});

test("scanner rejects expired challenges before showing confirmation", () => {
  assert.throws(
    () =>
      parseScannedPairingValue(
        `prismata://pair?v=1&endpoint=${encodeURIComponent(
          "https://studio.local:48123"
        )}&challenge=one-use&expiresAt=2020-01-01T00%3A00%3A00.000Z&instanceId=desktop-1&fingerprint=${"ab".repeat(
          32
        )}`
      ),
    /pairing challenge expired/
  );
});

test("Scan QR keeps the scanner mounted until permission and a camera device are ready", () => {
  assert.equal(getScannerPresentation("checking", false), "checking");
  assert.equal(getScannerPresentation("granted", false), "unavailable");
  assert.equal(getScannerPresentation("granted", true), "camera");
});

test("scanner permission states provide a safe fallback instead of mounting Camera", () => {
  assert.equal(getScannerPresentation("denied", true), "permission");
  assert.equal(getScannerPresentation("unavailable", true), "unavailable");
  assert.equal(getScannerPresentation("granted", true, true), "handled");
});
