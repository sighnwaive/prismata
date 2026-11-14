export type DesktopJoystickAuthState =
  | { state: 'available'; clientType: 'public-pkce' }
  | { state: 'unsupported-confidential-client'; message: string };

export function describeJoystickAuth(input: { supportsPublicPkce: boolean }): DesktopJoystickAuthState {
  return input.supportsPublicPkce
    ? { state: 'available', clientType: 'public-pkce' }
    : { state: 'unsupported-confidential-client', message: 'Joystick requires a confidential client; desktop sign-in is unavailable until a public/native PKCE client is supported.' };
}
