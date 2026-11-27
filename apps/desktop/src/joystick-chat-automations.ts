export type DropInChatAutomation = { enabled: boolean; messages: string[] };
export type SlashCommand = { name: string; response: string; enabled: boolean };
export type SlashCommandSettings = { prefix: string; commands: SlashCommand[] };
export type JoystickChatAutomationSettings = {
  dropIn: DropInChatAutomation;
  slashCommands?: SlashCommandSettings;
};

export const MAX_DROP_IN_CHAT_MESSAGES = 10;
export const MAX_DROP_IN_CHAT_MESSAGE_LENGTH = 500;
export const MAX_SLASH_COMMANDS = 50;
export const MAX_SLASH_COMMAND_NAME_LENGTH = 64;
export const MAX_SLASH_COMMAND_RESPONSE_LENGTH = 500;

const defaultDropInAutomation: DropInChatAutomation = { enabled: false, messages: [] };
const defaultSlashCommandSettings: SlashCommandSettings = { prefix: '!', commands: [] };

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

function normalizeSlashCommands(value: unknown): SlashCommandSettings {
  if (!isRecord(value)) return { ...defaultSlashCommandSettings, commands: [] };
  const prefix = typeof value.prefix === 'string'
    && /^\p{P}$/u.test(value.prefix)
    ? value.prefix : defaultSlashCommandSettings.prefix;
  const seenNames = new Set<string>();
  const commands: SlashCommand[] = [];
  if (Array.isArray(value.commands)) {
    for (const item of value.commands.slice(0, MAX_SLASH_COMMANDS)) {
      if (!isRecord(item) || typeof item.name !== 'string') continue;
      const name = item.name.trim();
      if (typeof item.response !== 'string' && item.response !== undefined) continue;
      const response = typeof item.response === 'string' ? item.response.trim() : '';
      if (response.length > MAX_SLASH_COMMAND_RESPONSE_LENGTH) continue;
      // Keep incomplete drafts so the editor can continue saving either field.
      if (!name) {
        commands.push({ name: '', response, enabled: false });
        continue;
      }
      if (name.length > MAX_SLASH_COMMAND_NAME_LENGTH || /\s/.test(name)) continue;
      const key = name.toLocaleLowerCase('en-US');
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      commands.push({
        name,
        response,
        enabled: item.enabled === true && response.length > 0,
      });
    }
  }
  return { prefix, commands };
}

export function normalizeJoystickChatAutomationSettings(value: unknown): JoystickChatAutomationSettings {
  if (!isRecord(value)) {
    return {
      dropIn: normalizeDropIn(undefined),
      slashCommands: normalizeSlashCommands(undefined),
    };
  }
  return {
    dropIn: normalizeDropIn(value.dropIn),
    ...(Object.prototype.hasOwnProperty.call(value, 'slashCommands')
      ? { slashCommands: normalizeSlashCommands(value.slashCommands) }
      : {}),
  };
}
