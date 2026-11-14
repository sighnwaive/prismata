import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync(new URL('../src/auth.ts', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

test('shared sync auth exposes no provider token exchange surface', () => {
  assert.doesNotMatch(authSource, /JoystickToken|JoystickOAuth|parseJoystick|replaceJoystick|completeJoystick/);
  assert.doesNotMatch(indexSource, /joystick/i);
});
