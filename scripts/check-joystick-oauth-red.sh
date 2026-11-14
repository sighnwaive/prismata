#!/usr/bin/env sh
set -eu

status=0

if ! pnpm --filter @prismata/desktop exec tsx --test test/joystick-auth.test.ts; then
  status=1
fi

if ! grep -Eq "export const desktopOAuthRedirectUri|export \{ desktopOAuthRedirectUri \}" "apps/desktop/src/auth-flow.ts"; then
  printf 'contract mismatch: apps/desktop/src/auth-flow.ts :: desktopOAuthRedirectUri export missing\n' >&2
  status=1
fi

if ! grep -Eq "export (async function|function|const) handleDesktopOAuthCallback" "apps/desktop/src/auth-flow.ts"; then
  printf 'contract mismatch: apps/desktop/src/auth-flow.ts :: handleDesktopOAuthCallback export missing\n' >&2
  status=1
fi

if ! grep -Eq "unsupported-confidential-client|public/native PKCE" "apps/desktop/src/joystick-auth.ts"; then
  printf 'contract mismatch: desktop Joystick auth must remain unsupported without public/native PKCE\n' >&2
  status=1
fi

exit "$status"
