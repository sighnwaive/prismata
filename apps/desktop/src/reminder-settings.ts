import { normalizeJoystickWhisperSettings } from './joystick-whisper-settings.js';
import { normalizeJoystickChatAutomationSettings } from './joystick-chat-automations.js';

export const reminderSchedules = ['interval', 'hourly', 'daily'] as const;
export type ReminderSchedule = typeof reminderSchedules[number];
export const reminderTasks = ['custom-message', 'coin-flip'] as const;
export type ReminderTask = typeof reminderTasks[number];
export const defaultIntervalMinutes = 5;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 59;
export type ReminderSettings = { enabled: boolean; task: ReminderTask; message: string; schedule: ReminderSchedule; intervalMinutes: number; dailyTime: string };
export type ReminderRecord = ReminderSettings & { id: string };

export const defaultReminderSettings: ReminderSettings = {
  enabled: true,
  task: 'custom-message',
  message: 'Flip a Coin',
  schedule: 'hourly',
  intervalMinutes: defaultIntervalMinutes,
  dailyTime: '09:00',
};

export const defaultReminderRecord: ReminderRecord = { id: 'default-reminder', ...defaultReminderSettings };

export function normalizeReminderSettings(value: unknown): ReminderSettings {
  const source = value && typeof value === 'object' ? value as Partial<ReminderSettings> : {};
  const task = reminderTasks.includes(source.task as ReminderTask) ? source.task as ReminderTask : defaultReminderSettings.task;
  const legacySchedule = (source as Record<string, unknown>).schedule;
  const schedule = legacySchedule === 'every-5-minutes' ? 'interval' : reminderSchedules.includes(source.schedule as ReminderSchedule) ? source.schedule as ReminderSchedule : defaultReminderSettings.schedule;
  const intervalMinutes = Number.isInteger(source.intervalMinutes) && (source.intervalMinutes as number) >= MIN_INTERVAL_MINUTES && (source.intervalMinutes as number) <= MAX_INTERVAL_MINUTES ? source.intervalMinutes as number : defaultIntervalMinutes;
  const dailyTime = typeof source.dailyTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(source.dailyTime) ? source.dailyTime : defaultReminderSettings.dailyTime;
  const message = typeof source.message === 'string' && source.message.trim() ? source.message : defaultReminderSettings.message;
  return { enabled: source.enabled !== false, task, message, schedule, intervalMinutes, dailyTime };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function safeId(value: unknown, fallback: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && /^[a-zA-Z0-9_-]+$/.test(id) ? id : fallback;
}

export function normalizeReminderRecord(value: unknown, fallbackId = 'reminder'): ReminderRecord {
  const source = objectValue(value);
  return { id: safeId(source.id, fallbackId), ...normalizeReminderSettings(source) };
}

export function normalizeReminderRecords(value: unknown): ReminderRecord[] {
  const source = objectValue(value);
  const raw = Array.isArray(value) ? value : Array.isArray(source.reminders) ? source.reminders : undefined;
  const legacy = source.reminder;
  const looksLikeRecord = 'task' in source || 'schedule' in source || 'dailyTime' in source || 'enabled' in source;
  const values = raw ?? (legacy !== undefined ? [legacy] : looksLikeRecord ? [source] : []);
  const used = new Set<string>();
  return values.filter((item) => item && typeof item === 'object').map((item, index) => {
    const base = normalizeReminderRecord(item, raw ? `reminder-${index + 1}` : 'legacy-reminder');
    let id = base.id;
    let suffix = 2;
    while (used.has(id)) id = `${base.id}-${suffix++}`;
    used.add(id);
    return { ...base, id };
  });
}

/** Normalizes only the reminder portion while preserving every unrelated setting. */
export function normalizePersistedSettings(value: unknown): Record<string, unknown> {
  const source = objectValue(value);
  const records = normalizeReminderRecords(source);
  const settings: Record<string, unknown> = !records.length && !('reminders' in source) && !('reminder' in source)
    ? { ...source }
    : { ...source, reminders: records };
  if ('joystickWhispers' in source) {
    settings.joystickWhispers = normalizeJoystickWhisperSettings(source.joystickWhispers);
  }
  if ('joystickChatAutomations' in source) {
    settings.joystickChatAutomations = normalizeJoystickChatAutomationSettings(source.joystickChatAutomations);
  }
  return settings;
}
