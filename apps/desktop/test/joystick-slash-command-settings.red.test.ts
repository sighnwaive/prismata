import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeJoystickChatAutomationSettings } from '../src/joystick-chat-automations.js';
import { createLocalStore } from '../src/local-store.js';

test('slash command settings default to ! with no commands', () => {
  assert.deepEqual(normalizeJoystickChatAutomationSettings(undefined), {
    dropIn: { enabled: false, messages: [] },
    slashCommands: { prefix: '!', commands: [] },
  });
});

test('slash command settings preserve blank-name response drafts disabled and reject oversized or duplicate entries', () => {
  const normalized = normalizeJoystickChatAutomationSettings({
    slashCommands: {
      prefix: '?',
      commands: [
        { name: '  Toy  ', response: '  Use !toy to learn more  ', enabled: true },
        { name: 'TOY', response: 'Duplicate names are ignored', enabled: true },
        { name: 'Rules', response: 'Read the rules' },
        { name: '   ', response: 'Incomplete command', enabled: true },
        { name: 'Long reply', response: 'x'.repeat(501), enabled: true },
        { name: 'Long name '.repeat(100), response: 'Bounded command names', enabled: true },
      ],
    },
  }) as {
    slashCommands: { prefix: string; commands: Array<{ name: string; response: string; enabled: boolean }> };
  };

  assert.deepEqual(normalized.slashCommands, {
    prefix: '?',
    commands: [
      { name: 'Toy', response: 'Use !toy to learn more', enabled: true },
      { name: 'Rules', response: 'Read the rules', enabled: false },
      { name: '', response: 'Incomplete command', enabled: false },
    ],
  }, 'blank-name response drafts are retained disabled; oversized and case-insensitive duplicate entries are excluded');
  assert.ok(normalized.slashCommands.commands.every(({ name, response }) => name.length < 1_000 && response.length <= 500));
});

test('slash command prefix accepts one punctuation character and fails closed to ! otherwise', () => {
  for (const prefix of ['a', '7', ' ', '\n', '!!', 'é']) {
    const settings = normalizeJoystickChatAutomationSettings({
      slashCommands: { prefix, commands: [] },
    }) as { slashCommands: { prefix: string } };
    assert.deepEqual(settings.slashCommands, { prefix: '!', commands: [] },
      `invalid prefix ${JSON.stringify(prefix)} uses the default`);
  }

  const settings = normalizeJoystickChatAutomationSettings({
    slashCommands: { prefix: '/', commands: [] },
  }) as { slashCommands: { prefix: string } };
  assert.equal(settings.slashCommands.prefix, '/');
});

test('slash command settings bound the number of saved entries', () => {
  const settings = normalizeJoystickChatAutomationSettings({
    slashCommands: {
      prefix: '!',
      commands: Array.from({ length: 1_000 }, (_, index) => ({
        name: `command-${index}`,
        response: `Reply ${index}`,
        enabled: true,
      })),
    },
  }) as { slashCommands: { commands: unknown[] } };
  assert.ok(Array.isArray(settings.slashCommands?.commands) && settings.slashCommands.commands.length < 1_000,
    'the configured command count is bounded');
});

test('slash command settings survive a local-store reopen without replacing unrelated settings', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-slash-command-settings-'));
  const file = path.join(directory, 'state.sqlite');
  try {
    const store = await createLocalStore(file);
    const initial = await store.getSettings();
    await store.updateSettings({
      ...initial.settings,
      theme: 'midnight',
      joystickWhispers: {
        followed: { enabled: true, message: 'Thanks for following' },
      },
      joystickChatAutomations: {
        dropIn: { enabled: true, messages: ['Welcome!'] },
        slashCommands: {
          prefix: '!',
          commands: [{ name: 'toy', response: 'Use !toy to learn about the stream', enabled: true }],
        },
      },
    }, 'desktop');
    store.close();

    const reopened = await createLocalStore(file);
    const saved = await reopened.getSettings();
    assert.deepEqual((saved.settings.joystickChatAutomations as Record<string, unknown>).slashCommands, {
      prefix: '!',
      commands: [{ name: 'toy', response: 'Use !toy to learn about the stream', enabled: true }],
    });
    assert.deepEqual((saved.settings.joystickChatAutomations as Record<string, unknown>).dropIn, {
      enabled: true,
      messages: ['Welcome!'],
    });
    assert.equal(saved.settings.theme, 'midnight');
    assert.deepEqual(saved.settings.joystickWhispers, {
      followed: { enabled: true, message: 'Thanks for following' },
      subscribed: { enabled: false, message: '' },
      resubscribed: { enabled: false, message: '' },
      giftSender: { enabled: false, message: '' },
    }, 'saving slash commands preserves other normalized settings');
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
