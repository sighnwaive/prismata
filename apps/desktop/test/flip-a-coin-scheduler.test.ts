import assert from 'node:assert/strict';
import test from 'node:test';
import { createFlipACoinScheduler } from '../src/flip-a-coin-scheduler.js';

test('coin-flip task maps injected random outcomes to exact messages', async () => {
  const sent: unknown[] = [];
  const outcomes = [0, 1];
  const scheduler = createFlipACoinScheduler({
    send: (payload) => { sent.push(payload); },
    randomInt: () => outcomes.shift()!,
    getSettings: () => ({ task: 'coin-flip', enabled: true, message: 'ignored', schedule: 'interval', intervalMinutes: 5, dailyTime: '09:00' }),
  });

  await scheduler.tick(new Date(2026, 9, 14, 12, 0, 0));
  await scheduler.tick(new Date(2026, 9, 14, 12, 5, 0));

  assert.deepEqual(sent, [
    { message: "I've flipped a coin, it's heads" },
    { message: "I've flipped a coin, it's tails" },
  ]);
});

test('configured reminders use hourly wall-clock cadence and send once per hour bucket', async () => {
  const sent: unknown[] = [];
  const scheduler = createFlipACoinScheduler({
    send: (payload) => { sent.push(payload); },
    getSettings: () => ({ enabled: true, task: 'custom-message', message: 'Flip a Coin', schedule: 'hourly', intervalMinutes: 5, dailyTime: '09:00' }),
  });

  await scheduler.tick(new Date(2026, 9, 14, 11, 59, 59));
  assert.deepEqual(sent, []);

  await scheduler.tick(new Date(2026, 9, 14, 12, 0, 0));
  await scheduler.tick(new Date(2026, 9, 14, 12, 0, 59));
  assert.deepEqual(sent, [{ message: 'Flip a Coin' }]);

  await scheduler.tick(new Date(2026, 9, 14, 12, 5, 0));
  await scheduler.tick(new Date(2026, 9, 14, 12, 59, 59));
  await scheduler.tick(new Date(2026, 9, 14, 13, 0, 0));
  await scheduler.tick(new Date(2026, 9, 14, 13, 0, 59));
  assert.deepEqual(sent, [
    { message: 'Flip a Coin' },
    { message: 'Flip a Coin' },
  ]);
});

test('scheduler does not invent a reminder when no settings or records are configured', async () => {
  const sent: unknown[] = [];
  const scheduler = createFlipACoinScheduler({ send: (payload) => { sent.push(payload); } });

  await scheduler.tick(new Date(2026, 9, 14, 12, 0, 0));

  assert.deepEqual(sent, []);
});

test('background polling is injectable and stops cleanly', async () => {
  const sent: unknown[] = [];
  let currentTime = new Date(2026, 9, 14, 12, 0, 0);
  let poll!: () => void;
  let stopped = false;
  const scheduler = createFlipACoinScheduler({
    send: (payload) => { sent.push(payload); },
    getSettings: () => ({ enabled: true, task: 'custom-message', message: 'Flip a Coin', schedule: 'hourly', intervalMinutes: 5, dailyTime: '09:00' }),
    now: () => currentTime,
    setInterval: (callback) => { poll = callback; return 1 as ReturnType<typeof globalThis.setInterval>; },
    clearInterval: () => { stopped = true; },
  });

  scheduler.start();
  poll();
  await Promise.resolve();
  currentTime = new Date(2026, 9, 14, 13, 0, 0);
  poll();
  await Promise.resolve();
  scheduler.stop();

  assert.equal(sent.length, 1);
  assert.equal(stopped, true);
});

test('starting during an active interval bucket waits for the next bucket boundary', async () => {
  const sent: unknown[] = [];
  let currentTime = new Date(2026, 9, 14, 12, 2, 0);
  let poll!: () => void;
  const scheduler = createFlipACoinScheduler({
    send: (payload) => { sent.push(payload); },
    getSettings: () => ({ enabled: true, task: 'custom-message', message: 'Scheduled message', schedule: 'interval', intervalMinutes: 5, dailyTime: '09:00' }),
    now: () => currentTime,
    setInterval: (callback) => { poll = callback; return 1 as ReturnType<typeof globalThis.setInterval>; },
    clearInterval: () => {},
  });

  scheduler.start();
  poll();
  await Promise.resolve();
  assert.deepEqual(sent, []);

  currentTime = new Date(2026, 9, 14, 12, 4, 59);
  poll();
  await Promise.resolve();
  assert.deepEqual(sent, []);

  currentTime = new Date(2026, 9, 14, 12, 5, 0);
  poll();
  await Promise.resolve();
  assert.deepEqual(sent, [{ message: 'Scheduled message' }]);
  scheduler.stop();
});

test('starting exactly on an interval boundary waits for the next occurrence', async () => {
  const sent: unknown[] = [];
  let currentTime = new Date(2026, 9, 14, 12, 0, 0);
  let poll!: () => void;
  const scheduler = createFlipACoinScheduler({
    send: (payload) => { sent.push(payload); },
    getSettings: () => ({ enabled: true, task: 'custom-message', message: 'Scheduled message', schedule: 'interval', intervalMinutes: 5, dailyTime: '09:00' }),
    now: () => currentTime,
    setInterval: (callback) => { poll = callback; return 1 as ReturnType<typeof globalThis.setInterval>; },
    clearInterval: () => {},
  });

  scheduler.start();
  poll();
  await Promise.resolve();
  assert.deepEqual(sent, []);

  currentTime = new Date(2026, 9, 14, 12, 5, 0);
  poll();
  await Promise.resolve();
  assert.deepEqual(sent, [{ message: 'Scheduled message' }]);
  scheduler.stop();
});

test('supports the friendly schedule presets and configured message', async () => {
  const sent: unknown[] = [];
  const settings = { enabled: true, task: 'custom-message' as const, message: 'Time to choose', schedule: 'interval' as const, intervalMinutes: 5, dailyTime: '09:00' };
  const scheduler = createFlipACoinScheduler({ send: (payload) => { sent.push(payload); }, getSettings: () => settings });
  await scheduler.tick(new Date(2026, 9, 14, 12, 0, 0));
  await scheduler.tick(new Date(2026, 9, 14, 12, 5, 0));
  assert.deepEqual(sent, [{ message: 'Time to choose' }, { message: 'Time to choose' }]);

  settings.schedule = 'daily';
  settings.dailyTime = '09:30';
  await scheduler.tick(new Date(2026, 9, 14, 9, 29, 0));
  await scheduler.tick(new Date(2026, 9, 14, 9, 30, 0));
  await scheduler.tick(new Date(2026, 9, 14, 9, 30, 30));
  assert.deepEqual(sent.at(-1), { message: 'Time to choose' });
});

test('custom reminder message pools rotate in order and wrap around', async () => {
  const sent: unknown[] = [];
  const scheduler = createFlipACoinScheduler({
    send: (payload) => { sent.push(payload); },
    getSettings: () => [{
      id: 'focus-reminder',
      enabled: true,
      task: 'custom-message',
      message: 'First message',
      messages: ['First message', 'Second message', 'Third message'],
      schedule: 'interval',
      intervalMinutes: 1,
      dailyTime: '09:00',
    }],
  });

  for (let minute = 0; minute < 5; minute += 1) {
    await scheduler.tick(new Date(2026, 9, 14, 12, minute, 0));
  }

  assert.deepEqual(sent, [
    { message: 'First message' },
    { message: 'Second message' },
    { message: 'Third message' },
    { message: 'First message' },
    { message: 'Second message' },
  ]);
});

test('testing a reminder previews its next message without advancing the scheduled rotation', async () => {
  const sent: unknown[] = [];
  const scheduler = createFlipACoinScheduler({
    send: (payload) => { sent.push(payload); },
    getSettings: () => [{
      id: 'focus-reminder',
      enabled: true,
      task: 'custom-message',
      message: 'First message',
      messages: ['First message', 'Second message'],
      schedule: 'interval',
      intervalMinutes: 1,
      dailyTime: '09:00',
    }],
  });

  await scheduler.tick(new Date(2026, 9, 14, 12, 0, 0));
  await scheduler.testNow({
    id: 'focus-reminder',
    task: 'custom-message',
    messages: ['First message', 'Second message'],
  });
  await scheduler.tick(new Date(2026, 9, 14, 12, 1, 0));

  assert.deepEqual(sent, [
    { message: 'First message' },
    { message: 'Second message' },
    { message: 'Second message' },
  ]);
});

test('disabled reminders do not send', async () => {
  const sent: unknown[] = [];
  const scheduler = createFlipACoinScheduler({ send: (payload) => { sent.push(payload); }, getSettings: () => ({ enabled: false, task: 'custom-message', message: 'Nope', schedule: 'hourly', intervalMinutes: 5, dailyTime: '09:00' }) });
  await scheduler.tick(new Date(2026, 9, 14, 12, 0, 0));
  assert.deepEqual(sent, []);
});

test('immediate test sends custom messages without enabled or schedule gates', async () => {
  const sent: unknown[] = [];
  const scheduler = createFlipACoinScheduler({ send: (payload) => { sent.push(payload); } });
  await scheduler.testNow({ enabled: false, task: 'custom-message', message: 'Test this now', schedule: 'daily', intervalMinutes: 5, dailyTime: '23:59' });
  assert.deepEqual(sent, [{ message: 'Test this now' }]);
});

test('immediate test sends coin flips with the scheduler random source and exact text', async () => {
  const sent: unknown[] = [];
  const scheduler = createFlipACoinScheduler({ send: (payload) => { sent.push(payload); }, randomInt: () => 1 });
  await scheduler.testNow({ enabled: false, task: 'coin-flip', message: 'ignored', schedule: 'daily', intervalMinutes: 5, dailyTime: '23:59' });
  assert.deepEqual(sent, [{ message: "I've flipped a coin, it's tails" }]);
});
