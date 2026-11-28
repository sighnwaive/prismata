import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOG_FILE_NAME = 'application-errors.jsonl';
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 12_000;
const MAX_CONTEXT_VALUE_LENGTH = 2_000;
const MAX_CONTEXT_METADATA_LENGTH = 64;

export type SupportLogOperation =
  | 'auth.sign-in'
  | 'auth.sign-out'
  | 'admin.set-lan-enabled'
  | 'admin.set-advertised-address'
  | 'joystick-whispers.save-settings'
  | 'joystick-chat-automations.save-drop-in'
  | 'joystick-chat-automations.save-slash-command'
  | 'todos.save'
  | 'reminders.save';

export type SupportLogInputField =
  | 'whisper-message'
  | 'drop-in-message'
  | 'slash-command-response'
  | 'todo-note'
  | 'reminder-message';

export type SupportLogApplicationState =
  | 'offline'
  | 'signed-out'
  | 'opening-browser'
  | 'waiting-for-callback'
  | 'authenticated'
  | 'failure'
  | 'enabled'
  | 'disabled';

export type SupportLogContext = {
  operation: SupportLogOperation;
  errorName?: string;
  errorCode?: string;
  appState?: SupportLogApplicationState;
  inputField?: SupportLogInputField;
  inputValue?: string;
};

export type SupportLogErrorReport = {
  source: 'main' | 'renderer';
  message: string;
  stack?: string;
  context?: SupportLogContext;
};

export type SupportLogServiceOptions = {
  userDataPath: string;
  downloadsPath: string;
  now?: () => Date;
};

function readNow(now: () => Date): Date {
  try {
    const value = now();
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  } catch {
    // Logging must not depend on the injected clock succeeding.
  }
  return new Date();
}

function redactSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(authorization|authorization[_-]?(?:code|state)|access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|password|oauth[_-]?(?:code|state)|auth[_-]?(?:code|state)|pairing[_-]?code|code[_-]?verifier|verifier|credentials?|code|state)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|password|oauth[_-]?code|oauth[_-]?state|auth[_-]?code|auth[_-]?state|pairing[_-]?code|code[_-]?verifier|verifier|credentials?|code|state)=)[^&#\s]*/gi, '$1[REDACTED]');
}

const APP_STATES = new Set<SupportLogApplicationState>([
  'offline',
  'signed-out',
  'opening-browser',
  'waiting-for-callback',
  'authenticated',
  'failure',
  'enabled',
  'disabled',
]);

const INPUT_FIELDS_BY_OPERATION: Record<SupportLogOperation, readonly SupportLogInputField[]> = {
  'auth.sign-in': [],
  'auth.sign-out': [],
  'admin.set-lan-enabled': [],
  'admin.set-advertised-address': [],
  'joystick-whispers.save-settings': ['whisper-message'],
  'joystick-chat-automations.save-drop-in': ['drop-in-message'],
  'joystick-chat-automations.save-slash-command': ['slash-command-response'],
  'todos.save': ['todo-note'],
  'reminders.save': ['reminder-message'],
};

const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SAFE_ERROR_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

function isSupportLogOperation(value: unknown): value is SupportLogOperation {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(INPUT_FIELDS_BY_OPERATION, value);
}

function sanitizeErrorMetadata(value: unknown, pattern: RegExp): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = redactSecrets(value.slice(0, MAX_CONTEXT_METADATA_LENGTH * 2))
    .slice(0, MAX_CONTEXT_METADATA_LENGTH);
  return pattern.test(sanitized) ? sanitized : undefined;
}

/**
 * Projects untrusted context onto the small, explicitly supported support-log schema.
 * Unknown keys and nested objects are never copied.
 */
export function sanitizeSupportLogContext(input: unknown): SupportLogContext | undefined {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
    const candidate = input as Record<string, unknown>;
    if (!isSupportLogOperation(candidate.operation)) return undefined;

    const context: SupportLogContext = { operation: candidate.operation };
    const errorName = sanitizeErrorMetadata(candidate.errorName, SAFE_ERROR_NAME);
    const errorCode = sanitizeErrorMetadata(candidate.errorCode, SAFE_ERROR_CODE);
    if (errorName) context.errorName = errorName;
    if (errorCode) context.errorCode = errorCode;
    if (typeof candidate.appState === 'string' && APP_STATES.has(candidate.appState as SupportLogApplicationState)) {
      context.appState = candidate.appState as SupportLogApplicationState;
    }

    const allowedFields = INPUT_FIELDS_BY_OPERATION[candidate.operation];
    if (typeof candidate.inputField === 'string'
      && allowedFields.includes(candidate.inputField as SupportLogInputField)
      && typeof candidate.inputValue === 'string') {
      const value = redactSecrets(candidate.inputValue.slice(0, MAX_CONTEXT_VALUE_LENGTH * 2))
        .slice(0, MAX_CONTEXT_VALUE_LENGTH);
      context.inputField = candidate.inputField as SupportLogInputField;
      context.inputValue = value;
    }
    return context;
  } catch {
    // A malformed renderer report must not prevent safe error persistence.
    return undefined;
  }
}

function normalizeReport(input: SupportLogErrorReport): SupportLogErrorReport {
  if (!input || (input.source !== 'main' && input.source !== 'renderer') || typeof input.message !== 'string') {
    throw new TypeError('Invalid support-log error report');
  }
  const message = redactSecrets(input.message.slice(0, MAX_MESSAGE_LENGTH * 2)).slice(0, MAX_MESSAGE_LENGTH);
  const stack = typeof input.stack === 'string'
    ? redactSecrets(input.stack.slice(0, MAX_STACK_LENGTH * 2)).slice(0, MAX_STACK_LENGTH)
    : undefined;
  const context = sanitizeSupportLogContext(input.context);
  return {
    source: input.source,
    message: message || 'Application error',
    ...(stack ? { stack } : {}),
    ...(context ? { context } : {}),
  };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(contents: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of contents) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function createSingleFileZip(fileName: string, contents: Buffer, date: Date): Buffer {
  const name = Buffer.from(fileName, 'utf8');
  const checksum = crc32(contents);
  const { date: zipDate, time: zipTime } = dosDateTime(date);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(zipTime, 10);
  localHeader.writeUInt16LE(zipDate, 12);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(contents.length, 18);
  localHeader.writeUInt32LE(contents.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(zipTime, 12);
  centralHeader.writeUInt16LE(zipDate, 14);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(contents.length, 20);
  centralHeader.writeUInt32LE(contents.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const centralDirectory = Buffer.concat([centralHeader, name]);
  const localFile = Buffer.concat([localHeader, name, contents]);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localFile.length, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([localFile, centralDirectory, endRecord]);
}

export function createSupportLogService(options: SupportLogServiceOptions) {
  if (!options || typeof options.userDataPath !== 'string' || !options.userDataPath
    || typeof options.downloadsPath !== 'string' || !options.downloadsPath) {
    throw new TypeError('Support-log storage paths are required');
  }

  const logsPath = join(options.userDataPath, 'logs');
  const logFilePath = join(logsPath, LOG_FILE_NAME);
  const now = options.now ?? (() => new Date());
  let writeQueue: Promise<void> = Promise.resolve();

  function reportError(input: SupportLogErrorReport): Promise<void> {
    const receivedAt = readNow(now);
    const report = normalizeReport(input);
    const line = `${JSON.stringify({ receivedAt: receivedAt.toISOString(), ...report })}\n`;
    const pending = writeQueue.then(async () => {
      await mkdir(logsPath, { recursive: true, mode: 0o700 });
      let existing = '';
      try {
        existing = await readFile(logFilePath, 'utf8');
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code !== 'ENOENT') throw cause;
      }

      const lineBytes = Buffer.byteLength(line);
      const maxExistingBytes = Math.max(0, MAX_LOG_BYTES - lineBytes);
      let existingBytes = Buffer.from(existing);
      if (existingBytes.length > maxExistingBytes) {
        const tail = existingBytes.subarray(existingBytes.length - maxExistingBytes).toString('utf8');
        const nextLine = tail.indexOf('\n');
        existing = nextLine < 0 ? '' : tail.slice(nextLine + 1);
      }
      await writeFile(logFilePath, `${existing}${line}`, { encoding: 'utf8', mode: 0o600 });
    });
    writeQueue = pending.catch(() => {});
    return pending;
  }

  function exportLogs(): Promise<void> {
    const pending = writeQueue.then(async () => {
      await mkdir(logsPath, { recursive: true, mode: 0o700 });
      let contents: Buffer;
      try {
        contents = await readFile(logFilePath);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code !== 'ENOENT') throw cause;
        contents = Buffer.alloc(0);
        await writeFile(logFilePath, contents, { mode: 0o600 });
      }

      await mkdir(options.downloadsPath, { recursive: true, mode: 0o700 });
      const exportedAt = readNow(now);
      const timestamp = exportedAt.toISOString().replace(/[:.]/g, '-');
      const archiveName = `prismata-error-logs-${timestamp}-${randomUUID().slice(0, 8)}.zip`;
      const archive = createSingleFileZip(LOG_FILE_NAME, contents, exportedAt);
      const archivePath = join(options.downloadsPath, archiveName);
      const temporaryPath = join(options.downloadsPath, `.${archiveName}.tmp`);
      try {
        await writeFile(temporaryPath, archive, { flag: 'wx', mode: 0o600 });
        await rename(temporaryPath, archivePath);
      } catch (cause) {
        await unlink(temporaryPath).catch(() => {});
        throw cause;
      }
    });
    writeQueue = pending.catch(() => {});
    return pending;
  }

  return { reportError, exportLogs };
}
