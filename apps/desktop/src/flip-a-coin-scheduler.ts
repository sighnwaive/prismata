import { defaultReminderSettings, normalizeReminderRecord, normalizeReminderRecords, normalizeReminderSettings, type ReminderRecord, type ReminderSettings } from './reminder-settings.js';
import { randomInt as cryptoRandomInt } from 'node:crypto';

export const flipACoinMessage = { message: defaultReminderSettings.message } as const;

export type FlipACoinMessage = { message: string };
export type FlipACoinSender = (payload: FlipACoinMessage) => void | Promise<void>;

export type FlipACoinScheduler = {
  start(): void;
  stop(): void;
  tick(at: Date): Promise<void>;
  testNow(settings: unknown): Promise<void>;
};

type SchedulerOptions = {
  send: FlipACoinSender;
  getSettings?: () => unknown | Promise<unknown>;
  intervalMs?: number;
  now?: () => Date;
  setInterval?: (callback: () => void, delay: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval?: (handle: ReturnType<typeof globalThis.setInterval>) => void;
  randomInt?: (max: number) => number;
};

function scheduleBucket(at: Date, settings: ReminderSettings): string | undefined {
  const day = `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
  if (settings.schedule === 'interval') {
    const minutesSinceMidnight = at.getHours() * 60 + at.getMinutes();
    return `${day}-${Math.floor(minutesSinceMidnight / settings.intervalMinutes)}`;
  }
  if (settings.schedule === 'hourly') return at.getMinutes() === 0 ? `${day}-${at.getHours()}` : undefined;
  const [hour, minute] = settings.dailyTime.split(':').map(Number);
  return at.getHours() === hour && at.getMinutes() === minute ? `${day}-${settings.dailyTime}` : undefined;
}

function scheduleBucketStart(at: Date, settings: ReminderSettings): Date {
  let hour: number;
  let minute: number;
  if (settings.schedule === 'interval') {
    const bucketMinutes = Math.floor((at.getHours() * 60 + at.getMinutes()) / settings.intervalMinutes) * settings.intervalMinutes;
    hour = Math.floor(bucketMinutes / 60);
    minute = bucketMinutes % 60;
  } else if (settings.schedule === 'hourly') {
    hour = at.getHours();
    minute = 0;
  } else {
    [hour, minute] = settings.dailyTime.split(':').map(Number);
  }
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), hour, minute);
}

export function createFlipACoinScheduler({
  send,
  getSettings = () => [],
  intervalMs = 1_000,
  now = () => new Date(),
  setInterval: setIntervalFn = globalThis.setInterval,
  clearInterval: clearIntervalFn = globalThis.clearInterval,
  randomInt = (max) => cryptoRandomInt(max),
}: SchedulerOptions): FlipACoinScheduler {
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  const lastSentBuckets = new Map<string, string>();
  const nextMessageIndexes = new Map<string, number>();

  const sendForSettings = async (settings: ReminderRecord, advanceMessagePool = false) => {
    const messages = settings.messages?.length ? settings.messages : [settings.message];
    const messageIndex = settings.task === 'custom-message'
      ? (nextMessageIndexes.get(settings.id) ?? 0) % messages.length
      : 0;
    const message = settings.task === 'coin-flip'
      ? `I've flipped a coin, it's ${randomInt(2) === 0 ? 'heads' : 'tails'}`
      : messages[messageIndex];
    await send({ message });
    if (advanceMessagePool && settings.task === 'custom-message' && messages.length > 1) {
      nextMessageIndexes.set(settings.id, (messageIndex + 1) % messages.length);
    }
  };

  const tick = async (at: Date, startedAt?: Date) => {
    const input = await getSettings();
    const records = normalizeReminderRecords(input);
    let firstError: unknown;
    // A legacy single record is still accepted by normalizeReminderRecords.
    for (const settings of records) {
      if (!settings.enabled) continue;
      const currentBucket = scheduleBucket(at, settings);
      if (!currentBucket || currentBucket === lastSentBuckets.get(settings.id)) continue;
      if (startedAt && scheduleBucketStart(at, settings).getTime() <= startedAt.getTime()) continue;
      lastSentBuckets.set(settings.id, currentBucket);
      try {
        await sendForSettings(settings, true);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  };

  return {
    start() {
      if (timer !== undefined) return;
      const startedAt = now();
      timer = setIntervalFn(() => { void tick(now(), startedAt); }, intervalMs);
    },
    stop() {
      if (timer === undefined) return;
      clearIntervalFn(timer);
      timer = undefined;
    },
    tick,
    testNow: async (settings) => sendForSettings(normalizeReminderRecord(settings)),
  };
}
