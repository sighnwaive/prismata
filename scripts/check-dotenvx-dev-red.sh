#!/usr/bin/env sh
set -eu

status=0

if ! pnpm exec dotenvx run -f scripts/fixtures/dotenvx-desktop.env -- node -e "if (process.env.PRISMATA_DESKTOP_DEV !== 'true') { console.error('contract mismatch: dotenvx did not load the desktop dev fixture'); process.exit(1); }"; then
  status=1
fi

if ! grep -Eq '"dev"[[:space:]]*:[[:space:]]*"dotenvx run -f ../../\.env -- node electron/run-dev\.mjs"' "apps/desktop/package.json"; then
  printf 'contract mismatch: apps/desktop/package.json :: desktop dev script must load ../../.env via dotenvx\n' >&2
  status=1
fi

if ! grep -Eq 'dotenvx' "README.md"; then
  printf 'contract mismatch: README.md :: missing dotenvx development setup documentation\n' >&2
  status=1
fi

exit "$status"
