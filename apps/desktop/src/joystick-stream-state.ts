export type JoystickStreamState = 'checking' | 'live' | 'offline' | 'ending-soon' | 'unknown';

export type JoystickStreamStateReader = () => JoystickStreamState;

export function isJoystickStreamLive(getStreamState?: JoystickStreamStateReader): boolean {
  try {
    return typeof getStreamState === 'function' && getStreamState() === 'live';
  } catch {
    return false;
  }
}
