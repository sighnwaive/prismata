import { diagnoseJoystickTraffic, type JoystickTrafficDiagnostic } from './joystick-traffic-diagnostics.js';

const JOYSTICK_GATEWAY_URL = 'wss://api.joystick.tv/cable';
const ACTIONCABLE_PROTOCOL = 'actioncable-v1-json';
const GATEWAY_IDENTIFIER = JSON.stringify({ channel: 'GatewayChannel', event_version: 'v2' });
const REQUIRED_PERMISSIONS = ['stream:read'] as const;

type GatewayState = 'connected' | 'reconnecting' | 'unavailable';
type GatewayStatus = { state: GatewayState };
type SocketEvent = { data?: unknown; code?: number; reason?: string };
type GatewaySocket = {
  addEventListener: (type: string, listener: (event: SocketEvent) => void) => void;
  send: (value: string) => void;
  close: () => void;
};
type ScheduleReconnect = (callback: () => Promise<void>, delayMs: number) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultSocketFactory(url: string, protocols: string[]): GatewaySocket {
  const WebSocketConstructor = globalThis.WebSocket;
  if (typeof WebSocketConstructor !== 'function') throw new Error('WebSocket is unavailable');
  return new WebSocketConstructor(url, protocols) as unknown as GatewaySocket;
}

function defaultScheduleReconnect(callback: () => Promise<void>, delayMs: number): void {
  setTimeout(() => { void callback(); }, delayMs);
}

export function createJoystickActionCableGateway(input: {
  getAccessToken: () => string | undefined;
  getGrantedPermissions: () => readonly string[];
  socketFactory?: (url: string, protocols: string[]) => GatewaySocket;
  onEventEnvelope?: (event: unknown) => unknown;
  onEvent?: (event: unknown) => unknown;
  onStatus?: (status: GatewayStatus) => unknown;
  onDiagnostic?: JoystickTrafficDiagnostic;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: (attempt: number) => number;
  scheduleReconnect?: ScheduleReconnect;
}) {
  const socketFactory = input.socketFactory ?? defaultSocketFactory;
  const scheduleReconnect = input.scheduleReconnect ?? defaultScheduleReconnect;
  const requestedMaxReconnectAttempts = input.maxReconnectAttempts ?? 5;
  const maxReconnectAttempts = Number.isFinite(requestedMaxReconnectAttempts)
    ? Math.max(0, Math.floor(requestedMaxReconnectAttempts))
    : 5;
  const reconnectDelayMs = input.reconnectDelayMs ?? ((attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 30_000));

  let running = false;
  let currentToken: string | undefined;
  let socket: GatewaySocket | undefined;
  let currentEndpoint: string | undefined;
  let subscriptionRequested = false;
  let subscribed = false;
  let reconnectAttempts = 0;
  let lifecycle = 0;
  let status: GatewayStatus = { state: 'unavailable' };

  function setStatus(state: GatewayState): void {
    status = { state };
    try { input.onStatus?.(status); } catch { /* Status observers must not disrupt transport cleanup. */ }
  }

  function hasRequiredPermissions(): boolean {
    try {
      const permissions = input.getGrantedPermissions();
      return Array.isArray(permissions) && REQUIRED_PERMISSIONS.every((permission) => permissions.includes(permission));
    } catch {
      return false;
    }
  }

  function readInitialToken(): string | undefined {
    try {
      const token = input.getAccessToken();
      return typeof token === 'string' && token.trim() !== '' ? token : undefined;
    } catch {
      return undefined;
    }
  }

  function closeCurrentSocket(): void {
    const previous = socket;
    socket = undefined;
    subscriptionRequested = false;
    subscribed = false;
    if (!previous) return;
    diagnoseJoystickTraffic(input.onDiagnostic, {
      direction: 'outbound',
      transport: 'websocket',
      event: 'close',
      endpoint: currentEndpoint,
    });
    currentEndpoint = undefined;
    try { previous.close(); } catch { /* Closing an already closed socket is harmless. */ }
  }

  function cancelPendingReconnects(): void {
    lifecycle += 1;
  }

  function scheduleRetry(): void {
    if (!running) return;
    if (!hasRequiredPermissions() || reconnectAttempts >= maxReconnectAttempts) {
      setStatus('unavailable');
      return;
    }

    reconnectAttempts += 1;
    const attempt = reconnectAttempts;
    const expectedLifecycle = lifecycle;
    let delay: number;
    try {
      const requestedDelay = reconnectDelayMs(attempt);
      delay = Number.isFinite(requestedDelay) ? Math.max(0, requestedDelay) : 0;
    } catch {
      setStatus('unavailable');
      return;
    }
    setStatus('reconnecting');
    try {
      const scheduled = scheduleReconnect(async () => {
        if (!running || lifecycle !== expectedLifecycle) return;
        await openSocket();
      }, delay);
      if (scheduled && typeof (scheduled as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(scheduled).catch(() => {
          if (running && lifecycle === expectedLifecycle) setStatus('unavailable');
        });
      }
    } catch {
      setStatus('unavailable');
    }
  }

  function handleSocketEnd(candidate: GatewaySocket, expectedLifecycle: number): void {
    if (socket !== candidate || lifecycle !== expectedLifecycle) return;
    socket = undefined;
    subscriptionRequested = false;
    subscribed = false;
    scheduleRetry();
  }

  function failSocket(candidate: GatewaySocket, expectedLifecycle: number): void {
    if (socket !== candidate || lifecycle !== expectedLifecycle) return;
    handleSocketEnd(candidate, expectedLifecycle);
    try { candidate.close(); } catch { /* The failed socket is already unusable. */ }
  }

  function validEvent(value: unknown): value is Record<string, unknown> {
    return isRecord(value)
      && value.v === 2
      && typeof value.type === 'string'
      && value.type.trim() !== ''
      && typeof value.id === 'string'
      && value.id.trim() !== '';
  }

  function parseFrame(data: unknown): unknown {
    if (typeof data !== 'string') return undefined;
    try { return JSON.parse(data) as unknown; } catch { return undefined; }
  }

  function diagnoseInboundFrame(
    onDiagnostic: JoystickTrafficDiagnostic | undefined,
    endpoint: string | undefined,
    frame: Record<string, unknown>,
  ): void {
    if (frame.type === 'ping') return;
    diagnoseJoystickTraffic(onDiagnostic, {
      direction: 'inbound',
      transport: 'websocket',
      event: typeof frame.type === 'string' ? frame.type : 'frame',
      endpoint,
      payload: frame,
    });
  }

  async function openSocket(): Promise<void> {
    if (!running) return;
    cancelPendingReconnects();
    const expectedLifecycle = lifecycle;
    if (!hasRequiredPermissions()) {
      closeCurrentSocket();
      setStatus('unavailable');
      return;
    }
    const token = currentToken;
    if (!token) {
      closeCurrentSocket();
      setStatus('unavailable');
      return;
    }

    const url = new URL(JOYSTICK_GATEWAY_URL);
    url.searchParams.set('token', token);
    currentEndpoint = url.toString();
    setStatus('reconnecting');

    diagnoseJoystickTraffic(input.onDiagnostic, {
      direction: 'outbound',
      transport: 'websocket',
      event: 'connect',
      endpoint: currentEndpoint,
      protocols: [ACTIONCABLE_PROTOCOL],
    });

    let candidate: GatewaySocket;
    try {
      candidate = socketFactory(url.toString(), [ACTIONCABLE_PROTOCOL]);
    } catch {
      diagnoseJoystickTraffic(input.onDiagnostic, {
        direction: 'inbound',
        transport: 'websocket',
        event: 'connect_error',
        endpoint: currentEndpoint,
      });
      scheduleRetry();
      return;
    }
    socket = candidate;
    subscriptionRequested = false;
    subscribed = false;

    try {
      candidate.addEventListener('message', (event) => {
        if (socket !== candidate || lifecycle !== expectedLifecycle) return;
        const frame = parseFrame(event.data);
        if (!isRecord(frame)) return;
        diagnoseInboundFrame(input.onDiagnostic, currentEndpoint, frame);

        if (frame.type === 'welcome') {
          if (subscriptionRequested) return;
          subscriptionRequested = true;
          const subscription = { command: 'subscribe', identifier: GATEWAY_IDENTIFIER };
          diagnoseJoystickTraffic(input.onDiagnostic, {
            direction: 'outbound',
            transport: 'websocket',
            event: 'subscribe',
            endpoint: currentEndpoint,
            payload: subscription,
          });
          try {
            candidate.send(JSON.stringify(subscription));
          } catch {
            diagnoseJoystickTraffic(input.onDiagnostic, {
              direction: 'inbound',
              transport: 'websocket',
              event: 'send_error',
              endpoint: currentEndpoint,
            });
            failSocket(candidate, expectedLifecycle);
          }
          return;
        }

        if (frame.type === 'confirm_subscription') {
          if (!subscriptionRequested || frame.identifier !== GATEWAY_IDENTIFIER) return;
          subscribed = true;
          reconnectAttempts = 0;
          setStatus('connected');
          return;
        }

        const isMessageFrame = frame.type === 'message'
          || (frame.type === undefined && frame.identifier === GATEWAY_IDENTIFIER);
        if (!isMessageFrame
          || frame.identifier !== GATEWAY_IDENTIFIER
          || !subscribed
          || !Object.prototype.hasOwnProperty.call(frame, 'message')) return;
        try {
          const result = input.onEventEnvelope?.(frame.message);
          if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(result).catch(() => {});
          }
        } catch { /* Diagnostic observers must not disrupt event consumers. */ }
        if (!validEvent(frame.message)) return;
        try {
          const result = input.onEvent?.(frame.message);
          if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(result).catch(() => {});
          }
        } catch { /* Ignore consumer errors at the socket boundary. */ }
      });
      candidate.addEventListener('close', (event) => {
        diagnoseJoystickTraffic(input.onDiagnostic, {
          direction: 'inbound',
          transport: 'websocket',
          event: 'close',
          endpoint: currentEndpoint,
          code: event.code,
        });
        handleSocketEnd(candidate, expectedLifecycle);
      });
      candidate.addEventListener('error', () => {
        diagnoseJoystickTraffic(input.onDiagnostic, {
          direction: 'inbound',
          transport: 'websocket',
          event: 'error',
          endpoint: currentEndpoint,
        });
        failSocket(candidate, expectedLifecycle);
      });
    } catch {
      failSocket(candidate, expectedLifecycle);
    }
  }

  async function stop(): Promise<void> {
    running = false;
    currentToken = undefined;
    cancelPendingReconnects();
    closeCurrentSocket();
    setStatus('unavailable');
  }

  return {
    async start(): Promise<void> {
      if (running) return;
      running = true;
      reconnectAttempts = 0;
      if (!currentToken) currentToken = readInitialToken();
      await openSocket();
    },

    async updateAccessToken(accessToken: string | undefined): Promise<void> {
      currentToken = typeof accessToken === 'string' && accessToken.trim() !== '' ? accessToken : undefined;
      if (!running) return;
      cancelPendingReconnects();
      closeCurrentSocket();
      reconnectAttempts = 0;
      await openSocket();
    },

    stop,
    async signOut(): Promise<void> {
      currentToken = undefined;
      await stop();
    },
    async shutdown(): Promise<void> {
      currentToken = undefined;
      await stop();
    },
    getStatus(): GatewayStatus {
      return status;
    },
  };
}
