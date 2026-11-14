#!/usr/bin/env sh
set -eu

missing=0
invalid=0

require_path() {
  path="$1"

  if [ ! -e "$path" ]; then
    printf 'missing: %s\n' "$path" >&2
    missing=1
  fi
}

require_grep() {
  pattern="$1"
  path="$2"

  if [ ! -f "$path" ]; then
    printf 'missing: %s\n' "$path" >&2
    missing=1
    return
  fi

  if ! grep -Eq "$pattern" "$path"; then
    printf 'contract mismatch: %s :: %s\n' "$path" "$pattern" >&2
    invalid=1
  fi
}

# Desktop-owned auth/sync contract: local service and paired mobile transport.
require_path "apps/desktop/src/desktop-service.ts"
require_grep "'/api/v1/health'" "apps/desktop/src/desktop-service.ts"
require_grep "'/api/v1/instance'" "apps/desktop/src/desktop-service.ts"
require_grep "'/api/v1/session/(refresh|revoke)'" "apps/desktop/src/desktop-service.ts"
require_grep "'/api/v1/devices/heartbeat'" "apps/desktop/src/desktop-service.ts"
require_grep "createDesktopTransport" "packages/sync/src/desktop.ts"

# Desktop and mobile should each expose a minimal auth flow entry screen.
require_path "apps/desktop/src/auth-flow.ts"
require_grep "auth-coordinator" "apps/desktop/electron/main.mjs"

require_path "apps/mobile/src/auth-flow.tsx"
require_grep "from '@prismata/sync'" "apps/mobile/src/desktop-runtime.ts"
require_grep "from './src/auth-flow'" "apps/mobile/index.js"

if [ "$missing" -ne 0 ] || [ "$invalid" -ne 0 ]; then
  printf 'auth/sync red-stage validation failed\n' >&2
  exit 1
fi

printf 'auth/sync red-stage validation passed\n'
