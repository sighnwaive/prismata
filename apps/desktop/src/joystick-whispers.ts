import { fetchWithJoystickDiagnostics, type JoystickTrafficDiagnostic } from './joystick-traffic-diagnostics.js';
import { isJoystickStreamLive, type JoystickStreamStateReader } from './joystick-stream-state.js';

export const JOYSTICK_WHISPERS_ENDPOINT = 'https://api.joystick.tv/api/v1/chat/whispers';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function isUsername(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !/\s/.test(value);
}

function unconfirmedWhisperError(status?: number): Error {
  const error = new Error('Joystick whisper delivery could not be confirmed') as Error & { status?: number };
  if (status !== undefined) error.status = status;
  return error;
}

export function createJoystickWhisperClient(input: {
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
    async sendWhisper(whisper: { username: string; text: string }): Promise<void> {
      if (!isUsername(whisper.username)) throw new TypeError('username is required');
      if (typeof whisper.text !== 'string' || whisper.text.trim() === '') throw new TypeError('text is required');
      if (!isJoystickStreamLive(input.getStreamState)) {
        throw new Error('Joystick whispers are only available while your stream is live');
      }

      const response = await fetchWithJoystickDiagnostics(fetchImpl, JOYSTICK_WHISPERS_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ username: whisper.username, text: whisper.text }),
      }, input.onDiagnostic);
      if (!response.ok) throw unconfirmedWhisperError(response.status);

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw unconfirmedWhisperError();
      }
      if (!isRecord(body) || body.sent !== true || typeof body.username !== 'string'
        || body.username.toLowerCase() !== whisper.username.toLowerCase()) {
        throw unconfirmedWhisperError();
      }
    },
  };
}

type WhisperRule = { enabled: boolean; message: string };
type WhisperRuleName = 'followed' | 'subscribed' | 'resubscribed' | 'giftSender';
type WhisperAttemptStore = {
  claimWhisperAttempt(attempt: { eventId: string; rule: WhisperRuleName; recipient: string; attemptedAt: string }): Promise<boolean>;
};
type WhisperRules = {
  followed: WhisperRule;
  subscribed: WhisperRule;
  resubscribed: WhisperRule;
  giftSender: WhisperRule;
};
type GiftRecipientResolution =
  | { status: 'unverified' }
  | { status: 'complete'; usernames: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validRule(rule: WhisperRule | undefined): rule is WhisperRule {
  return rule?.enabled === true && typeof rule.message === 'string' && rule.message.trim() !== '';
}

function actorUsername(event: Record<string, unknown>): string | undefined {
  const data = isRecord(event.data) ? event.data : undefined;
  if (isUsername(data?.who)) return data.who;
  if (isUsername(event.text)) return event.text;
  return undefined;
}

export function createJoystickWhisperAutomation(input: {
  rules: WhisperRules;
  getStreamState: JoystickStreamStateReader;
  sendWhisper: (whisper: { username: string; text: string }) => Promise<unknown> | unknown;
  resolveGiftRecipients?: (event: unknown) => GiftRecipientResolution | Promise<GiftRecipientResolution>;
  attemptStore?: WhisperAttemptStore;
  now?: () => number;
}) {
  const attempted = new Set<string>();

  async function attempt(eventId: string, ruleName: keyof WhisperRules, rule: WhisperRule, username: string, errors: unknown[]) {
    const key = JSON.stringify([eventId, ruleName, username.trim().toLowerCase()]);
    if (!isJoystickStreamLive(input.getStreamState)) return;
    if (input.attemptStore) {
      const claimed = await input.attemptStore.claimWhisperAttempt({
        eventId,
        rule: ruleName,
        recipient: username,
        attemptedAt: new Date((input.now ?? Date.now)()).toISOString(),
      });
      if (!claimed) return;
    } else {
      if (attempted.has(key)) return;
      // Mark before sending: a rejected request may still have reached Joystick.
      attempted.add(key);
    }
    if (!isJoystickStreamLive(input.getStreamState)) return;
    try {
      await input.sendWhisper({ username, text: rule.message });
    } catch (error) {
      errors.push(error);
    }
  }

  return {
    async handleEvent(event: unknown, context: { subscriptionConfirmed: boolean }): Promise<void> {
      if (!isJoystickStreamLive(input.getStreamState)
        || context?.subscriptionConfirmed !== true || !isRecord(event) || event.v !== 2) return;
      if (typeof event.id !== 'string' || event.id.trim() === '') return;

      const route = event.type === 'followed' ? 'followed'
        : event.type === 'subscribed' ? 'subscribed'
          : event.type === 'resubscribed' ? 'resubscribed'
            : event.type === 'gifted_subscriptions' ? 'gifted_subscriptions'
              : undefined;
      if (!route) return;

      const errors: unknown[] = [];
      if (route === 'gifted_subscriptions') {
        if (validRule(input.rules.subscribed) && input.resolveGiftRecipients) {
          try {
            const resolution = await input.resolveGiftRecipients(event);
            if (resolution?.status === 'complete' && Array.isArray(resolution.usernames)
              && resolution.usernames.every(isUsername)) {
              for (const username of new Set(resolution.usernames)) {
                await attempt(event.id, 'subscribed', input.rules.subscribed, username, errors);
              }
            }
          } catch (error) {
            // An unresolved recipient list is not evidence of a complete list.
            errors.push(error);
          }
        }

        const sender = actorUsername(event);
        if (sender && validRule(input.rules.giftSender)) {
          await attempt(event.id, 'giftSender', input.rules.giftSender, sender, errors);
        }
      } else {
        const username = actorUsername(event);
        const rule = input.rules[route];
        if (username && validRule(rule)) await attempt(event.id, route, rule, username, errors);
      }

      if (errors.length > 0) throw errors[0];
    },
  };
}
