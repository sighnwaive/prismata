import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  defaultJoystickChatAutomationSettings,
  MAX_DROP_IN_CHAT_MESSAGES,
  normalizeJoystickChatAutomationSettings,
} from '../src/joystick-chat-automations.js';
import { createLocalStore } from '../src/local-store.js';

test('Drop-in chat automation normalizes ordered multiple messages and opts in explicitly', () => {
  assert.deepEqual(defaultJoystickChatAutomationSettings, { dropIn: { enabled: false, messages: [] } });
  assert.deepEqual(normalizeJoystickChatAutomationSettings({
    dropIn: { enabled: true, messages: ['  Welcome!  ', '', 'Enjoy the stream.', 42] },
  }), { dropIn: { enabled: true, messages: ['Welcome!', 'Enjoy the stream.'] } });
  assert.deepEqual(normalizeJoystickChatAutomationSettings({
    dropIn: { enabled: true, messages: [] },
  }), { dropIn: { enabled: false, messages: [] } }, 'blank lists fail closed');
  assert.deepEqual(normalizeJoystickChatAutomationSettings({
    dropIn: { enabled: true, messages: ['x'.repeat(501), 'Valid'] },
  }), { dropIn: { enabled: true, messages: ['Valid'] } }, 'oversized entries are excluded');
  assert.equal(normalizeJoystickChatAutomationSettings({
    dropIn: { enabled: true, messages: Array.from({ length: MAX_DROP_IN_CHAT_MESSAGES + 2 }, (_, i) => `Message ${i + 1}`) },
  }).dropIn.messages.length, MAX_DROP_IN_CHAT_MESSAGES, 'message count is bounded');
});

test('Drop-in public chat automation settings persist independently across local-store reopen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-drop-in-chat-settings-'));
  const file = path.join(directory, 'state.sqlite');
  try {
    const store = await createLocalStore(file);
    const initial = await store.getSettings();
    await store.updateSettings({
      ...initial.settings,
      joystickChatAutomations: { dropIn: { enabled: true, messages: ['Welcome!', 'Enjoy the stream.'] } },
      joystickWhispers: { followed: { enabled: true, message: 'Thanks for following' } },
    }, 'desktop');
    store.close();

    const reopened = await createLocalStore(file);
    const saved = await reopened.getSettings();
    assert.deepEqual(saved.settings.joystickChatAutomations, {
      dropIn: { enabled: true, messages: ['Welcome!', 'Enjoy the stream.'] },
    });
    assert.equal((saved.settings.joystickWhispers as { followed: { enabled: boolean } }).followed.enabled, true,
      'saving chat automation leaves whisper settings intact');
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
