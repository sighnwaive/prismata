import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createBrowserWindowOptions } from '../electron/main';

const mainSource = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');

test('desktop BrowserWindow uses isolated, non-Node, sandboxed renderer security', () => {
  const options = createBrowserWindowOptions('/tmp/preload.mjs');
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(options.webPreferences?.preload, '/tmp/preload.mjs');
});

test('desktop removes the Electron application menu', () => {
  assert.match(mainSource, /Menu\.setApplicationMenu\(null\)/);
});

test('Ctrl+Shift+I toggles DevTools only in unpackaged development builds', () => {
  assert.match(mainSource, /if \(!app\.isPackaged\) \{\s*window\.webContents\.on\('before-input-event', \(event, input\) => \{\s*if \(input\.type !== 'keyDown' \|\| !input\.control \|\| !input\.shift \|\| input\.alt \|\| input\.meta \|\| input\.key\.toLowerCase\(\) !== 'i'\) return;\s*event\.preventDefault\(\);\s*window\.webContents\.toggleDevTools\(\);/);
});
