import type { FlipACoinMessage } from './flip-a-coin-scheduler.js';
import { fetchWithJoystickDiagnostics, type JoystickTrafficDiagnostic } from './joystick-traffic-diagnostics.js';
import { isJoystickStreamLive, type JoystickStreamStateReader } from './joystick-stream-state.js';

export const JOYSTICK_CHAT_MESSAGES_ENDPOINT = 'https://api.joystick.tv/api/v1/chat/messages';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type JoystickChatResponse = Record<string, unknown> | undefined;
type PublicChatDelivery = () => Promise<unknown>;

export type JoystickChatCooldown = {
  onGatewayEvent: (event: unknown) => void;
  send: (text: string, deliver: PublicChatDelivery) => Promise<boolean>;
};

type JoystickChatEventHandler = (event: unknown) => unknown;

const JOYSTICK_CHAT_COOLDOWN_EVENTS = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQualifyingPublicChatEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const event = isRecord(value.event) ? value.event : value;
  if (event.v !== 2 || event.type !== 'new_message' || event.topic !== 'chat.message' || !isRecord(event.data)) return false;
  const author = event.data.author;
  return isRecord(author)
    && isRecord(author.badges)
    && author.badges.bot === false
    && event.data.visibility === 'public';
}

export function createJoystickChatCooldown(): JoystickChatCooldown {
  const remainingEvents = new Map<string, number>();
  const deliveriesInProgress = new Set<string>();

  return {
    onGatewayEvent(event) {
      if (!isQualifyingPublicChatEvent(event)) return;
      for (const [text, remaining] of remainingEvents) {
        if (remaining <= 1) remainingEvents.delete(text);
        else remainingEvents.set(text, remaining - 1);
      }
    },
    async send(text, deliver) {
      if (remainingEvents.has(text) || deliveriesInProgress.has(text)) return false;
      deliveriesInProgress.add(text);
      try {
        await deliver();
        remainingEvents.set(text, JOYSTICK_CHAT_COOLDOWN_EVENTS);
        return true;
      } finally {
        deliveriesInProgress.delete(text);
      }
    },
  };
}

export function createJoystickChatEventHandler(
  cooldown: Pick<JoystickChatCooldown, 'onGatewayEvent'>,
  onEvent: JoystickChatEventHandler,
): JoystickChatEventHandler {
  return (event) => {
    cooldown.onGatewayEvent(event);
    return onEvent(event);
  };
}

export function createJoystickChatClient(input: {
  accessToken: string;
  getStreamState: JoystickStreamStateReader;
  fetchImpl?: FetchLike;
  onDiagnostic?: JoystickTrafficDiagnostic;
}) {
  if (typeof input.accessToken !== 'string' || input.accessToken.trim() === '') {
    throw new TypeError('accessToken is required');
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch is required');

  return {
    async sendMessage(message: { text: string }): Promise<JoystickChatResponse> {
      if (typeof message.text !== 'string') throw new TypeError('text must be a string');
      if (message.text.trim() === '') throw new TypeError('text is required');
      if (!isJoystickStreamLive(input.getStreamState)) {
        throw new Error('Joystick chat is only available while your stream is live');
      }
      let response: Response;
      try {
        response = await fetchWithJoystickDiagnostics(fetchImpl, JOYSTICK_CHAT_MESSAGES_ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: message.text }),
        }, input.onDiagnostic);
      } catch (error) {
        throw new Error(`Joystick chat request failed: ${error instanceof Error ? error.message : 'network error'}`);
      }
      const raw = await response.text();
      let body: unknown;
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }
      if (!response.ok) {
        const detail = typeof body === 'string' ? body : body && typeof body === 'object' ? JSON.stringify(body) : '';
        throw new Error(`Joystick chat request failed with status ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
      }
      if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body))) {
        throw new Error('Joystick chat response was not a JSON object');
      }
      return body as JoystickChatResponse;
    },
  };
}

export function createAuthenticatedJoystickChatSender(input: {
  getAccessToken: () => string | undefined;
  getStreamState: JoystickStreamStateReader;
  onMessageSent?: (text: string, response: unknown) => void;
  cooldown?: JoystickChatCooldown;
  createClient?: (accessToken: string) => Pick<ReturnType<typeof createJoystickChatClient>, 'sendMessage'>;
  fetchImpl?: FetchLike;
  onDiagnostic?: JoystickTrafficDiagnostic;
  log?: (message: string) => void;
  throwIfUnavailable?: boolean;
  throwOnError?: boolean;
}) {
  const log = input.log ?? (() => undefined);
  return async (payload: FlipACoinMessage): Promise<void> => {
    if (!isJoystickStreamLive(input.getStreamState)) {
      log('Joystick chat send skipped: stream is not live');
      if (input.throwOnError) throw new Error('Joystick chat is only available while your stream is live');
      return;
    }
    const accessToken = input.getAccessToken();
    if (!accessToken) {
      log('Joystick chat send skipped: authenticated session unavailable');
      if (input.throwIfUnavailable) throw new Error('Authenticated Joystick session unavailable');
      return;
    }
    try {
      const client = input.createClient?.(accessToken) ?? createJoystickChatClient({
        accessToken,
        getStreamState: input.getStreamState,
        fetchImpl: input.fetchImpl,
        onDiagnostic: input.onDiagnostic,
      });
      const deliver = async () => {
        const response = await client.sendMessage({ text: payload.message });
        try { input.onMessageSent?.(payload.message, response); } catch { /* Feed errors cannot turn a successful delivery into a failure. */ }
      };
      if (input.cooldown) await input.cooldown.send(payload.message, deliver);
      else await deliver();
    } catch (error) {
      log('Flip a Coin delivery failed');
      if (input.throwOnError) throw error;
    }
  };
}
