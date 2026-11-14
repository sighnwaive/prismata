#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "apps/mobile/package.json"), "utf8"));
const modulePath = resolve(
  root,
  "apps/mobile/android/app/src/main/java/com/prismata/PrismataNsdModule.kt",
);
const packagePath = resolve(
  root,
  "apps/mobile/android/app/src/main/java/com/prismata/PrismataNsdPackage.kt",
);
const app = await readFile(resolve(root, "apps/mobile/android/app/build.gradle"), "utf8");
const application = await readFile(resolve(root, "apps/mobile/android/app/src/main/java/com/prismata/MainApplication.kt"), "utf8");
const manifest = await readFile(resolve(root, "apps/mobile/android/app/src/main/AndroidManifest.xml"), "utf8");

const checks = [
  ["legacy react-native-zeroconf is not a mobile dependency", !packageJson.dependencies?.["react-native-zeroconf"]],
  ["app-owned Android NSD module exists", await access(modulePath, constants.R_OK).then(() => true, () => false)],
  ["app-owned Android NSD package exists", await access(packagePath, constants.R_OK).then(() => true, () => false)],
  ["Android NSD module uses NsdManager", (await readFile(modulePath, "utf8").catch(() => "")).includes("NsdManager")],
  ["Android NSD module scopes discovery to Prismata", (await readFile(modulePath, "utf8").catch(() => "")).includes('"_prismata._tcp"')],
  ["Android app registers the NSD package", application.includes("PrismataNsdPackage()")],
  ["Android app has no external native build hook", !app.includes("externalNativeBuild")],
  ["Android app keeps multicast discovery permission", manifest.includes("android.permission.CHANGE_WIFI_MULTICAST_STATE")],
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [description] of failed) console.error(`FAIL: ${description}`);
  process.exit(1);
}

console.log(`PASS: ${checks.length} Android native discovery checks`);
