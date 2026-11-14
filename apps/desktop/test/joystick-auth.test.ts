import assert from 'node:assert/strict';
import test from 'node:test';
import { describeJoystickAuth } from '../src/joystick-auth.js';

test('Joystick desktop auth uses a public PKCE client', () => {
  assert.deepEqual(describeJoystickAuth({ supportsPublicPkce: true }), { state: 'available', clientType: 'public-pkce' });
});
