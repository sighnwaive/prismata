import { createJoystickChatClient } from './joystick-chat.js';
import type { JoystickTrafficDiagnostic } from './joystick-traffic-diagnostics.js';
import { isJoystickStreamLive, type JoystickStreamStateReader } from './joystick-stream-state.js';

export const DIRECT_MESSAGE_MAX_LENGTH = 500;

export function normalizeDirectMessage(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('Message is required');
  if (value.length > DIRECT_MESSAGE_MAX_LENGTH) throw new TypeError(`Message must be ${DIRECT_MESSAGE_MAX_LENGTH} characters or fewer`);
  return value;
}

export function createDirectMessageSender(input: {
  getAccessToken: () => string | undefined;
  getStreamState: JoystickStreamStateReader;
  onMessageSent?: (text: string, response: unknown) => void;
  createClient?: (accessToken: string) => Pick<ReturnType<typeof createJoystickChatClient>, 'sendMessage'>;
  fetchImpl?: typeof fetch;
  onDiagnostic?: JoystickTrafficDiagnostic;
  log?: (message: string) => void;
}) {
  const log = input.log ?? (() => undefined);
  return async (value: unknown): Promise<void> => {
    const text = normalizeDirectMessage(value);
    if (!isJoystickStreamLive(input.getStreamState)) {
      log('Direct message skipped: stream is not live');
      throw new Error('Joystick chat is only available while your stream is live');
    }
    const accessToken = input.getAccessToken();
    if (!accessToken) {
      log('Direct message skipped: authenticated Joystick session unavailable');
      throw new Error('Authenticated Joystick session unavailable');
    }
    try {
      const client = input.createClient?.(accessToken) ?? createJoystickChatClient({
        accessToken,
        getStreamState: input.getStreamState,
        fetchImpl: input.fetchImpl,
        onDiagnostic: input.onDiagnostic,
      });
      const response = await client.sendMessage({ text });
      try { input.onMessageSent?.(text, response); } catch { /* The UI feed cannot turn a successful delivery into a send failure. */ }
    } catch (error) {
      log('Direct message delivery failed');
      throw error instanceof Error ? error : new Error('Direct message delivery failed');
    }
  };
}
