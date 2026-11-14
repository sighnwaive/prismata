#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const settings = await readFile(resolve(root, "apps/mobile/android/settings.gradle"), "utf8");
const appBuild = await readFile(resolve(root, "apps/mobile/android/app/build.gradle"), "utf8");
const cliGradleScript = resolve(
  root,
  "apps/mobile/node_modules/@react-native-community/cli-platform-android/native_modules.gradle",
);

const checks = [
  ["settings uses the RN 0.74 CLI autolinking script", settings.includes("@react-native-community/cli-platform-android/native_modules.gradle")],
  ["app uses the RN 0.74 CLI autolinking script", appBuild.includes("@react-native-community/cli-platform-android/native_modules.gradle")],
  ["the resolved CLI autolinking script exists", (await import("node:fs")).existsSync(cliGradleScript)],
  ["app verifies generated Keychain autolinking", appBuild.includes("verifyReactNativeAutolinking")],
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [description] of failed) console.error(`FAIL: ${description}`);
  process.exit(1);
}

console.log(`PASS: ${checks.length} RN 0.74 Android autolinking checks`);
