import type { DesktopAuthSnapshot } from '../src/auth-coordinator.js';
import type { DesktopStatus, NetworkInterfaceChoice } from '../src/desktop-lifecycle.js';
import type { ReminderRecord, ReminderSettings } from '../src/reminder-settings.js';
import type { JoystickWhisperSettings } from '../src/joystick-whisper-settings.js';
import type { JoystickChatAutomationSettings } from '../src/joystick-chat-automations.js';
import type { JoystickWhisperStatus } from './joystick-whisper-runtime.js';
import type { TipHistoryRecord, TodoRecord } from '../src/local-store.js';
import type { JoystickChatMessage } from '../src/joystick-chat-feed.js';

export type DesktopAuthPreloadApi = {
  getSnapshot: () => Promise<DesktopAuthSnapshot>;
  signInWithJoystick: () => Promise<void>;
  cancel: () => Promise<void>;
  signOut: () => Promise<void>;
  onStateChanged: (listener: (snapshot: DesktopAuthSnapshot) => void) => () => void;
};

export type DesktopAdminPreloadApi = {
  getStatus: () => Promise<DesktopStatus>;
  setLanEnabled: (enabled: boolean) => Promise<DesktopStatus>;
  listNetworkInterfaces: () => Promise<NetworkInterfaceChoice[]>;
  setAdvertisedAddress: (address: string) => Promise<DesktopStatus>;
  retryAdvertising: () => Promise<DesktopStatus>;
  listDevices: () => Promise<Array<{ deviceId: string; deviceName: string; lastSeenAt?: string }>>;
  revokeDevice: (deviceId: string) => Promise<void>;
  listConnectionRequests: () => Promise<Array<{ requestId: string; deviceId: string; deviceName: string; code?: string; expiresAt: string; status: string }>>;
  approveConnectionRequest: (requestId: string, code: string) => Promise<unknown>;
};

export type ManualTodoInput = { itemName: string; viewer?: string; note?: string };
export type TodoPreloadApi = {
  list: () => Promise<TodoRecord[]>;
  add: (input: ManualTodoInput) => Promise<TodoRecord>;
  update: (id: string, input: ManualTodoInput) => Promise<void>;
  complete: (id: string) => Promise<void>;
  undoComplete: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  onListChanged: (listener: (todos: TodoRecord[]) => void) => () => void;
};

export type TipHistoryPreloadApi = {
  list: () => Promise<TipHistoryRecord[]>;
  onListChanged: (listener: (history: TipHistoryRecord[]) => void) => () => void;
};

export type JoystickChatPreloadApi = {
  list: () => Promise<JoystickChatMessage[]>;
  onListChanged: (listener: (messages: JoystickChatMessage[]) => void) => () => void;
};

export type DesktopPreloadApi = {
  auth: DesktopAuthPreloadApi;
  admin: DesktopAdminPreloadApi;
  todos: TodoPreloadApi;
  tipHistory: TipHistoryPreloadApi;
  joystickChat: JoystickChatPreloadApi;
  reminder: ReminderPreloadApi;
  directMessage: DirectMessagePreloadApi;
  joystickWhispers: JoystickWhisperPreloadApi;
  joystickChatAutomations: JoystickChatAutomationPreloadApi;
};

export type DirectMessagePreloadApi = { send: (text: string) => Promise<{ ok: true }> };

export type ReminderPreloadApi = {
  get: () => Promise<ReminderSettings>;
  update: (settings: ReminderSettings) => Promise<ReminderSettings>;
  test: (settings: ReminderSettings) => Promise<{ ok: true }>;
  list?: () => Promise<ReminderRecord[]>;
  create?: (settings: ReminderSettings) => Promise<ReminderRecord>;
  updateRecord?: (id: string, settings: ReminderSettings) => Promise<ReminderRecord>;
  remove?: (id: string) => Promise<void>;
  testRecord?: (id: string) => Promise<{ ok: true }>;
};

export type JoystickWhisperPreloadApi = {
  getSettings: () => Promise<JoystickWhisperSettings>;
  updateSettings: (settings: JoystickWhisperSettings) => Promise<JoystickWhisperSettings>;
  getStatus: () => Promise<JoystickWhisperStatus>;
  onStatusChanged: (listener: (status: JoystickWhisperStatus) => void) => () => void;
};

export type JoystickChatAutomationPreloadApi = {
  getSettings: () => Promise<JoystickChatAutomationSettings>;
  updateSettings: (settings: JoystickChatAutomationSettings) => Promise<JoystickChatAutomationSettings>;
};

export function createReminderPreloadApi<T extends Partial<ReminderPreloadApi>>(input: T): T { return input; }

export function createTodoPreloadApi(input: TodoPreloadApi): TodoPreloadApi {
  return {
    list: () => input.list(),
    add: (todo) => input.add(todo),
    update: (id, todo) => input.update(id, todo),
    complete: (id) => input.complete(id),
    undoComplete: (id) => input.undoComplete(id),
    remove: (id) => input.remove(id),
    onListChanged(listener) {
      let active = true;
      const unsubscribe = input.onListChanged((todos) => {
        if (active) listener(todos);
      });
      return () => {
        if (!active) return;
        active = false;
        unsubscribe();
      };
    },
  };
}

export function createTipHistoryPreloadApi(input: TipHistoryPreloadApi): TipHistoryPreloadApi {
  return {
    list: () => input.list(),
    onListChanged(listener) {
      let active = true;
      const unsubscribe = input.onListChanged((history) => {
        if (active) listener(history);
      });
      return () => {
        if (!active) return;
        active = false;
        unsubscribe();
      };
    },
  };
}

export function createJoystickChatPreloadApi(input: JoystickChatPreloadApi): JoystickChatPreloadApi {
  return {
    list: () => input.list(),
    onListChanged(listener) {
      let active = true;
      const unsubscribe = input.onListChanged((messages) => {
        if (active) listener(messages);
      });
      return () => {
        if (!active) return;
        active = false;
        unsubscribe();
      };
    },
  };
}

export function createJoystickWhisperPreloadApi(input: JoystickWhisperPreloadApi): JoystickWhisperPreloadApi { return input; }
export function createJoystickChatAutomationPreloadApi(input: JoystickChatAutomationPreloadApi): JoystickChatAutomationPreloadApi { return input; }

export function createAuthPreloadApi(input: DesktopAuthPreloadApi): DesktopAuthPreloadApi {
  return input;
}

export function createDirectMessagePreloadApi(input: DirectMessagePreloadApi): DirectMessagePreloadApi { return input; }
