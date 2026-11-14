import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { normalizePersistedSettings } from './reminder-settings.js';

export type SettingsSnapshot = { settings: Record<string, unknown>; revision: number; updatedAt: string; origin: string };
export type DeviceRecord = { deviceId: string; deviceName: string; publicKey: string; createdAt: string; revokedAt?: string; lastSeenAt?: string };
export type SessionMetadata = { sessionId: string; deviceId: string; refreshHash: string; expiresAt: string; createdAt?: string; revokedAt?: string };
export type ConnectionRequestRecord = { requestId: string; deviceId: string; deviceName: string; publicKey: string; requestProofHash?: string; codeHash: string; expiresAt: string; status: 'pending' | 'approved' | 'expired' | 'rejected' | 'consumed'; attempts: number; createdAt: string; approvedAt?: string };
export type JoystickWhisperRuleName = 'followed' | 'subscribed' | 'resubscribed' | 'giftSender';
export type JoystickWhisperAttempt = { eventId: string; rule: JoystickWhisperRuleName; recipient: string; attemptedAt: string };
export type SourceLabel = 'Manual' | 'Tips' | 'Wheel spin' | 'Goal completion' | 'Drop In';
export type TodoRecord = { id: string; itemName: string; viewer?: string; note?: string; tokenAmount?: number; occurredAt?: string; createdAt: string; completedAt?: string; source?: SourceLabel };
export type TodoInput = { itemName: unknown; viewer?: unknown; note?: unknown };
export type JoystickTodoEventInput = { eventId: string; itemName: string; viewer?: string; tokenAmount?: number; occurredAt?: string; source?: SourceLabel };
export type TipHistoryRecord = { eventId: string; title: string; viewer?: string; amount?: number; occurredAt?: string; source?: SourceLabel };

const SCHEMA_VERSION = 9;
const EPOCH = new Date(0).toISOString();
const WHISPER_ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TODO_COMPLETION_RETENTION_MS = 30_000;
const JOYSTICK_TODO_EVENT_ID_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TODO_ITEM_NAME_MAX_LENGTH = 200;
const TODO_VIEWER_MAX_LENGTH = 100;
const TODO_NOTE_MAX_LENGTH = 2_000;
const JOYSTICK_TODO_EVENT_ID_MAX_LENGTH = 512;

export async function createLocalStore(file: string, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const legacy = file !== ':memory:' ? readLegacyState(file) : undefined;
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  migrate(db, legacy);
  const storedSettings = db.prepare('SELECT value FROM settings WHERE id = 1').get() as { value: string };
  const normalizedSettings = normalizePersistedSettings(JSON.parse(storedSettings.value));
  if (JSON.stringify(normalizedSettings) !== storedSettings.value) {
    db.prepare('UPDATE settings SET value = ? WHERE id = 1').run(JSON.stringify(normalizedSettings));
  }
  db.prepare("UPDATE connection_requests SET status = 'expired' WHERE status = 'pending'").run();
  const startupTime = readNow(now);
  pruneExpiredTodos(db, startupTime);
  pruneJoystickTodoEventIds(db, startupTime);

  const getSettings = (): SettingsSnapshot => {
    const row = db.prepare('SELECT value, revision, updated_at AS updatedAt, origin FROM settings WHERE id = 1').get() as { value: string; revision: number; updatedAt: string; origin: string };
    return { settings: JSON.parse(row.value) as Record<string, unknown>, revision: row.revision, updatedAt: row.updatedAt, origin: row.origin };
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    async getSettings() { return getSettings(); },
    async updateSettings(settings: Record<string, unknown>, origin: string, baseRevision?: number) {
      const normalizedSettings = normalizePersistedSettings(settings);
      const result = db.transaction(() => db.prepare(`UPDATE settings SET value = ?, revision = revision + 1, updated_at = ?, origin = ? WHERE id = 1 AND (? IS NULL OR revision = ?)`).run(JSON.stringify(normalizedSettings), new Date().toISOString(), origin, baseRevision ?? null, baseRevision ?? null))();
      if (result.changes !== 1) throw new Error('settings conflict');
      return getSettings();
    },
    async listDevices() { return db.prepare('SELECT device_id AS deviceId, device_name AS deviceName, public_key AS publicKey, created_at AS createdAt, revoked_at AS revokedAt, last_seen_at AS lastSeenAt FROM devices WHERE revoked_at IS NULL').all() as DeviceRecord[]; },
    async addDevice(device: DeviceRecord) {
      db.transaction(() => db.prepare(`INSERT INTO devices (device_id, device_name, public_key, created_at, revoked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET device_name = excluded.device_name, public_key = excluded.public_key, created_at = excluded.created_at, revoked_at = excluded.revoked_at, last_seen_at = excluded.last_seen_at`).run(device.deviceId, device.deviceName, device.publicKey, device.createdAt, device.revokedAt ?? null, device.lastSeenAt ?? null))();
      return { ...device };
    },
    async heartbeatDevice(deviceId: string) {
      return db.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), deviceId).changes === 1;
    },
    async revokeDevice(deviceId: string) {
      return db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), deviceId).changes === 1;
    },
    async savePairingChallenge(challenge: string, expiresAt: string) {
      db.prepare('INSERT INTO pairing_challenges (challenge, expires_at) VALUES (?, ?) ON CONFLICT(challenge) DO UPDATE SET expires_at = excluded.expires_at').run(challenge, expiresAt);
    },
    async getPairingChallenge(challenge: string) {
      return (db.prepare('SELECT expires_at AS expiresAt FROM pairing_challenges WHERE challenge = ?').get(challenge) as { expiresAt: string } | undefined)?.expiresAt;
    },
    async deletePairingChallenge(challenge: string) { db.prepare('DELETE FROM pairing_challenges WHERE challenge = ?').run(challenge); },
    async saveConnectionRequest(request: ConnectionRequestRecord) {
      db.prepare(`INSERT INTO connection_requests (request_id, device_id, device_name, public_key, request_proof_hash, code_hash, expires_at, status, attempts, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(request.requestId, request.deviceId, request.deviceName, request.publicKey, request.requestProofHash ?? '', request.codeHash, request.expiresAt, request.status, request.attempts, request.createdAt, request.approvedAt ?? null);
    },
     async getConnectionRequest(requestId: string) { return db.prepare('SELECT request_id AS requestId, device_id AS deviceId, device_name AS deviceName, public_key AS publicKey, request_proof_hash AS requestProofHash, code_hash AS codeHash, expires_at AS expiresAt, status, attempts, created_at AS createdAt, approved_at AS approvedAt FROM connection_requests WHERE request_id = ?').get(requestId) as ConnectionRequestRecord | undefined; },
     async listConnectionRequests() { return db.prepare('SELECT request_id AS requestId, device_id AS deviceId, device_name AS deviceName, public_key AS publicKey, request_proof_hash AS requestProofHash, code_hash AS codeHash, expires_at AS expiresAt, status, attempts, created_at AS createdAt, approved_at AS approvedAt FROM connection_requests WHERE status = ? ORDER BY created_at DESC').all('pending') as ConnectionRequestRecord[]; },
      async updateConnectionRequest(requestId: string, values: { status?: ConnectionRequestRecord['status']; attempts?: number; approvedAt?: string }) { db.prepare('UPDATE connection_requests SET status = COALESCE(?, status), attempts = COALESCE(?, attempts), approved_at = COALESCE(?, approved_at) WHERE request_id = ?').run(values.status ?? null, values.attempts ?? null, values.approvedAt ?? null, requestId); },
      async approveConnectionRequest(requestId: string, codeHash: string, approvedAt: string) { return db.prepare("UPDATE connection_requests SET status = 'approved', approved_at = ? WHERE request_id = ? AND status = 'pending' AND attempts < 5 AND code_hash = ?").run(approvedAt, requestId, codeHash).changes === 1; },
      async claimConnectionRequest(requestId: string) { return db.prepare("UPDATE connection_requests SET status = 'consumed' WHERE request_id = ? AND status = 'approved'").run(requestId).changes === 1; },
      async rollbackConnectionRequestClaim(requestId: string) { return db.prepare("UPDATE connection_requests SET status = 'approved' WHERE request_id = ? AND status = 'consumed'").run(requestId).changes === 1; },
    async recordConnectionAttempt(requestId: string) { return db.prepare("UPDATE connection_requests SET attempts = attempts + 1 WHERE request_id = ? AND status = 'pending' AND attempts < 5").run(requestId).changes === 1; },
    async claimWhisperAttempt(attempt: JoystickWhisperAttempt) {
      if (typeof attempt.eventId !== 'string' || attempt.eventId.trim() === '') throw new TypeError('eventId is required');
      if (!['followed', 'subscribed', 'resubscribed', 'giftSender'].includes(attempt.rule)) throw new TypeError('unknown whisper rule');
      if (typeof attempt.recipient !== 'string' || attempt.recipient.trim() === '') throw new TypeError('recipient is required');
      const attemptedAt = new Date(attempt.attemptedAt);
      if (!Number.isFinite(attemptedAt.getTime())) throw new TypeError('attemptedAt must be a valid date');
      const result = db.prepare(`INSERT INTO joystick_whisper_attempts (event_id, rule, normalized_recipient, attempted_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(event_id, rule, normalized_recipient) DO NOTHING`)
        .run(attempt.eventId, attempt.rule, attempt.recipient.trim().toLowerCase(), attemptedAt.toISOString());
      return result.changes === 1;
    },
    async pruneWhisperAttempts(now: number) {
      if (!Number.isFinite(now)) throw new TypeError('now must be a finite timestamp');
      const cutoff = new Date(now - WHISPER_ATTEMPT_RETENTION_MS).toISOString();
      return db.prepare('DELETE FROM joystick_whisper_attempts WHERE attempted_at < ?').run(cutoff).changes;
    },
    async addTodo(input: TodoInput): Promise<TodoRecord> {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('TODO input must be an object');
      const itemName = normalizeTodoText(input.itemName, 'item name', TODO_ITEM_NAME_MAX_LENGTH, true)!;
      const viewer = normalizeTodoText(input.viewer, 'viewer', TODO_VIEWER_MAX_LENGTH, false);
      const note = normalizeTodoText(input.note, 'note', TODO_NOTE_MAX_LENGTH, false);
      const createdAt = new Date(readNow(now)).toISOString();
      const todo: TodoRecord = { id: randomUUID(), itemName, ...(viewer ? { viewer } : {}), ...(note ? { note } : {}), createdAt, source: 'Manual' };
      db.prepare('INSERT INTO todos (id, item_name, viewer, note, created_at, completed_at, source) VALUES (?, ?, ?, ?, ?, NULL, ?)')
        .run(todo.id, todo.itemName, todo.viewer ?? null, todo.note ?? null, todo.createdAt, todo.source);
      return todo;
    },
    async updateTodo(id: string, input: TodoInput): Promise<boolean> {
      if (typeof id !== 'string' || id.trim() === '') throw new TypeError('TODO ID is required');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('TODO input must be an object');
      const itemName = normalizeTodoText(input.itemName, 'item name', TODO_ITEM_NAME_MAX_LENGTH, true)!;
      const viewer = normalizeTodoText(input.viewer, 'viewer', TODO_VIEWER_MAX_LENGTH, false);
      const note = normalizeTodoText(input.note, 'note', TODO_NOTE_MAX_LENGTH, false);
      return db.prepare(`UPDATE todos SET item_name = ?, viewer = ?, note = ?
        WHERE id = ? AND source = 'Manual' AND completed_at IS NULL`)
        .run(itemName, viewer ?? null, note ?? null, id.trim()).changes === 1;
    },
    async createJoystickTodoFromEvent(input: JoystickTodoEventInput): Promise<TodoRecord | null> {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Joystick TODO event input must be an object');
      const eventId = normalizeJoystickTodoEventId(input.eventId);
      const itemName = normalizeTodoText(input.itemName, 'item name', TODO_ITEM_NAME_MAX_LENGTH, true)!;
      const viewer = normalizeTodoText(input.viewer, 'viewer', TODO_VIEWER_MAX_LENGTH, false);
      const tokenAmount = normalizeTodoTokenAmount(input.tokenAmount);
      const occurredAt = normalizeTodoOccurredAt(input.occurredAt);
      const source = normalizeSourceLabel(input.source);
      const createdAtMs = readNow(now);
      const createdAt = new Date(createdAtMs).toISOString();
      const todo: TodoRecord = {
        id: randomUUID(), itemName, ...(viewer ? { viewer } : {}),
        ...(tokenAmount !== undefined ? { tokenAmount } : {}), ...(occurredAt ? { occurredAt } : {}), createdAt,
        ...(source ? { source } : {}),
      };
      return db.transaction(() => {
        if (!claimJoystickTodoEventIdInTransaction(db, eventId, createdAtMs)) return null;
        db.prepare('INSERT INTO todos (id, item_name, viewer, note, token_amount, occurred_at, created_at, completed_at, source) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?)')
          .run(todo.id, todo.itemName, todo.viewer ?? null, todo.tokenAmount ?? null, todo.occurredAt ?? null, todo.createdAt, todo.source ?? null);
        return todo;
      })();
    },
    async listTodos(): Promise<TodoRecord[]> {
      const currentTime = readNow(now);
      pruneExpiredTodos(db, currentTime);
      return db.prepare(`SELECT id, item_name AS itemName, viewer, note, token_amount AS tokenAmount, occurred_at AS occurredAt, created_at AS createdAt, completed_at AS completedAt, source
        FROM todos WHERE completed_at IS NULL OR completed_at > ? ORDER BY created_at, id`)
        .all(new Date(currentTime - TODO_COMPLETION_RETENTION_MS).toISOString())
        .map(mapTodoRecord);
    },
    async recordTipHistory(input: TipHistoryRecord): Promise<TipHistoryRecord | null> {
      const entry = normalizeTipHistoryRecord(input);
      const result = db.prepare(`INSERT INTO tip_history (event_id, title, viewer, amount, occurred_at, source)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING`)
        .run(entry.eventId, entry.title, entry.viewer ?? null, entry.amount ?? null, entry.occurredAt ?? null, entry.source ?? null);
      return result.changes === 1 ? entry : null;
    },
    async listTipHistory(): Promise<TipHistoryRecord[]> {
      return db.prepare(`SELECT event_id AS eventId, title, viewer, amount, occurred_at AS occurredAt, source
        FROM tip_history ORDER BY occurred_at DESC, event_id`).all().map(mapTipHistoryRecord);
    },
    async completeTodo(id: string): Promise<boolean> {
      const completedAt = new Date(readNow(now)).toISOString();
      return db.prepare('UPDATE todos SET completed_at = ? WHERE id = ? AND completed_at IS NULL').run(completedAt, id).changes === 1;
    },
    async undoCompleteTodo(id: string): Promise<boolean> {
      const cutoff = new Date(readNow(now) - TODO_COMPLETION_RETENTION_MS).toISOString();
      return db.prepare('UPDATE todos SET completed_at = NULL WHERE id = ? AND completed_at IS NOT NULL AND completed_at > ?').run(id, cutoff).changes === 1;
    },
    async removeTodo(id: string): Promise<boolean> {
      const cutoff = new Date(readNow(now) - TODO_COMPLETION_RETENTION_MS).toISOString();
      return db.prepare('DELETE FROM todos WHERE id = ? AND completed_at IS NOT NULL AND completed_at > ?').run(id, cutoff).changes === 1;
    },
    async claimJoystickTodoEventId(eventId: string): Promise<boolean> {
      eventId = normalizeJoystickTodoEventId(eventId);
      const claimedAt = readNow(now);
      const claim = db.transaction(() => claimJoystickTodoEventIdInTransaction(db, eventId, claimedAt));
      return claim();
    },
    async saveSession(session: SessionMetadata) {
      db.prepare(`INSERT INTO sessions (session_id, device_id, refresh_hash, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET device_id = excluded.device_id, refresh_hash = excluded.refresh_hash, expires_at = excluded.expires_at, created_at = excluded.created_at, revoked_at = excluded.revoked_at`).run(session.sessionId, session.deviceId, session.refreshHash, session.expiresAt, session.createdAt ?? new Date().toISOString(), session.revokedAt ?? null);
    },
    async getSession(sessionId: string) {
      return db.prepare('SELECT session_id AS sessionId, device_id AS deviceId, refresh_hash AS refreshHash, expires_at AS expiresAt, created_at AS createdAt, revoked_at AS revokedAt FROM sessions WHERE session_id = ? AND revoked_at IS NULL').get(sessionId) as SessionMetadata | undefined;
    },
    async getSessionByRefreshHash(refreshHash: string) {
      return db.prepare('SELECT session_id AS sessionId, device_id AS deviceId, refresh_hash AS refreshHash, expires_at AS expiresAt, created_at AS createdAt, revoked_at AS revokedAt FROM sessions WHERE refresh_hash = ? AND revoked_at IS NULL').get(refreshHash) as SessionMetadata | undefined;
    },
    async deleteSession(sessionId: string) { db.prepare('UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), sessionId); },
    async revokeSessionsForDevice(deviceId: string) { db.prepare('UPDATE sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), deviceId); },
    async pragma(name: 'journal_mode' | 'synchronous') { return String(db.pragma(name, { simple: true })); },
    close() { db.close(); },
  };
}

function normalizeTodoText(value: unknown, label: string, maxLength: number, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) throw new TypeError(`${label} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
  if (value.length > maxLength) throw new TypeError(`${label} must be ${maxLength} characters or fewer`);
  const normalized = value.trim();
  if (!normalized) {
    if (required) throw new TypeError(`${label} is required`);
    return undefined;
  }
  return normalized;
}

function normalizeJoystickTodoEventId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('eventId is required');
  const eventId = value.trim();
  if (eventId.length > JOYSTICK_TODO_EVENT_ID_MAX_LENGTH) throw new TypeError(`eventId must be ${JOYSTICK_TODO_EVENT_ID_MAX_LENGTH} characters or fewer`);
  return eventId;
}

function normalizeTodoTokenAmount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
    ? value : undefined;
}

function normalizeTodoOccurredAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : undefined;
}

function normalizeTipHistoryRecord(input: TipHistoryRecord): TipHistoryRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Tip history input must be an object');
  const eventId = normalizeJoystickTodoEventId(input.eventId);
  const title = normalizeTodoText(input.title, 'tip title', TODO_ITEM_NAME_MAX_LENGTH, true)!;
  const viewer = normalizeTodoText(input.viewer, 'viewer', TODO_VIEWER_MAX_LENGTH, false);
  const amount = normalizeTodoTokenAmount(input.amount);
  const occurredAt = normalizeTodoOccurredAt(input.occurredAt);
  const source = normalizeSourceLabel(input.source);
  return {
    eventId,
    title,
    ...(viewer ? { viewer } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    ...(source ? { source } : {}),
  };
}

function mapTipHistoryRecord(row: unknown): TipHistoryRecord {
  const entry = row as { eventId: string; title: string; viewer: string | null; amount: number | null; occurredAt: string | null; source: unknown };
  const source = normalizeSourceLabel(entry.source);
  return {
    eventId: entry.eventId,
    title: entry.title,
    ...(entry.viewer === null ? {} : { viewer: entry.viewer }),
    ...(entry.amount === null ? {} : { amount: entry.amount }),
    ...(entry.occurredAt === null ? {} : { occurredAt: entry.occurredAt }),
    ...(source ? { source } : {}),
  };
}

function mapTodoRecord(row: unknown): TodoRecord {
  const todo = row as { id: string; itemName: string; viewer: string | null; note: string | null; tokenAmount: number | null; occurredAt: string | null; createdAt: string; completedAt: string | null; source: unknown };
  const source = normalizeSourceLabel(todo.source);
  return {
    id: todo.id,
    itemName: todo.itemName,
    ...(todo.viewer === null ? {} : { viewer: todo.viewer }),
    ...(todo.note === null ? {} : { note: todo.note }),
    ...(todo.tokenAmount === null ? {} : { tokenAmount: todo.tokenAmount }),
    ...(todo.occurredAt === null ? {} : { occurredAt: todo.occurredAt }),
    createdAt: todo.createdAt,
    ...(todo.completedAt === null ? {} : { completedAt: todo.completedAt }),
    ...(source ? { source } : {}),
  };
}

function normalizeSourceLabel(value: unknown): SourceLabel | undefined {
  return value === 'Manual' || value === 'Tips' || value === 'Wheel spin' || value === 'Goal completion' || value === 'Drop In'
    ? value : undefined;
}

function readNow(now: () => number): number {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('now must return a finite timestamp');
  return timestamp;
}

function pruneExpiredTodos(db: Database.Database, now: number): void {
  db.prepare('DELETE FROM todos WHERE completed_at IS NOT NULL AND completed_at <= ?')
    .run(new Date(now - TODO_COMPLETION_RETENTION_MS).toISOString());
}

function pruneJoystickTodoEventIds(db: Database.Database, now: number): void {
  db.prepare('DELETE FROM joystick_todo_event_ids WHERE claimed_at <= ?')
    .run(new Date(now - JOYSTICK_TODO_EVENT_ID_RETENTION_MS).toISOString());
}

function claimJoystickTodoEventIdInTransaction(db: Database.Database, eventId: string, claimedAt: number): boolean {
  pruneJoystickTodoEventIds(db, claimedAt);
  return db.prepare('INSERT INTO joystick_todo_event_ids (event_id, claimed_at) VALUES (?, ?) ON CONFLICT(event_id) DO NOTHING')
    .run(eventId, new Date(claimedAt).toISOString()).changes === 1;
}

type LegacyState = { settings?: SettingsSnapshot; devices?: DeviceRecord[] };

function readLegacyState(file: string): LegacyState | undefined {
  const legacyFile = existsSync(file) ? file : file.endsWith('.sqlite') && existsSync(file.replace(/\.sqlite$/, '.json')) ? file.replace(/\.sqlite$/, '.json') : undefined;
  if (!legacyFile) return undefined;
  const header = readFileSync(legacyFile).subarray(0, 16).toString();
  if (header === 'SQLite format 3\u0000') return undefined;
  const legacy = JSON.parse(readFileSync(legacyFile, 'utf8')) as LegacyState;
  renameSync(legacyFile, `${legacyFile}.json-v1`);
  return legacy;
}

function migrate(db: Database.Database, legacy?: LegacyState) {
  const version = Number(db.pragma('user_version', { simple: true }));
  if (version < 1) {
    db.exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, origin TEXT NOT NULL);
      CREATE TABLE devices (device_id TEXT PRIMARY KEY, device_name TEXT NOT NULL, public_key TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, last_seen_at TEXT);
      INSERT INTO settings VALUES (1, '{}', 0, '${EPOCH}', 'desktop');
      PRAGMA user_version = 1;`);
    if (legacy?.settings) db.prepare('UPDATE settings SET value = ?, revision = ?, updated_at = ?, origin = ? WHERE id = 1').run(JSON.stringify(legacy.settings.settings), legacy.settings.revision, legacy.settings.updatedAt, legacy.settings.origin);
    for (const device of legacy?.devices ?? []) db.prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?, ?)').run(device.deviceId, device.deviceName, device.publicKey, device.createdAt, device.revokedAt ?? null, device.lastSeenAt ?? null);
  }
  if (version < 2) {
    db.exec(`CREATE TABLE pairing_challenges (challenge TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
      CREATE TABLE sessions (session_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, refresh_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, FOREIGN KEY (device_id) REFERENCES devices(device_id));
      PRAGMA user_version = 2;`);
  }
  if (version < 3) db.exec(`CREATE TABLE connection_requests (request_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, device_name TEXT NOT NULL, public_key TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, created_at TEXT NOT NULL, approved_at TEXT); PRAGMA user_version = 3;`);
  if (version < 4) db.exec(`ALTER TABLE connection_requests ADD COLUMN request_proof_hash TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 4;`);
  if (version < 5) db.exec(`CREATE TABLE joystick_whisper_attempts (
      event_id TEXT NOT NULL,
      rule TEXT NOT NULL CHECK (rule IN ('followed', 'subscribed', 'resubscribed', 'giftSender')),
      normalized_recipient TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      PRIMARY KEY (event_id, rule, normalized_recipient)
    );
    CREATE INDEX joystick_whisper_attempts_attempted_at ON joystick_whisper_attempts (attempted_at);
    PRAGMA user_version = 5;`);
  if (version < 6) db.exec(`CREATE TABLE todos (
      id TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      viewer TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX todos_completed_at ON todos (completed_at);
    CREATE TABLE joystick_todo_event_ids (
      event_id TEXT PRIMARY KEY,
      claimed_at TEXT NOT NULL
    );
    CREATE INDEX joystick_todo_event_ids_claimed_at ON joystick_todo_event_ids (claimed_at);
    PRAGMA user_version = 6;`);
  if (version < 7) db.exec(`ALTER TABLE todos ADD COLUMN token_amount REAL;
    ALTER TABLE todos ADD COLUMN occurred_at TEXT;
    PRAGMA user_version = 7;`);
  if (version < 8) db.exec(`CREATE TABLE tip_history (
      event_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      viewer TEXT,
      amount REAL,
      occurred_at TEXT
    );
    PRAGMA user_version = 8;`);
  if (version < 9) {
    db.transaction(() => {
      db.exec(`ALTER TABLE todos ADD COLUMN source TEXT;
        ALTER TABLE tip_history ADD COLUMN source TEXT;
        PRAGMA user_version = 9;`);
    })();
  }
}
