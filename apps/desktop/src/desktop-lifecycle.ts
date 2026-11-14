import * as os from 'node:os';
import { isReachableAddress as isCanonicalReachableAddress } from './ip-address.js';
import { createDesktopService } from './desktop-service.js';
import { createMdnsDiscoveryAdapter, type DiscoveryAdapter } from './discovery.js';
import type { JoystickTodoEventInput, SettingsSnapshot, TipHistoryRecord, TodoRecord } from './local-store.js';
import { certificateCoversHost, createProtectedFileStore, createTransportIdentityStore } from './transport-identity.js';

export type NetworkInterfaceChoice = { name: string; address: string; family: 'IPv4' | 'IPv6' };
export type LanError = { code: 'NO_ADDRESS' | 'LAN_STARTUP_FAILED'; message: string; retryable: boolean };
export type DesktopStatus = { state: 'starting' | 'ready' | 'stopped'; lanEnabled: boolean; host: string | null; advertisedHost: string | null; port: number | null; baseUrl: string | null; instanceId: string; protocol: 'https'; fingerprint: string | null; discovery: 'stopped' | 'advertising' | 'error'; discoveryError: string | null; lanError: LanError | null };
export type DesktopTodoInput = { itemName: string; viewer?: string; note?: string };
export type DesktopTodoLifecycle = {
  listTodos: () => Promise<TodoRecord[]>;
  addTodo: (input: DesktopTodoInput) => Promise<TodoRecord>;
  updateTodo: (id: string, input: DesktopTodoInput) => Promise<boolean>;
  addTodoFromJoystickEvent: (input: JoystickTodoEventInput) => Promise<TodoRecord | null>;
  completeTodo: (id: string) => Promise<boolean>;
  undoCompleteTodo: (id: string) => Promise<boolean>;
  removeTodo: (id: string) => Promise<boolean>;
  onTodoListChanged: (listener: (snapshot: TodoRecord[]) => void) => () => void;
};
type NetworkInterfaceMap = ReturnType<typeof os.networkInterfaces>;
const TODO_COMPLETION_RETENTION_MS = 30_000;

export function createDesktopLifecycle(input: { dataFile: string; instanceId?: string; discovery?: DiscoveryAdapter; port?: number; lanHost?: string; advertisedAddress?: string; displayName?: string; fingerprint?: string; onDiscoveryError?: (error: unknown) => void; serviceFactory?: typeof createDesktopService; identityStore?: ReturnType<typeof createTransportIdentityStore>; networkInterfaces?: () => NetworkInterfaceMap }) {
  const discovery = input.discovery ?? createMdnsDiscoveryAdapter();
  const serviceFactory = input.serviceFactory ?? createDesktopService;
  let selectedAddress = input.advertisedAddress;
  let status: DesktopStatus = { state: 'starting', lanEnabled: false, host: null, advertisedHost: null, port: null, baseUrl: null, instanceId: input.instanceId ?? 'desktop-local', protocol: 'https', fingerprint: null, discovery: 'stopped', discoveryError: null, lanError: null };
  let service: Awaited<ReturnType<typeof createDesktopService>>;
  let localServiceReady = false;
  let activeCertificate: string | undefined;
  const todoListeners = new Set<(snapshot: TodoRecord[]) => void>();
  const tipHistoryListeners = new Set<(snapshot: TipHistoryRecord[]) => void>();
  const todoExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearTodoExpiryTimers() {
    for (const timer of todoExpiryTimers.values()) clearTimeout(timer);
    todoExpiryTimers.clear();
  }

  async function listServiceTodos(): Promise<TodoRecord[]> {
    const listTodos = (service as typeof service & { listTodos?: () => Promise<TodoRecord[]> }).listTodos;
    return typeof listTodos === 'function' ? listTodos.call(service) : [];
  }

  async function listServiceTipHistory(): Promise<TipHistoryRecord[]> {
    const listTipHistory = (service as typeof service & { listTipHistory?: () => Promise<TipHistoryRecord[]> }).listTipHistory;
    return typeof listTipHistory === 'function' ? listTipHistory.call(service) : [];
  }

  function getServiceTime(): number {
    const getCurrentTime = (service as typeof service & { getCurrentTime?: () => number }).getCurrentTime;
    const currentTime = typeof getCurrentTime === 'function' ? getCurrentTime.call(service) : Date.now();
    return Number.isFinite(currentTime) ? currentTime : Date.now();
  }

  function syncTodoExpiryTimers(todos: TodoRecord[]) {
    const completed = new Map(todos.filter((todo) => todo.completedAt).map((todo) => [todo.id, todo]));
    for (const [id, timer] of todoExpiryTimers) {
      if (!completed.has(id)) {
        clearTimeout(timer);
        todoExpiryTimers.delete(id);
      }
    }
    for (const todo of completed.values()) {
      if (todoExpiryTimers.has(todo.id)) continue;
      const deadline = Date.parse(todo.completedAt!) + TODO_COMPLETION_RETENTION_MS;
      const delay = Math.max(0, deadline - getServiceTime());
      const timer = setTimeout(() => {
        if (todoExpiryTimers.get(todo.id) !== timer) return;
        todoExpiryTimers.delete(todo.id);
        void publishTodoSnapshot().catch(() => undefined);
      }, delay);
      todoExpiryTimers.set(todo.id, timer);
    }
  }

  async function publishTodoSnapshot() {
    const snapshot = await listServiceTodos();
    syncTodoExpiryTimers(snapshot);
    for (const listener of todoListeners) {
      try {
        listener(snapshot.map((todo) => ({ ...todo })));
      } catch {
        // Renderer subscriptions are independent; never let one listener break persistence or others.
      }
    }
  }

  async function publishTipHistorySnapshot() {
    const snapshot = await listServiceTipHistory();
    for (const listener of tipHistoryListeners) {
      try {
        listener(snapshot.map((entry) => ({ ...entry })));
      } catch {
        // History listeners are independent from persistence and one another.
      }
    }
  }

  return {
    getStatus: () => ({ ...status }),
    async start() {
      let replacement: typeof service | undefined;
      try {
        replacement = await serviceFactory({ dataFile: input.dataFile, instanceId: status.instanceId });
        if (!selectedAddress && replacement.getSettings) {
          selectedAddress = String((await replacement.getSettings()).settings.advertisedAddress ?? '') || undefined;
        }
        const todos = replacement.listTodos ? await replacement.listTodos() : [];
        const previous = service;
        service = replacement;
        localServiceReady = true;
        clearTodoExpiryTimers();
        status = { ...status, state: 'ready' };
        syncTodoExpiryTimers(todos);
        if (previous && previous !== replacement) await closeService(previous).catch(() => undefined);
        return { ...status };
      } catch (error) {
        if (replacement && replacement !== service) await closeService(replacement).catch(() => undefined);
        throw error;
      }
    },
    async listTodos() {
      if (!service) throw new Error('desktop service is unavailable');
      const todos = await listServiceTodos();
      syncTodoExpiryTimers(todos);
      return todos;
    },
    async addTodo(todo: DesktopTodoInput) {
      if (!service) throw new Error('desktop service is unavailable');
      const added = await service.addTodo(todo);
      await publishTodoSnapshot();
      return added;
    },
    async updateTodo(id: string, todo: DesktopTodoInput) {
      if (!service) throw new Error('desktop service is unavailable');
      const updated = await service.updateTodo(id, todo);
      if (updated) await publishTodoSnapshot();
      return updated;
    },
    async addTodoFromJoystickEvent(todo: JoystickTodoEventInput) {
      if (!service) throw new Error('desktop service is unavailable');
      const added = await service.createJoystickTodoFromEvent(todo);
      if (added) await publishTodoSnapshot();
      return added;
    },
    async listTipHistory() {
      if (!service) throw new Error('desktop service is unavailable');
      return listServiceTipHistory();
    },
    async addTipHistoryFromJoystickEvent(entry: TipHistoryRecord) {
      if (!service) throw new Error('desktop service is unavailable');
      const added = await service.recordTipHistory(entry);
      if (added) await publishTipHistorySnapshot();
      return added;
    },
    onTipHistoryChanged(listener: (snapshot: TipHistoryRecord[]) => void) {
      tipHistoryListeners.add(listener);
      return () => tipHistoryListeners.delete(listener);
    },
    async completeTodo(id: string) {
      if (!service) throw new Error('desktop service is unavailable');
      const completed = await service.completeTodo(id);
      if (completed) await publishTodoSnapshot();
      return completed;
    },
    async undoCompleteTodo(id: string) {
      if (!service) throw new Error('desktop service is unavailable');
      const reopened = await service.undoCompleteTodo(id);
      if (reopened) await publishTodoSnapshot();
      return reopened;
    },
    async removeTodo(id: string) {
      if (!service) throw new Error('desktop service is unavailable');
      const removed = await service.removeTodo(id);
      if (removed) await publishTodoSnapshot();
      return removed;
    },
    onTodoListChanged(listener: (snapshot: TodoRecord[]) => void) {
      todoListeners.add(listener);
      return () => todoListeners.delete(listener);
    },
      listNetworkInterfaces: () => enumerateEligibleInterfaces(input.networkInterfaces ?? os.networkInterfaces),
      async enableLan() {
        const wasLanEnabled = status.lanEnabled;
        let replacement: typeof service | undefined;
        try {
          if (wasLanEnabled) {
            await discovery.stop();
            status = { ...status, discovery: 'stopped', discoveryError: null };
          }
          if (wasLanEnabled && !localServiceReady) {
            await closeService(service);
            service = undefined as unknown as typeof service;
            activeCertificate = undefined;
            status = {
              ...status,
              lanEnabled: false,
              host: null,
              advertisedHost: null,
              port: null,
              baseUrl: null,
              fingerprint: null,
            };
          }

          const getInterfaces = input.networkInterfaces ?? os.networkInterfaces;
          const lanHost = resolveLanHost(input.lanHost);
          const advertisedHost = selectedAddress
            ?? (isAllInterfaceHost(lanHost) ? resolveAdvertisedHost(getInterfaces) : lanHost);
          if (selectedAddress) assertAdvertisableHost(advertisedHost, getInterfaces);

          const identityStore = input.identityStore
            ?? createTransportIdentityStore(input.dataFile === ':memory:'
              ? { get: async () => null, set: async () => {} }
              : createProtectedFileStore(`${input.dataFile}.transport`));
          const eligibleAddresses = enumerateEligibleInterfaces(getInterfaces)
            .map(({ address }) => address)
            .filter((address) => !address.includes('%'));
          const identity = await identityStore.loadOrCreate(advertisedHost, eligibleAddresses);
          assertCertificateCoversHost(identity.cert, advertisedHost);

          replacement = await serviceFactory({ dataFile: input.dataFile, instanceId: status.instanceId, tls: identity });
          const address = await replacement.start(input.port ?? 0, lanHost) as { address?: string; port: number };
          const todos = replacement.listTodos ? await replacement.listTodos() : [];
          const previous = service;
          service = replacement;
          activeCertificate = identity.cert;
          syncTodoExpiryTimers(todos);
          if (previous && previous !== replacement) await closeService(previous).catch(() => undefined);

          const baseUrl = `https://${formatHost(advertisedHost)}:${address.port}`;
          status = {
            ...status,
            state: 'ready',
            lanEnabled: true,
            host: lanHost,
            advertisedHost,
            port: address.port,
            baseUrl,
            fingerprint: identity.fingerprint,
            discovery: 'stopped',
            discoveryError: null,
            lanError: null,
          };
          await publish();
          return { ...status };
        } catch (error) {
          if (replacement && replacement !== service) await closeService(replacement).catch(() => undefined);
          const message = normalizeLanStartupError(error);
          const code = (error as { code?: string })?.code === 'NO_ADDRESS' ? 'NO_ADDRESS' : 'LAN_STARTUP_FAILED';
          const lanError = { code, message, retryable: true } as const;
          if (localServiceReady && wasLanEnabled) {
            status = { ...status, discovery: 'stopped', lanError };
          } else {
            activeCertificate = undefined;
            status = {
              ...status,
              lanEnabled: false,
              host: null,
              advertisedHost: null,
              port: null,
              baseUrl: null,
              fingerprint: null,
              discovery: 'stopped',
              discoveryError: null,
              lanError,
            };
          }
          return { ...status };
        }
      },
      async retryAdvertising() { if (!status.lanEnabled) throw new Error('enable LAN access before advertising'); await publish(); return { ...status }; },
      async setAdvertisedAddress(address: string) {
        assertAdvertisableHost(address, input.networkInterfaces ?? os.networkInterfaces);
        if (status.lanEnabled) {
          assertCertificateCoversHost(activeCertificate ?? '', address);
          const baseUrl = `https://${formatHost(address)}:${status.port}`;
          selectedAddress = address;
          if (service?.saveSettings) await service.saveSettings({ ...(await service.getSettings()).settings, advertisedAddress: address });
          status = { ...status, advertisedHost: address, baseUrl, discovery: 'stopped', discoveryError: null };
          await publish();
        } else {
          selectedAddress = address;
        }
        return { ...status, advertisedHost: address };
      },
          async disableLan() { try { await discovery.stop(); } catch (error) { input.onDiscoveryError?.(error); } if (service) await service.stop(); activeCertificate = undefined; status = { ...status, lanEnabled: false, host: null, advertisedHost: null, port: null, baseUrl: null, fingerprint: null, discovery: 'stopped', discoveryError: null, lanError: null }; },
           async stop() { clearTodoExpiryTimers(); try { await discovery.stop(); } catch (error) { input.onDiscoveryError?.(error); } await closeService(service); service = undefined as unknown as typeof service; localServiceReady = false; activeCertificate = undefined; status = { ...status, state: 'stopped', lanEnabled: false, host: null, advertisedHost: null, port: null, baseUrl: null, fingerprint: null, discovery: 'stopped', discoveryError: null }; },
     request: (...args: Parameters<typeof service.request>) => service.request(...args),
     listDevices: () => service.listDevices(),
      listConnectionRequests: () => service.listLocalConnectionRequests(),
      approveConnectionRequest: (requestId: string, code: string) => service.approveLocalConnectionRequest(requestId, code),
      revokeDevice: (deviceId: string) => service.revokeDevice(deviceId),
      getSettings: () => service?.getSettings() ?? emptySettingsSnapshot(),
      claimWhisperAttempt: (attempt: Parameters<NonNullable<typeof service>['claimWhisperAttempt']>[0]) => {
        if (!service) throw new Error('desktop service is unavailable');
        return service.claimWhisperAttempt(attempt);
      },
      pruneWhisperAttempts: (now: number) => {
        if (!service) throw new Error('desktop service is unavailable');
        return service.pruneWhisperAttempts(now);
      },
      async saveSettings(settings: Record<string, unknown>) {
        if (!service) throw new Error('desktop service is unavailable; start lifecycle before saving settings');
        return service.saveSettings(settings);
      },
   };

  async function publish() {
    if (!status.lanEnabled || !status.port || !status.advertisedHost || !status.fingerprint) return;
    status = { ...status, discovery: 'stopped', discoveryError: null };
    const { advertisedHost, port, instanceId, fingerprint } = status;
    try {
      await discovery.stop();
      await discovery.start({ host: advertisedHost!, port: port!, instanceId, displayName: input.displayName ?? 'Prismata desktop', fingerprint: fingerprint!, pairingRequired: true });
      status = { ...status, discovery: 'advertising', discoveryError: null };
    } catch (error) {
      status = { ...status, discovery: 'error', discoveryError: error instanceof Error ? error.message : String(error) };
      input.onDiscoveryError?.(error);
    }
  }
}

function emptySettingsSnapshot(): SettingsSnapshot {
  return { settings: {}, revision: 0, updatedAt: new Date(0).toISOString(), origin: 'desktop' };
}

function resolveLanHost(configuredHost: string | undefined): string {
  if (configuredHost !== undefined) {
    if (isAllInterfaceHost(configuredHost)) return configuredHost;
    if (!isPrivateLanHost(configuredHost)) throw new Error('configured lanHost must be a private RFC1918 IPv4 address');
    return configuredHost;
  }
  return '0.0.0.0';
}

function resolveAdvertisedHost(getInterfaces: () => NetworkInterfaceMap): string {
  const interfaces = enumerateEligibleInterfaces(getInterfaces);
  const privateHost = interfaces.find((address) => address.family === 'IPv4' && isPrivateLanHost(address.address));
  if (privateHost) return privateHost.address;
  const reachableHost = interfaces.find((address) => address.family === 'IPv4');
  if (reachableHost) return reachableHost.address;
  const error = new Error('NO_ADDRESS') as Error & { code: string };
  error.code = 'NO_ADDRESS';
  throw error;
}

export function enumerateEligibleInterfaces(getInterfaces: () => NetworkInterfaceMap): NetworkInterfaceChoice[] {
  return Object.entries(getInterfaces()).flatMap(([name, addresses]) => (addresses ?? []).filter((address) => !address.internal && !address.address.includes('%') && isReachableAddress(address.address) && !isDirectedBroadcast(address.address, address.netmask, address.family)).map((address) => ({ name, address: address.address, family: address.family as 'IPv4' | 'IPv6' })));
}

function isReachableAddress(address: string) {
  return isCanonicalReachableAddress(address);
}

function assertAdvertisableHost(host: string, getInterfaces: () => NetworkInterfaceMap) {
  if (host.includes('%')) throw new Error('scoped IPv6 advertised addresses are unsupported');
  if (!isReachableAddress(host) || !enumerateEligibleInterfaces(getInterfaces).some((choice) => choice.address === host)) throw new Error('advertised address must be an eligible reachable interface address');
}

function isDirectedBroadcast(address: string, netmask: string | undefined, family: string): boolean {
  if (family !== 'IPv4' || !netmask) return false;
  const ip = ipv4Number(address);
  const mask = ipv4Number(netmask);
  if (ip === undefined || mask === undefined || !isContiguousMask(mask)) return false;
  const hostMask = (~mask) >>> 0;
  return hostMask > 1 && (ip & hostMask) === hostMask;
}

function ipv4Number(value: string): number | undefined {
  const octets = value.split('.').map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? (((octets[0] << 24) >>> 0) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
    : undefined;
}

function isContiguousMask(mask: number): boolean {
  return ((mask | (mask - 1)) >>> 0) === 0xffffffff;
}

function assertCertificateCoversHost(cert: string, host: string) {
  if (!certificateCoversHost(cert, host)) throw new Error('certificate does not cover advertised address');
}

function isPrivateLanHost(host: string | undefined): host is string {
  if (!host) return false;
  const octets = host.split('.').map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) && (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

function isAllInterfaceHost(host: string | undefined): host is '0.0.0.0' { return host === '0.0.0.0'; }

function formatHost(host: string) { return host.includes(':') ? `[${host.split('%').join('%25')}]` : host; }
function isFingerprint(value: string | undefined): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }

function normalizeLanStartupError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === 'NO_ADDRESS') return 'No eligible network address is available. Connect to a LAN or select an interface, then retry.';
  if (code === 'EADDRINUSE') return 'LAN port is already in use; choose another port or stop the conflicting service';
  if (code === 'EACCES') return 'LAN port is not permitted; choose a port above 1024 or grant permission';
  return error instanceof Error ? error.message : String(error);
}

async function closeService(service: Awaited<ReturnType<typeof createDesktopService>> | undefined) {
  if (!service) return;
  if (service.close) await service.close();
  else await service.stop();
}
