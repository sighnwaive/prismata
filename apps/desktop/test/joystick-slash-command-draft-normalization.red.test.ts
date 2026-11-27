import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeJoystickChatAutomationSettings } from '../src/joystick-chat-automations.js';

test('slash command normalization preserves a bounded blank-name response draft but always disables it', () => {
  const response = 'x'.repeat(500);
  const settings = normalizeJoystickChatAutomationSettings({
    slashCommands: {
      prefix: '!',
      commands: [{ name: '', response: `  ${response}  `, enabled: true }],
    },
  });

  assert.deepEqual(settings.slashCommands?.commands, [
    { name: '', response, enabled: false },
  ]);
});
