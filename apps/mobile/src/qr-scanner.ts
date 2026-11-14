import { parsePairingPayload, type PairingPayload } from "@prismata/sync";

export type ScannedPairingValidation =
  | { state: "confirming"; payload: PairingPayload }
  | { state: "error"; message: string };

export function parseScannedPairingValue(value: string): PairingPayload {
  const payload = parsePairingPayload(normalizePairingValue(value));
  if (Date.parse(payload.expiresAt) <= Date.now())
    throw new Error("pairing challenge expired");
  return payload;
}

// Camera and Linking both provide data, not browser destinations. Decode only a
// fully encoded value, then let the shared parser enforce the security contract.
export const parseIncomingPairingValue = parseScannedPairingValue;

export function validateScannedPairingValue(
  value: string,
  parser: (value: string) => PairingPayload = parseIncomingPairingValue
): ScannedPairingValidation {
  try {
    return { state: "confirming", payload: parser(value) };
  } catch (cause) {
    return {
      state: "error",
      message: cause instanceof Error ? cause.message : "invalid pairing QR",
    };
  }
}

function normalizePairingValue(value: string): string {
  if (typeof value !== "string")
    throw new Error("invalid pairing payload: QR value must be text");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("invalid pairing payload: QR value is empty");
  if (/^prismata:\/\/pair\?/i.test(trimmed)) return trimmed;
  try {
    return decodeURIComponent(trimmed).trim();
  } catch {
    throw new Error(
      "invalid pairing payload: QR value is not valid URL encoding"
    );
  }
}
