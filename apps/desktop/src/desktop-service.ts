import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { createLocalStore, type DeviceRecord, type JoystickTodoEventInput, type SourceLabel, type TipHistoryRecord, type TodoInput, type TodoRecord } from './local-store.js';
import { CONFIRMATION_CODE_ALPHABET, CONFIRMATION_CODE_LENGTH, isConfirmationCode } from '@prismata/sync';

type Request = { method?: string; body?: Record<string, unknown>; headers?: Record<string, string> };
type Result = { status: number; body?: unknown };
export type DesktopTlsOptions = { key: string; cert: string; fingerprint: string };
type ServiceOptions = { dataFile?: string; instanceId?: string; now?: () => number; tls?: DesktopTlsOptions; serverFactory?: typeof createServer };
type Session = { sessionId: string; deviceId: string; refreshHash: string; expiresAt: number };

const TODO_ITEM_NAME_MAX_LENGTH = 200;
const TODO_VIEWER_MAX_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanEventText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  let bounded = '';
  for (const character of cleaned) {
    if (bounded.length + character.length > maxLength) break;
    bounded += character;
  }
  return bounded || undefined;
}

function optionalViewer(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const viewer = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return viewer && viewer.length <= TODO_VIEWER_MAX_LENGTH ? viewer : undefined;
}

function optionalTokenAmount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
    ? value : undefined;
}

function optionalOccurredAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : undefined;
}

/** Parse only the Joystick event shapes verified from real v2 gateway logs. */
export function parseJoystickTodoEvent(event: unknown): JoystickTodoEventInput | null {
  if (!isRecord(event) || event.v !== 2 || typeof event.id !== 'string' || !event.id.trim()
    || event.id.trim().length > 512 || !isRecord(event.data)) return null;

  const data = event.data;
  let itemName: string;
  let amount: unknown;
  let source: SourceLabel;
  if (event.type === 'tipped') {
    if (event.topic !== 'channel.tip' || data.is_test !== false) return null;
    const tipMenuItem = isRecord(data.tip_menu_item) ? data.tip_menu_item.title : data.tip_menu_item;
    const menuItem = cleanEventText(tipMenuItem, TODO_ITEM_NAME_MAX_LENGTH - 'Tip menu: '.length);
    if (!menuItem || menuItem.toLowerCase() === 'null') return null;
    itemName = `Tip menu: ${menuItem}`;
    amount = data.how_much;
    source = 'Tips';
  } else if (event.type === 'milestone_completed') {
    if (event.topic !== 'channel.milestone.complete') return null;
    itemName = cleanEventText(data.title, TODO_ITEM_NAME_MAX_LENGTH) ?? 'Milestone completed';
    amount = data.amount;
    source = 'Goal completion';
  } else if (event.type === 'wheel_spin_claimed') {
    itemName = cleanEventText(data.prize, TODO_ITEM_NAME_MAX_LENGTH) ?? 'Wheel spin prize';
    amount = data.how_much;
    source = 'Wheel spin';
  } else if (event.type === 'stream_dropped_in') {
    itemName = 'Drop In Control Link';
    source = 'Drop In';
  } else {
    return null;
  }

  const viewer = optionalViewer(data.who);
  const tokenAmount = optionalTokenAmount(amount);
  const occurredAt = optionalOccurredAt(event.occurred_at);
  return {
    eventId: event.id.trim(),
    itemName,
    ...(viewer ? { viewer } : {}),
    ...(tokenAmount !== undefined ? { tokenAmount } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    source,
  };
}

/** Parse only live, non-test Joystick tip events into allowlisted history fields. */
export function parseJoystickTipHistoryEvent(event: unknown): TipHistoryRecord | null {
  if (!isRecord(event) || event.v !== 2 || event.type !== 'tipped'
    || typeof event.id !== 'string' || !event.id.trim() || event.id.trim().length > 512
    || typeof event.occurred_at !== 'string' || !Number.isFinite(new Date(event.occurred_at).getTime())
    || !isRecord(event.data) || event.data.is_test !== false) return null;

  const data = event.data;
  const menuItem = data.tip_menu_item;
  const menuTitle = isRecord(menuItem) ? menuItem.title : menuItem;
  const title = cleanEventText(menuTitle, TODO_ITEM_NAME_MAX_LENGTH) ?? 'Token tip';
  const viewer = optionalViewer(data.who);
  const amount = optionalTokenAmount(data.how_much);
  const occurredAt = optionalOccurredAt(event.occurred_at);
  return {
    eventId: event.id.trim(),
    title,
    ...(viewer ? { viewer } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    source: 'Tips',
  };
}

export async function createDesktopService(options: ServiceOptions = {}) {
  const now = options.now ?? Date.now;
  const store = await createLocalStore(options.dataFile ?? ':memory:', { now });
  const instanceId = options.instanceId ?? `desktop-${randomUUID()}`;
  const sessions = new Map<string, Session>();
  const refreshSessions = new Map<string, string>();
  const transientCodes = new Map<string, string>();
  let server: ReturnType<typeof createServer> | undefined;
  const sockets = new Set<Socket>();
  let stopping: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const tls = options.tls ?? { key: '', cert: '', fingerprint: '' };
  const serverFactory = options.serverFactory ?? createServer;
  const request = async (pathname: string, input: Request = {}): Promise<Result> => {
    const body = input.body ?? {};
    if (pathname === '/api/v1/health' && (input.method ?? 'GET') === 'GET') return { status: 200, body: { status: 'ok', protocol: 'v1' } };
    if (pathname === '/api/v1/instance' && (input.method ?? 'GET') === 'GET') return { status: 200, body: { protocol: 'v1', instanceId, fingerprint: tls.fingerprint, pairingRequired: true, capabilities: ['settings', 'devices', 'session-refresh', 'device-heartbeat'] } };
    if ((pathname === '/api/v1/pairing/start' || pathname === '/api/v1/pairing/complete') && input.method === 'POST') return { status: 404, body: { error: 'legacy QR pairing is disabled; use desktop-approved connection requests' } };
    if (pathname === '/api/v1/connection-requests' && input.method === 'POST') return createConnectionRequest(body);
    if (pathname === '/api/v1/connection-requests' && (input.method ?? 'GET') === 'GET') return listConnectionRequests();
    const requestMatch = /^\/api\/v1\/connection-requests\/([^/]+)(?:\/(approve|session))?$/.exec(pathname);
    if (requestMatch) {
      const requestId = requestMatch[1];
       if (!requestMatch[2] && (input.method ?? 'GET') === 'GET') return getConnectionRequest(requestId, input.headers?.['x-prismata-request-proof']);
       if (requestMatch[2] === 'approve' && input.method === 'POST') return { status: 404, body: { error: 'desktop-local approval required' } };
        if (requestMatch[2] === 'session' && input.method === 'POST') return input.headers?.['x-prismata-request-proof'] ? issueConnectionRequestSession(requestId, input.headers['x-prismata-request-proof']) : { status: 404, body: { error: 'request proof required' } };
    }
    if (pathname === '/api/v1/session/refresh' && input.method === 'POST') {
      const refreshToken = String(body.refreshToken ?? ''); const refreshHash = hash(refreshToken); const accessHash = refreshSessions.get(refreshHash); const session = accessHash ? sessions.get(accessHash) : await store.getSessionByRefreshHash(refreshHash);
      if (!session) return { status: 401, body: { error: 'invalid refresh token' } };
      sessions.delete(session.sessionId); refreshSessions.delete(refreshHash); await store.deleteSession(session.sessionId); return { status: 200, body: await issueSession(session.deviceId, sessions, refreshSessions, now, store) };
    }
    const deviceId = await authenticate(input.headers?.authorization, sessions, now(), store); if (!deviceId) return { status: 401, body: { error: 'device session required' } };
    if (pathname === '/api/v1/session/revoke' && input.method === 'POST') { await revokeSessions(deviceId, sessions, refreshSessions, store); return { status: 204 }; }
    if (pathname === '/api/v1/settings' && (input.method ?? 'GET') === 'GET') return { status: 200, body: await store.getSettings() };
    if (pathname === '/api/v1/settings' && input.method === 'PUT') { try { return { status: 200, body: await store.updateSettings((body.settings ?? {}) as Record<string, unknown>, deviceId, body.baseRevision as number | undefined) }; } catch { return { status: 409, body: { error: 'settings conflict' } }; } }
    if (pathname === '/api/v1/devices' && (input.method ?? 'GET') === 'GET') return { status: 200, body: { devices: await store.listDevices() } };
    if (pathname === '/api/v1/devices/heartbeat' && input.method === 'POST') return { status: (await store.heartbeatDevice(deviceId)) ? 200 : 404, body: { deviceId, lastSeenAt: new Date(now()).toISOString() } };
    if (pathname.startsWith('/api/v1/devices/') && input.method === 'DELETE') { const target = pathname.slice('/api/v1/devices/'.length); if (target !== deviceId) return { status: 403, body: { error: 'device may only revoke itself' } }; await store.revokeDevice(target); await revokeSessions(target, sessions, refreshSessions, store); return { status: 204 }; }
    return { status: 404, body: { error: 'not found' } };
  };
  const createConnectionRequest = async (body: Record<string, unknown>): Promise<Result> => {
    const deviceId = String(body.deviceId ?? ''), publicKey = String(body.publicKey ?? ''), deviceName = String(body.deviceName ?? deviceId);
    if (!deviceId || !publicKey || !deviceName.trim()) return { status: 400, body: { error: 'deviceId, publicKey, and deviceName are required' } };
     const requestId = randomUUID();
     const requestProof = randomBytes(32).toString('base64url');
    const code = generateConfirmationCode();
    const expiresAt = new Date(now() + 120_000).toISOString();
     await store.saveConnectionRequest({ requestId, deviceId, deviceName: deviceName.trim(), publicKey, requestProofHash: hash(requestProof), codeHash: hash(code), expiresAt, status: 'pending', attempts: 0, createdAt: new Date(now()).toISOString() });
     transientCodes.set(requestId, code);
     return { status: 201, body: { requestId, requestProof, deviceId, deviceName: deviceName.trim(), instanceId, status: 'pending', expiresAt } };
   };
    const publicRequest = (record: Awaited<ReturnType<typeof store.getConnectionRequest>>) => record && ({ requestId: record.requestId, deviceId: record.deviceId, deviceName: record.deviceName, instanceId, status: record.status, expiresAt: record.expiresAt });
   const hasProof = (record: Awaited<ReturnType<typeof store.getConnectionRequest>>, proof: string | undefined) => { const storedHash = record?.requestProofHash; return Boolean(record && proof && storedHash && storedHash.length === 64 && timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(hash(proof), 'hex'))); };
   const getConnectionRequest = async (requestId: string, proof?: string): Promise<Result> => {
     const record = await store.getConnectionRequest(requestId);
     if (!record) return { status: 404, body: { error: 'connection request not found' } };
     if (!hasProof(record, proof)) return { status: 401, body: { error: 'request proof required' } };
     if (record.status === 'pending' && Date.parse(record.expiresAt) <= now()) { await store.updateConnectionRequest(requestId, { status: 'expired' }); record.status = 'expired'; }
      return { status: 200, body: { ...publicRequest(record), ...(record.status === 'pending' && transientCodes.has(requestId) ? { code: transientCodes.get(requestId) } : {}) } };
   };
   const listConnectionRequests = async (): Promise<Result> => ({ status: 401, body: { error: 'desktop-local approval required' } });
   const listLocalConnectionRequests = async () => (await store.listConnectionRequests()).filter((record) => { if (Date.parse(record.expiresAt) <= now()) { void store.updateConnectionRequest(record.requestId, { status: 'expired' }); return false; } return true; }).map((record) => ({ ...publicRequest(record), code: transientCodes.get(record.requestId) }));
   const approveConnectionRequest = async (requestId: string, code: string): Promise<Result> => {
     const record = await store.getConnectionRequest(requestId);
    if (record?.status === 'consumed') return { status: 409, body: { error: 'connection request already used' } };
    if (!record || record.status !== 'pending' || Date.parse(record.expiresAt) <= now()) { if (record?.status === 'pending') await store.updateConnectionRequest(requestId, { status: 'expired' }); return { status: 401, body: { error: 'invalid or expired connection request' } }; }
     if (!isConfirmationCode(code) || record.attempts >= 5) { await store.recordConnectionAttempt(requestId); return { status: 401, body: { error: 'invalid confirmation code' } }; }
     const matches = timingSafeEqual(Buffer.from(record.codeHash, 'hex'), Buffer.from(hash(code), 'hex'));
     if (!matches || !(await store.approveConnectionRequest(requestId, hash(code), new Date(now()).toISOString()))) { if (!matches) await store.recordConnectionAttempt(requestId); return { status: 401, body: { error: 'invalid confirmation code' } }; }
    return { status: 200, body: { requestId, deviceId: record.deviceId, deviceName: record.deviceName, instanceId, status: 'approved', expiresAt: record.expiresAt } };
  };
    const issueConnectionRequestSession = async (requestId: string, proof?: string): Promise<Result> => {
      const record = await store.getConnectionRequest(requestId);
      if (!record || !hasProof(record, proof) || record.status !== 'approved' || Date.parse(record.expiresAt) <= now()) return { status: 401, body: { error: 'connection request approval required' } };
      if (!(await store.claimConnectionRequest(requestId))) return { status: 409, body: { error: 'connection request already used' } };
      try {
        const device: DeviceRecord = { deviceId: record.deviceId, publicKey: record.publicKey, deviceName: record.deviceName, createdAt: new Date(now()).toISOString() };
        await store.addDevice(device);
        const credentials = await issueSession(record.deviceId, sessions, refreshSessions, now, store);
        transientCodes.delete(requestId);
        return { status: 201, body: { deviceId: record.deviceId, ...credentials, instanceId, fingerprint: tls.fingerprint } };
      } catch (error) {
        await store.rollbackConnectionRequestClaim(requestId);
        throw error;
      }
    };
  return {
    request,
      getCurrentTime: () => now(),
      listDevices: () => store.listDevices(),
      listTodos: (): Promise<TodoRecord[]> => store.listTodos(),
      addTodo: (input: TodoInput): Promise<TodoRecord> => store.addTodo(input),
      updateTodo: (id: string, input: TodoInput): Promise<boolean> => store.updateTodo(id, input),
      createJoystickTodoFromEvent: (input: JoystickTodoEventInput): Promise<TodoRecord | null> => store.createJoystickTodoFromEvent(input),
      recordTipHistory: (input: TipHistoryRecord): Promise<TipHistoryRecord | null> => store.recordTipHistory(input),
      listTipHistory: (): Promise<TipHistoryRecord[]> => store.listTipHistory(),
      completeTodo: (id: string): Promise<boolean> => store.completeTodo(id),
      undoCompleteTodo: (id: string): Promise<boolean> => store.undoCompleteTodo(id),
      removeTodo: (id: string): Promise<boolean> => store.removeTodo(id),
      listLocalConnectionRequests,
     approveLocalConnectionRequest: approveConnectionRequest,
    revokeDevice: async (deviceId: string) => { const revoked = await store.revokeDevice(deviceId); await revokeSessions(deviceId, sessions, refreshSessions, store); return revoked; },
      transportMetadata: () => ({ cert: tls.cert, fingerprint: tls.fingerprint }),
      getSettings: () => store.getSettings(),
      saveSettings: (settings: Record<string, unknown>) => store.updateSettings(settings, 'desktop-network'),
      claimWhisperAttempt: (attempt: Parameters<typeof store.claimWhisperAttempt>[0]) => store.claimWhisperAttempt(attempt),
      pruneWhisperAttempts: (now: number) => store.pruneWhisperAttempts(now),
      close() {
        if (closing) return closing;
        closing = (async () => {
          try {
            await this.stop();
          } finally {
            store.close();
          }
        })();
        return closing;
      },
      async start(port = 0, host = '127.0.0.1') { if (!tls.key || !tls.cert || !/^[a-f0-9]{64}$/i.test(tls.fingerprint)) throw new Error('TLS identity is required'); server = serverFactory({ key: tls.key, cert: tls.cert }, async (req, res) => handleHttp(request, req, res)); server.on?.('connection', (socket: Socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); }); await new Promise<void>((resolve, reject) => { const onError = (error: Error) => { server?.off?.('listening', onListening); reject(error); }; const onListening = () => { server?.off?.('error', onError); resolve(); }; server!.once('error', onError); server!.once('listening', onListening); server!.listen(port, host); }); return server.address(); },
     stop() {
       if (stopping) return stopping;
       const current = server;
       if (!current) return Promise.resolve();
       stopping = new Promise<void>((resolve, reject) => {
         current.close((error) => {
           if (server === current) server = undefined;
           const code = (error as NodeJS.ErrnoException | undefined)?.code;
           if (error && code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
           else resolve();
         });
         // Closing the listener alone can wait forever for active keep-alive or
         // incomplete requests. Terminate those sockets so desktop shutdown
         // cannot leave the process running after its window has closed.
         current.closeAllConnections?.();
         for (const socket of sockets) socket.destroy();
       }).finally(() => { stopping = undefined; });
       return stopping;
     },
  };
}

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function generateConfirmationCode() { const bytes = randomBytes(CONFIRMATION_CODE_LENGTH); return Array.from(bytes, (byte) => CONFIRMATION_CODE_ALPHABET[byte % CONFIRMATION_CODE_ALPHABET.length]).join(''); }
async function issueSession(deviceId: string, sessions: Map<string, Session>, refreshSessions: Map<string, string>, now: () => number, store: Awaited<ReturnType<typeof createLocalStore>>) { const accessToken = randomBytes(32).toString('base64url'); const refreshToken = randomBytes(32).toString('base64url'); const accessHash = hash(accessToken); const refreshHash = hash(refreshToken); const expiresAt = now() + 15 * 60_000; sessions.set(accessHash, { sessionId: accessHash, deviceId, refreshHash, expiresAt }); refreshSessions.set(refreshHash, accessHash); try { await store.saveSession({ sessionId: accessHash, deviceId, refreshHash, expiresAt: new Date(expiresAt).toISOString() }); } catch (error) { sessions.delete(accessHash); refreshSessions.delete(refreshHash); await store.deleteSession(accessHash); throw error; } return { accessToken, refreshToken, expiresAt: new Date(expiresAt).toISOString() }; }
async function revokeSessions(deviceId: string, sessions: Map<string, Session>, refreshSessions: Map<string, string>, store: Awaited<ReturnType<typeof createLocalStore>>) { for (const [accessHash, session] of sessions) if (session.deviceId === deviceId) { sessions.delete(accessHash); refreshSessions.delete(session.refreshHash); } await store.revokeSessionsForDevice(deviceId); }
async function authenticate(value: string | undefined, sessions: Map<string, Session>, now: number, store: Awaited<ReturnType<typeof createLocalStore>>) { const token = value?.startsWith('Bearer ') ? value.slice(7) : ''; const session = sessions.get(hash(token)) ?? await store.getSession(hash(token)); const expiresAt = session && (typeof session.expiresAt === 'number' ? session.expiresAt : Date.parse(session.expiresAt)); return session && expiresAt !== undefined && expiresAt > now ? session.deviceId : undefined; }
async function handleHttp(request: (path: string, input?: Request) => Promise<Result>, req: IncomingMessage, res: ServerResponse) { let raw = ''; let oversized = false; req.on('data', (chunk: Buffer) => { raw += chunk.toString(); if (raw.length > 64 * 1024) oversized = true; }); req.on('end', async () => { if (oversized) { res.statusCode = 413; res.end(); return; } try { const result = await request(req.url?.split('?')[0] ?? '/', { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, String(value)])), body: raw ? JSON.parse(raw) : {} }); res.statusCode = result.status; res.setHeader('content-type', 'application/json'); res.end(result.body === undefined ? '' : JSON.stringify(result.body)); } catch { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'invalid JSON' })); } }); }
