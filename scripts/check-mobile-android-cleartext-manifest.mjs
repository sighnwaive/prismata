#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const mainManifest = await readFile(
  resolve(root, "apps/mobile/android/app/src/main/AndroidManifest.xml"),
  "utf8",
);
const debugManifest = await readFile(
  resolve(root, "apps/mobile/android/app/src/debug/AndroidManifest.xml"),
  "utf8",
);

const mainApplication = mainManifest.match(/<application\b[^>]*>/s)?.[0] ?? "";
const debugApplication = debugManifest.match(/<application\b[^>]*>/s)?.[0] ?? "";
const checks = [
  [
    "main application explicitly disables cleartext traffic",
    /android:usesCleartextTraffic="false"/.test(mainApplication),
  ],
  [
    "debug application explicitly enables cleartext traffic",
    /android:usesCleartextTraffic="true"/.test(debugApplication),
  ],
  [
    "debug application explicitly replaces the main cleartext value",
    /tools:replace="android:usesCleartextTraffic"/.test(debugApplication),
  ],
  [
    "main manifest does not enable cleartext traffic",
    !/android:usesCleartextTraffic="true"/.test(mainManifest),
  ],
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [description] of failed) console.error(`FAIL: ${description}`);
  process.exit(1);
}

console.log(`PASS: ${checks.length} Android cleartext manifest checks`);
