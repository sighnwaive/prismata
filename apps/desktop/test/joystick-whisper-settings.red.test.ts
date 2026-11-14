import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  defaultJoystickWhisperSettings,
  normalizeJoystickWhisperSettings,
} from '../src/joystick-whisper-settings.js';
import { createLocalStore } from '../src/local-store.js';

test('four whisper rules normalize independently and survive a local-store reopen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-whisper-settings-'));
  const file = path.join(directory, 'state.sqlite');
  const rules = normalizeJoystickWhisperSettings({
    followed: { enabled: true, message: 'Thanks for following!' },
    subscribed: { enabled: false, message: 'Welcome aboard!' },
    resubscribed: { enabled: true, message: 'Welcome back!' },
    giftSender: { enabled: false, message: 'Thanks for the gifts!' },
  });

  assert.deepEqual(rules, {
    followed: { enabled: true, message: 'Thanks for following!' },
    subscribed: { enabled: false, message: 'Welcome aboard!' },
    resubscribed: { enabled: true, message: 'Welcome back!' },
    giftSender: { enabled: false, message: 'Thanks for the gifts!' },
  });

  const first = await createLocalStore(file);
  const current = await first.getSettings();
  await first.updateSettings({ ...current.settings, joystickWhispers: rules }, 'desktop');
  first.close();

  const reopened = await createLocalStore(file);
  const saved = (await reopened.getSettings()).settings.joystickWhispers;
  assert.deepEqual(normalizeJoystickWhisperSettings(saved), rules);
  reopened.close();
});

test('whisper settings fail closed to independent opt-in defaults when persisted values are malformed', () => {
  assert.deepEqual(defaultJoystickWhisperSettings, {
    followed: { enabled: false, message: '' },
    subscribed: { enabled: false, message: '' },
    resubscribed: { enabled: false, message: '' },
    giftSender: { enabled: false, message: '' },
  });
  assert.deepEqual(normalizeJoystickWhisperSettings({
    followed: { enabled: 'yes', message: 42 },
    subscribed: null,
    resubscribed: { enabled: true, message: '  ' },
    giftSender: { enabled: true, message: 'Gift sender' },
  }), {
    followed: { enabled: false, message: '' },
    subscribed: { enabled: false, message: '' },
    resubscribed: { enabled: false, message: '' },
    giftSender: { enabled: true, message: 'Gift sender' },
  });
});
