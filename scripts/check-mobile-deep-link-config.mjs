#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const app = JSON.parse(await readFile(resolve(root, 'apps/mobile/app.json'), 'utf8'));
const manifest = await readFile(resolve(root, 'apps/mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
const authFlow = await readFile(resolve(root, 'apps/mobile/src/auth-flow.tsx'), 'utf8');

const checks = [
  ['app declares the Prismata scheme', app.scheme === 'prismata'],
  ['iOS declares the Prismata URL type', app.ios?.infoPlist?.CFBundleURLTypes?.some((entry) => entry.CFBundleURLSchemes?.includes('prismata')) === true],
  ['Android accepts only the Prismata pair host', manifest.includes('android:scheme="prismata" android:host="pair"')],
  ['Android activity receives links in the existing task', manifest.includes('android:launchMode="singleTask"')],
  ['deep links use the incoming-value parser', authFlow.includes('parseIncomingPairingValue(url)')],
  ['deep links do not open the QR value as a URL', !authFlow.includes('Linking.openURL(')],
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [description] of failed) console.error(`FAIL: ${description}`);
  process.exit(1);
}

console.log(`PASS: ${checks.length} mobile deep-link configuration checks`);
