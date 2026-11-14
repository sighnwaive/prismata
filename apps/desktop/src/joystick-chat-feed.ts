export const JOYSTICK_CHAT_FEED_LIMIT = 26;

export type JoystickChatMessage = {
  id: string;
  author: string;
  text: string;
  authorColor: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function singleLine(value: unknown, maxLength: number): string | undefined {
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

function normalizeAuthorColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const color = value.trim();
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) return color;
  if (/^(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\)$/i.test(color)) return color;
  if (/^[a-z]{3,20}$/i.test(color) && !/^(?:inherit|initial|unset|revert|currentcolor|transparent)$/i.test(color)) return color;
  return undefined;
}

/** A deterministic pseudo-random color keeps uncolored usernames consistent across sessions. */
export function generatedAuthorColor(author: string): string {
  const key = author.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  const hue = unsigned % 360;
  const saturation = 68 + ((unsigned >>> 8) % 12);
  const lightness = 68 + ((unsigned >>> 16) % 7);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function parseJoystickChatMessage(value: unknown): JoystickChatMessage | null {
  if (!isRecord(value)) return null;
  const event = isRecord(value.event) ? value.event : value;
  if (event.v !== 2 || event.type !== 'new_message' || event.topic !== 'chat.message'
    || typeof event.id !== 'string' || !event.id.trim() || event.id.trim().length > 512
    || !isRecord(event.data) || event.data.visibility !== 'public' || !isRecord(event.data.author)) return null;

  const author = event.data.author;
  const message = typeof event.data.text === 'string' ? event.data.text
    : typeof event.data.message === 'string' ? event.data.message
      : isRecord(event.data.message) && typeof event.data.message.text === 'string' ? event.data.message.text : undefined;
  const name = singleLine(author.display_name ?? author.username ?? author.name, 80);
  const text = singleLine(message, 500);
  if (!name || !text) return null;

  const authorColor = normalizeAuthorColor(author.color ?? author.chat_color ?? author.username_color)
    ?? generatedAuthorColor(singleLine(author.username ?? author.name ?? name, 80) ?? name);
  return { id: event.id.trim(), author: name, text, authorColor };
}

function responseRecords(value: unknown, depth = 0): Record<string, unknown>[] {
  if (!isRecord(value) || depth > 4) return [];
  const nested = ['event', 'data', 'message', 'result', 'chat_message']
    .flatMap((key) => responseRecords(value[key], depth + 1));
  return [value, ...nested];
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() && value.length <= 512) return value.trim();
  }
  return undefined;
}

export function createJoystickChatFeed() {
  let messages: JoystickChatMessage[] = [];
  let localMessageSequence = 0;
  const listeners = new Set<(messages: JoystickChatMessage[]) => void>();

  const snapshot = () => messages.map((message) => ({ ...message }));
  const publish = () => {
    const current = snapshot();
    for (const listener of listeners) {
      try { listener(current.map((message) => ({ ...message }))); } catch { /* UI listeners cannot interrupt gateway processing. */ }
    }
  };
  const addMessage = (message: JoystickChatMessage) => {
    const existingIndex = messages.findIndex((current) => current.id === message.id);
    if (existingIndex >= 0) {
      // A POST response may only contain an ID. Keep the Prismata label while
      // refreshing the row with the Gateway's authoritative message/color.
      if (messages[existingIndex]?.author === 'Prismata' && message.author !== 'Prismata') {
        messages = messages.map((current, index) => index === existingIndex
          ? { ...message, author: 'Prismata' }
          : current);
        publish();
      }
      return;
    }
    messages = [...messages, message].slice(-JOYSTICK_CHAT_FEED_LIMIT);
    publish();
  };

  return {
    list: snapshot,
    onListChanged(listener: (messages: JoystickChatMessage[]) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onGatewayEvent(event: unknown) {
      const message = parseJoystickChatMessage(event);
      if (message) addMessage(message);
    },
    onMessageSent(text: string, response?: unknown) {
      const records = responseRecords(response);
      const returnedEvent = parseJoystickChatMessage(response);
      if (returnedEvent) {
        addMessage({ ...returnedEvent, author: 'Prismata' });
        return;
      }
      const responseRecord = records.find((record) => isRecord(record.author) || isRecord(record.user)) ?? records[0];
      const authorValue = responseRecord && (isRecord(responseRecord.author) ? responseRecord.author
        : isRecord(responseRecord.user) ? responseRecord.user : undefined);
      const author = authorValue
        ? singleLine(authorValue.display_name ?? authorValue.username ?? authorValue.name, 80)
        : undefined;
      const authorIdentity = authorValue
        ? singleLine(authorValue.username ?? authorValue.name ?? author, 80)
        : undefined;
      const authorColor = authorValue
        ? normalizeAuthorColor(authorValue.color ?? authorValue.chat_color ?? authorValue.username_color)
        : undefined;
      const serverId = (responseRecord && stringField(responseRecord, 'id', 'message_id'))
        ?? records.map((record) => stringField(record, 'id', 'message_id')).find(Boolean);
      const safeText = singleLine(text, 500);
      if (!safeText) return;
      localMessageSequence += 1;
      addMessage({
        id: serverId ?? `sent-local-${localMessageSequence}`,
        author: 'Prismata',
        text: safeText,
        authorColor: authorColor ?? generatedAuthorColor(authorIdentity ?? 'Prismata'),
      });
    },
  };
}
