import { createJoystickWhisperAutomation } from '../src/joystick-whispers.js';
import {
  normalizeJoystickWhisperSettings,
  type JoystickWhisperSettings,
} from '../src/joystick-whisper-settings.js';
import {
  normalizeJoystickChatAutomationSettings,
  type JoystickChatAutomationSettings,
} from '../src/joystick-chat-automations.js';
import { interpolateMessageTemplate } from '../src/message-template.js';
import { isJoystickStreamLive, type JoystickStreamState } from '../src/joystick-stream-state.js';

export type JoystickWhisperRuleName = keyof JoystickWhisperSettings;
export type JoystickWhisperConnectionState = 'connected' | 'reconnecting' | 'unavailable';
export type { JoystickStreamState } from '../src/joystick-stream-state.js';
export type JoystickWhisperStatus = {
  connection: { state: JoystickWhisperConnectionState; message: string | null };
  delivery: { state: 'idle' | 'sent' | 'failed'; rule: JoystickWhisperRuleName | null; message: string | null };
  stream: { state: JoystickStreamState; viewerCount: number };
};

type AuthSession = {
  state: 'authenticated';
  accessToken: string;
  grantedPermissions: string[];
  login?: string;
  userId?: string;
  identity?: { id?: string; login?: string };
};
type GatewayInput = {
  getAccessToken: () => string | undefined;
  getGrantedPermissions: () => readonly string[];
  onEvent: (event: unknown) => Promise<void>;
  onStatus: (status: { state: JoystickWhisperConnectionState }) => void;
};
type Gateway = {
  start: () => Promise<void>;
  updateAccessToken: (accessToken: string | undefined) => Promise<void>;
  stop: () => Promise<void>;
};
type StreamSnapshot = {
  sessionGeneration: number;
  connectionGeneration: number;
  accessToken: string;
  bufferedEvents: JoystickStreamState[];
  viewerCountUpdated: boolean;
};

const requiredPermissions = ['stream:read', 'chat:whisper:write'] as const;
const requiredDropInChatPermissions = ['stream:read', 'chat:write'] as const;
const requiredSlashCommandPermissions = ['stream:read', 'chat:write'] as const;
const SLASH_COMMAND_COOLDOWN_MS = 5_000;
const RECENT_SLASH_COMMAND_EVENT_LIMIT = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isViewerCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function gatewayEventRecord(event: unknown): Record<string, unknown> | undefined {
  if (!isRecord(event)) return undefined;
  const payload = Object.prototype.hasOwnProperty.call(event, 'event') ? event.event : event;
  return isRecord(payload) ? payload : undefined;
}

function streamStateFromEvent(event: unknown): JoystickStreamState | undefined {
  const record = gatewayEventRecord(event);
  if (record?.v !== 2) return undefined;
  if (record.type === 'stream_ending') return 'ending-soon';
  if (record.type === 'started' || record.topic === 'stream.online') return 'live';
  if (record.type === 'ended' || record.topic === 'stream.offline') return 'offline';
  return undefined;
}

function viewerCountFromEvent(event: unknown): number | undefined {
  const record = gatewayEventRecord(event);
  if (record?.v !== 2 || record.type !== 'viewer_count_updated' || record.topic !== 'stream.viewer_count'
    || !isRecord(record.data)) return undefined;
  const count = record.data.number_of_viewers;
  return isViewerCount(count) ? count : undefined;
}

function isAuthenticated(session: unknown): session is AuthSession {
  return typeof session === 'object' && session !== null
    && (session as AuthSession).state === 'authenticated'
    && typeof (session as AuthSession).accessToken === 'string'
    && (session as AuthSession).accessToken.trim() !== ''
    && Array.isArray((session as AuthSession).grantedPermissions);
}

function safeConnectionMessage(state: JoystickWhisperConnectionState): string {
  if (state === 'connected') return 'Connected to Joystick events.';
  if (state === 'reconnecting') return 'Connecting to Joystick events.';
  return 'Sign in and grant stream:read to connect. Whisper sending also requires chat:whisper:write.';
}

function copyStatus(status: JoystickWhisperStatus): JoystickWhisperStatus {
  return {
    connection: { state: status.connection.state, message: status.connection.message },
    delivery: { state: status.delivery.state, rule: status.delivery.rule, message: status.delivery.message },
    stream: { state: status.stream.state, viewerCount: status.stream.viewerCount },
  };
}

function whisperFailureDiagnostic(error: unknown): string {
  const record = typeof error === 'object' && error !== null
    ? error as { message?: unknown; status?: unknown; statusCode?: unknown; code?: unknown }
    : undefined;
  const message = error instanceof Error ? error.message
    : typeof error === 'string' ? error
      : typeof record?.message === 'string' ? record.message : '';
  const statusValue = record?.status ?? record?.statusCode;
  const messageStatus = /\b(?:HTTP(?:\/\d(?:\.\d)?)?\s+|status(?: code)?\s*[:=]?\s*)(\d{3})\b/i.exec(message)?.[1];
  const status = typeof statusValue === 'number' && Number.isInteger(statusValue) && statusValue >= 100 && statusValue <= 599
    ? statusValue : messageStatus ? Number(messageStatus) : undefined;
  const errorCode = typeof record?.code === 'string' ? record.code : '';
  const details: string[] = [];
  if (status !== undefined) details.push(`HTTP ${status}`);
  if (/\bupstream unavailable\b/i.test(message)) details.push('upstream unavailable');
  else if (/\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b|\b(?:network|fetch) (?:error|failed|failure)\b/i.test(`${message} ${errorCode}`)) {
    details.push('network failure');
  }
  return details.length ? details.join('; ') : 'delivery could not be confirmed';
}

export function createJoystickWhisperRuntime(input: {
  desktopSettings: {
    getSettings: () => Promise<{ settings: Record<string, unknown> }>;
    saveSettings: (settings: Record<string, unknown>) => Promise<{ settings: Record<string, unknown> }>;
  };
  auth: {
    getSession: () => AuthSession | null;
    onStateChanged: (listener: () => void) => () => void;
  };
  createGateway: (input: GatewayInput) => Gateway;
  todoEventHandler?: (event: unknown) => unknown | Promise<unknown>;
  attemptStore: {
    claimWhisperAttempt: (attempt: { eventId: string; rule: JoystickWhisperRuleName; recipient: string; attemptedAt: string }) => Promise<boolean>;
    pruneWhisperAttempts?: (now: number) => Promise<number>;
  };
  sendWhisper: (accessToken: string, whisper: { username: string; text: string }) => Promise<void>;
  logError?: (message: string, diagnostic: string) => void;
  sendPublicChat?: (accessToken: string, text: string) => Promise<unknown>;
  fetchImpl?: (url: string | URL, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}) {
  let started = false;
  let closed = false;
  let gatewayRunning = false;
  let status: JoystickWhisperStatus = {
    connection: { state: 'unavailable', message: safeConnectionMessage('unavailable') },
    delivery: { state: 'idle', rule: null, message: null },
    stream: { state: 'unknown', viewerCount: 0 },
  };
  let sessionGeneration = 0;
  let connectionGeneration = 0;
  let gatewayConnected = false;
  let activeSnapshot: StreamSnapshot | undefined;
  const statusListeners = new Set<(status: JoystickWhisperStatus) => void>();
  const handledDropInEventIds = new Set<string>();
  const handledSlashCommandEventIds = new Set<string>();
  const slashCommandCooldowns = new Map<string, number>();

  const publish = () => {
    for (const listener of statusListeners) {
      try { listener(copyStatus(status)); } catch { /* Observers cannot interrupt runtime work. */ }
    }
  };
  const updateStreamState = (state: JoystickStreamState) => {
    const viewerCount = state === 'offline' ? 0 : status.stream.viewerCount;
    if (status.stream.state === state && status.stream.viewerCount === viewerCount) return;
    status = { ...status, stream: { state, viewerCount } };
    publish();
  };
  const updateViewerCount = (viewerCount: number) => {
    if (status.stream.viewerCount === viewerCount) return;
    status = { ...status, stream: { ...status.stream, viewerCount } };
    publish();
  };
  const updateConnection = (reportedState: unknown) => {
    const state: JoystickWhisperConnectionState = reportedState === 'connected' || reportedState === 'reconnecting'
      ? reportedState : 'unavailable';
    status = { ...status, connection: { state, message: safeConnectionMessage(state) } };
    publish();
    if (state === 'connected') {
      if (!gatewayConnected) {
        gatewayConnected = true;
        connectionGeneration += 1;
        void snapshotStream();
      }
      return;
    }
    gatewayConnected = false;
    connectionGeneration += 1;
    activeSnapshot = undefined;
    updateStreamState('unknown');
  };
  const currentSession = () => {
    const session = input.auth.getSession();
    return isAuthenticated(session) ? session : null;
  };
  const canReadStream = (session: AuthSession | null): session is AuthSession =>
    Boolean(session && session.grantedPermissions.includes('stream:read'));
  const isCurrentSnapshot = (snapshot: StreamSnapshot): boolean => {
    const session = currentSession();
    return started && !closed
      && activeSnapshot === snapshot
      && snapshot.sessionGeneration === sessionGeneration
      && snapshot.connectionGeneration === connectionGeneration
      && session?.accessToken === snapshot.accessToken
      && canReadStream(session);
  };
  async function snapshotStream(): Promise<void> {
    const session = currentSession();
    if (!gatewayConnected || !canReadStream(session) || !input.fetchImpl) {
      activeSnapshot = undefined;
      updateStreamState('unknown');
      return;
    }

    const snapshot: StreamSnapshot = {
      sessionGeneration,
      connectionGeneration,
      accessToken: session.accessToken,
      bufferedEvents: [],
      viewerCountUpdated: false,
    };
    activeSnapshot = snapshot;
    updateStreamState('checking');

    let result: JoystickStreamState = 'unknown';
    let snapshotViewerCount: number | undefined;
    try {
      const response = await input.fetchImpl(
        'https://api.joystick.tv/api/v1/me/stream',
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            accept: 'application/json',
          },
        },
      );
      if (response.ok) {
        const body: unknown = await response.json();
        if (isRecord(body) && typeof body.live === 'boolean') {
          result = body.live ? 'live' : 'offline';
          const viewCount = body.view_count;
          if (body.live && isViewerCount(viewCount)) {
            snapshotViewerCount = viewCount;
          }
        }
      }
    } catch {
      // Snapshot failures are unknown, not evidence that the streamer is offline.
    }

    if (!isCurrentSnapshot(snapshot)) return;
    activeSnapshot = undefined;
    updateStreamState(result);
    if (result === 'live' && !snapshot.viewerCountUpdated && snapshotViewerCount !== undefined) {
      updateViewerCount(snapshotViewerCount);
    }
    for (const eventState of snapshot.bufferedEvents) updateStreamState(eventState);
  }
  const gateway = input.createGateway({
    getAccessToken: () => currentSession()?.accessToken,
    getGrantedPermissions: () => currentSession()?.grantedPermissions ?? [],
    onEvent: handleEvent,
    onStatus: (reported) => updateConnection(reported?.state),
  });

  async function syncGatewayToSession() {
    if (!started || closed) return;
    const session = currentSession();
    if (!session) {
      if (gatewayRunning) {
        gatewayRunning = false;
        await gateway.stop();
        updateConnection('unavailable');
      } else updateConnection('unavailable');
      return;
    }
    if (gatewayRunning) await gateway.updateAccessToken(session.accessToken);
    else {
      gatewayRunning = true;
      await gateway.start();
    }
  }

  const removeAuthListener = input.auth.onStateChanged(() => {
    sessionGeneration += 1;
    connectionGeneration += 1;
    gatewayConnected = false;
    activeSnapshot = undefined;
    updateStreamState('unknown');
    void syncGatewayToSession();
  });

  async function handleDropInChat(event: Record<string, unknown>): Promise<void> {
    const eventId = typeof event.id === 'string' ? event.id.trim() : '';
    if (!eventId || handledDropInEventIds.has(eventId) || !input.sendPublicChat) return;
    handledDropInEventIds.add(eventId);
    if (handledDropInEventIds.size > 500) handledDropInEventIds.delete(handledDropInEventIds.values().next().value!);
    const settings = await input.desktopSettings.getSettings();
    if (closed) return;
    const automation = normalizeJoystickChatAutomationSettings(settings.settings.joystickChatAutomations).dropIn;
    if (!automation.enabled || automation.messages.length === 0) return;

    const data = isRecord(event.data) ? event.data : {};
    const variables: Record<string, string | number | undefined> = {
      sender: typeof data.who === 'string' && data.who.trim() ? data.who : undefined,
      number_of_viewers: isViewerCount(data.number_of_viewers) ? data.number_of_viewers : undefined,
      text: typeof event.text === 'string' ? event.text : undefined,
      occurred_at: typeof event.occurred_at === 'string' ? event.occurred_at : undefined,
    };
    for (const message of automation.messages) {
      const session = currentSession();
      if (closed || !session || !requiredDropInChatPermissions.every((permission) => session.grantedPermissions.includes(permission))
        || !isJoystickStreamLive(() => status.stream.state)) return;
      try {
        await input.sendPublicChat(session.accessToken, interpolateMessageTemplate(message, variables));
      } catch {
        // A public send may have reached Joystick even if confirmation failed. Do not retry this event.
        return;
      }
    }
  }

  function normalizedLogin(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLocaleLowerCase('en-US') : '';
  }

  function stableIdentity(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).trim();
  }

  function streamerMessageMatch(author: Record<string, unknown>, session: AuthSession): boolean | undefined {
    const authorId = [author.user_id, author.userId, author.id].map(stableIdentity).find(Boolean) ?? '';
    const sessionId = [session.identity?.id, session.userId].map(stableIdentity).find(Boolean) ?? '';
    if (authorId && sessionId) return authorId === sessionId;

    const sessionLogin = normalizedLogin(session.identity?.login) || normalizedLogin(session.login);
    const authorLogin = normalizedLogin(author.login) || normalizedLogin(author.username);
    if (!sessionLogin || !authorLogin) return undefined;
    return sessionLogin === authorLogin;
  }

  async function handleSlashCommand(event: Record<string, unknown>): Promise<void> {
    if (!input.sendPublicChat || event.v !== 2 || event.type !== 'new_message' || event.topic !== 'chat.message'
      || !isRecord(event.data) || event.data.visibility !== 'public' || !isRecord(event.data.author)) return;
    const author = event.data.author;
    if (!isRecord(author.badges) || author.badges.bot !== false) return;
    const eventId = event.id;
    if (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 512) return;
    const eventIdKey = eventId.trim();
    if (handledSlashCommandEventIds.has(eventIdKey)) return;
    // Claim the bounded event ID synchronously before local settings can yield,
    // so replays with a different command token cannot race this lookup.
    handledSlashCommandEventIds.add(eventIdKey);
    if (handledSlashCommandEventIds.size > RECENT_SLASH_COMMAND_EVENT_LIMIT) {
      handledSlashCommandEventIds.delete(handledSlashCommandEventIds.values().next().value!);
    }

    const message = typeof event.data.text === 'string' ? event.data.text
      : typeof event.data.message === 'string' ? event.data.message
        : isRecord(event.data.message) && typeof event.data.message.text === 'string'
          ? event.data.message.text
          : typeof event.text === 'string' ? event.text : '';
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    const identitySession = currentSession();
    if (!identitySession) return;
    if (streamerMessageMatch(author, identitySession) === undefined) return;

    const token = trimmedMessage.split(/\s+/, 1)[0] ?? '';
    const settings = await input.desktopSettings.getSettings();
    if (closed) return;
    const slashCommands = normalizeJoystickChatAutomationSettings(settings.settings.joystickChatAutomations).slashCommands
      ?? { prefix: '!', commands: [] };
    if (!token.startsWith(slashCommands.prefix) || token.length <= slashCommands.prefix.length) return;
    const commandName = token.slice(slashCommands.prefix.length).toLocaleLowerCase('en-US');
    const command = slashCommands.commands.find((entry) => entry.enabled
      && entry.name.toLocaleLowerCase('en-US') === commandName);
    if (!command) return;

    const current = currentSession();
    if (!current || streamerMessageMatch(author, current) === undefined
      || !requiredSlashCommandPermissions.every((permission) => current.grantedPermissions.includes(permission))
      || !isJoystickStreamLive(() => status.stream.state)) return;
    const latestSession = currentSession();
    if (!latestSession || streamerMessageMatch(author, latestSession) === undefined
      || !requiredSlashCommandPermissions.every((permission) => latestSession.grantedPermissions.includes(permission))
      || !isJoystickStreamLive(() => status.stream.state)) return;

    const commandKey = command.name.toLocaleLowerCase('en-US');
    const now = (input.now ?? Date.now)();
    const lastAttempt = slashCommandCooldowns.get(commandKey);
    if (lastAttempt !== undefined && now - lastAttempt < SLASH_COMMAND_COOLDOWN_MS) return;
    // The cooldown starts at the accepted attempt, even when delivery fails.
    slashCommandCooldowns.set(commandKey, now);
    if (slashCommandCooldowns.size > RECENT_SLASH_COMMAND_EVENT_LIMIT) {
      slashCommandCooldowns.delete(slashCommandCooldowns.keys().next().value!);
    }
    const sender = typeof author.display_name === 'string' && author.display_name.trim()
      ? author.display_name
      : typeof author.username === 'string' && author.username.trim() ? author.username : undefined;
    try {
      await input.sendPublicChat(latestSession.accessToken, interpolateMessageTemplate(command.response, {
        sender,
      }));
    } catch {
      // Delivery may have succeeded despite an error. Do not automatically retry.
    }
  }

  async function handleEvent(event: unknown): Promise<void> {
    if (!started || closed) return;
    try {
      await input.todoEventHandler?.(event);
    } catch {
      // TODO storage is independent from gateway health and whisper delivery.
    }
    const session = currentSession();
    const viewerCount = viewerCountFromEvent(event);
    if (viewerCount !== undefined && gatewayConnected && canReadStream(session)) {
      const snapshot = activeSnapshot;
      if (snapshot && isCurrentSnapshot(snapshot)) snapshot.viewerCountUpdated = true;
      updateViewerCount(viewerCount);
    }
    const streamState = streamStateFromEvent(event);
    if (streamState && gatewayConnected && canReadStream(session)) {
      const snapshot = activeSnapshot;
      if (snapshot && isCurrentSnapshot(snapshot)) snapshot.bufferedEvents.push(streamState);
      else updateStreamState(streamState);
    }
    if (!session || !session.grantedPermissions.includes('stream:read')) return;
    if (!isJoystickStreamLive(() => status.stream.state)) return;

    const eventRecord = gatewayEventRecord(event);
    if (eventRecord?.type === 'stream_dropped_in'
      && requiredDropInChatPermissions.every((permission) => session.grantedPermissions.includes(permission))) {
      try { await handleDropInChat(eventRecord); } catch { /* Configuration/storage errors do not affect gateway health. */ }
    }
    if (eventRecord) {
      try { await handleSlashCommand(eventRecord); } catch { /* Settings and delivery errors must not affect gateway health. */ }
    }
    if (!requiredPermissions.every((permission) => session.grantedPermissions.includes(permission))) return;

    const ruleName: JoystickWhisperRuleName | null = eventRecord?.type === 'followed' ? 'followed'
      : eventRecord?.type === 'subscribed' ? 'subscribed'
        : eventRecord?.type === 'resubscribed' ? 'resubscribed'
          : eventRecord?.type === 'gifted_subscriptions' ? 'giftSender' : null;
    let attempted = false;
    try {
      const settings = await input.desktopSettings.getSettings();
      if (closed) return;
      const automation = createJoystickWhisperAutomation({
        rules: normalizeJoystickWhisperSettings(settings.settings.joystickWhispers),
        getStreamState: () => status.stream.state,
        attemptStore: {
          claimWhisperAttempt: async (attempt) => {
            if (closed || !isJoystickStreamLive(() => status.stream.state)) return false;
            return input.attemptStore.claimWhisperAttempt(attempt);
          },
        },
        now: input.now,
        sendWhisper: async (whisper) => {
          if (closed || !isJoystickStreamLive(() => status.stream.state)) return;
          attempted = true;
          const latestSession = currentSession();
          if (!latestSession || !requiredPermissions.every((permission) => latestSession.grantedPermissions.includes(permission))) {
            throw new Error('Whisper unavailable');
          }
          if (closed || !isJoystickStreamLive(() => status.stream.state)) return;
          try {
            await input.sendWhisper(latestSession.accessToken, whisper);
          } catch (error) {
            input.logError?.('Joystick whisper delivery failed:', whisperFailureDiagnostic(error));
            throw error;
          }
        },
      });
      await automation.handleEvent(event, { subscriptionConfirmed: true });
      if (!closed && attempted && ruleName) {
        status = { ...status, delivery: { state: 'sent', rule: ruleName, message: 'Whisper sent.' } };
        publish();
      }
    } catch {
      // Errors may contain credentials or event text; the send boundary logs only a sanitized classification.
      if (!closed && ruleName) {
        status = {
          ...status,
          delivery: {
            state: 'failed',
            rule: ruleName,
            message: 'Whisper delivery failed or could not be confirmed. It was not automatically retried.',
          },
        };
        publish();
      }
    }
  }

  return {
    async start() {
      if (started || closed) return;
      started = true;
      try {
        await input.attemptStore.pruneWhisperAttempts?.((input.now ?? Date.now)());
      } catch {
        status = {
          ...status,
          delivery: {
            state: 'failed',
            rule: null,
            message: 'Whisper attempt storage is unavailable; automatic delivery is blocked.',
          },
        };
        publish();
      }
      await syncGatewayToSession();
    },
    async shutdown() {
      if (closed) return;
      closed = true;
      started = false;
      removeAuthListener();
      gatewayRunning = false;
      await gateway.stop();
      updateConnection('unavailable');
    },
    async getSettings(): Promise<JoystickWhisperSettings> {
      return normalizeJoystickWhisperSettings((await input.desktopSettings.getSettings()).settings.joystickWhispers);
    },
    async updateSettings(settings: JoystickWhisperSettings): Promise<JoystickWhisperSettings> {
      const normalized = normalizeJoystickWhisperSettings(settings);
      const current = await input.desktopSettings.getSettings();
      const saved = await input.desktopSettings.saveSettings({ ...current.settings, joystickWhispers: normalized });
      return normalizeJoystickWhisperSettings(saved.settings.joystickWhispers);
    },
    async getChatAutomationSettings(): Promise<JoystickChatAutomationSettings> {
      return normalizeJoystickChatAutomationSettings((await input.desktopSettings.getSettings()).settings.joystickChatAutomations);
    },
    async updateChatAutomationSettings(settings: JoystickChatAutomationSettings): Promise<JoystickChatAutomationSettings> {
      const normalized = normalizeJoystickChatAutomationSettings(settings);
      const current = await input.desktopSettings.getSettings();
      const saved = await input.desktopSettings.saveSettings({ ...current.settings, joystickChatAutomations: normalized });
      return normalizeJoystickChatAutomationSettings(saved.settings.joystickChatAutomations);
    },
    getStatus(): JoystickWhisperStatus { return copyStatus(status); },
    onStatusChanged(listener: (status: JoystickWhisperStatus) => void): () => void {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
  };
}
