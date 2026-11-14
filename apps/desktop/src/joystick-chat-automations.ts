export type DropInChatAutomation = { enabled: boolean; messages: string[] };
export type JoystickChatAutomationSettings = { dropIn: DropInChatAutomation };

export const MAX_DROP_IN_CHAT_MESSAGES = 10;
export const MAX_DROP_IN_CHAT_MESSAGE_LENGTH = 500;

const defaultDropInAutomation: DropInChatAutomation = { enabled: false, messages: [] };

export const defaultJoystickChatAutomationSettings: JoystickChatAutomationSettings = {
  dropIn: { ...defaultDropInAutomation, messages: [] },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeDropIn(value: unknown): DropInChatAutomation {
  if (!isRecord(value)) return { ...defaultDropInAutomation, messages: [] };
  const messages = Array.isArray(value.messages)
    ? value.messages
      .filter((message): message is string => typeof message === 'string')
      .map((message) => message.trim())
      .filter((message) => message.length > 0 && message.length <= MAX_DROP_IN_CHAT_MESSAGE_LENGTH)
      .slice(0, MAX_DROP_IN_CHAT_MESSAGES)
    : [];
  return { enabled: value.enabled === true && messages.length > 0, messages };
}

export function normalizeJoystickChatAutomationSettings(value: unknown): JoystickChatAutomationSettings {
  return isRecord(value)
    ? { dropIn: normalizeDropIn(value.dropIn) }
    : { dropIn: { ...defaultDropInAutomation, messages: [] } };
}
