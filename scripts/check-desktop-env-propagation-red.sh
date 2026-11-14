#!/usr/bin/env sh
set -eu

pnpm exec dotenvx run -f scripts/fixtures/dotenvx-desktop.env -- pnpm --filter @prismata/desktop exec tsx --test test/electron-security.test.ts
