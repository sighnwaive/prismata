import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_PREFIX = 'joystick-events-';
type EventLogAppender = (file: string, content: string, options: { encoding: 'utf8'; mode: number }) => Promise<unknown>;

function readNow(now: () => Date): Date {
  try {
    const value = now();
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  } catch {
    // A clock failure must not interrupt event consumers.
  }
  return new Date();
}

function isCalendarDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function createJoystickEventLogger(input: {
  userDataPath: string;
  isDevelopment: boolean;
  now?: () => Date;
  appendFile?: EventLogAppender;
}) {
  const logsPath = join(input.userDataPath, 'logs');
  const now = input.now ?? (() => new Date());
  const append = input.appendFile ?? appendFile;
  let writeQueue: Promise<void> = Promise.resolve();

  function getLogFilePath(receivedAt: Date): string {
    return join(logsPath, `${FILE_PREFIX}${receivedAt.toISOString().slice(0, 10)}.jsonl`);
  }

  async function pruneExpired(): Promise<void> {
    if (!input.isDevelopment) return;

    try {
      await mkdir(logsPath, { recursive: true, mode: 0o700 });
      const cutoffTime = readNow(now).getTime() - RETENTION_DAYS * DAY_MS;
      const entries = await readdir(logsPath, { withFileTypes: true });
      await Promise.all(entries.map(async (entry) => {
        if (!entry.isFile()) return;
        const match = /^joystick-events-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(entry.name);
        const fileDate = match?.[1];
        if (!fileDate || !isCalendarDate(fileDate) || Date.parse(`${fileDate}T00:00:00.000Z`) >= cutoffTime) return;
        try {
          await unlink(join(logsPath, entry.name));
        } catch {
          // Retention cleanup is best effort and never affects event handling.
        }
      }));
    } catch {
      // Diagnostic storage is optional; never report filesystem errors with event context.
    }
  }

  async function write(event: unknown): Promise<void> {
    if (!input.isDevelopment) return;

    let receivedAt: Date;
    let record: string | undefined;
    let file: string;
    try {
      receivedAt = readNow(now);
      record = JSON.stringify({ receivedAt: receivedAt.toISOString(), event });
      file = getLogFilePath(receivedAt);
    } catch {
      // Event serialization failures must not affect downstream consumers.
      return;
    }
    if (typeof record !== 'string') return;

    const pending = writeQueue.then(async () => {
      try {
        await mkdir(logsPath, { recursive: true, mode: 0o700 });
        await append(file, `${record}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
      } catch {
        // Do not log diagnostic failures: they can be caused by sensitive event data.
      }
    });
    writeQueue = pending;
    await pending;
  }

  async function flush(): Promise<void> {
    await writeQueue;
  }

  return {
    async start(): Promise<void> {
      await pruneExpired();
    },
    getCurrentLogFilePath(): string | undefined {
      if (!input.isDevelopment) return undefined;
      return getLogFilePath(readNow(now));
    },
    write,
    flush,
    pruneExpired,
  };
}
