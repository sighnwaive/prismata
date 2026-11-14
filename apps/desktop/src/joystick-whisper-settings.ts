export type JoystickWhisperRule = { enabled: boolean; message: string };

export type JoystickWhisperSettings = {
  followed: JoystickWhisperRule;
  subscribed: JoystickWhisperRule;
  resubscribed: JoystickWhisperRule;
  giftSender: JoystickWhisperRule;
};

const defaultRule: JoystickWhisperRule = { enabled: false, message: '' };

export const defaultJoystickWhisperSettings: JoystickWhisperSettings = {
  followed: { ...defaultRule },
  subscribed: { ...defaultRule },
  resubscribed: { ...defaultRule },
  giftSender: { ...defaultRule },
};

function normalizeRule(value: unknown): JoystickWhisperRule {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...defaultRule };

  const source = value as Record<string, unknown>;
  const message = typeof source.message === 'string' && source.message.trim() !== '' ? source.message : '';
  const enabled = source.enabled === true && message !== '';
  return { enabled, message };
}

/** Normalize each rule independently, failing closed for malformed or blank values. */
export function normalizeJoystickWhisperSettings(value: unknown): JoystickWhisperSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      followed: { ...defaultRule },
      subscribed: { ...defaultRule },
      resubscribed: { ...defaultRule },
      giftSender: { ...defaultRule },
    };
  }

  const source = value as Record<string, unknown>;
  return {
    followed: normalizeRule(source.followed),
    subscribed: normalizeRule(source.subscribed),
    resubscribed: normalizeRule(source.resubscribed),
    giftSender: normalizeRule(source.giftSender),
  };
}
