#!/usr/bin/env sh
set -eu

pnpm --filter @prismata/desktop exec tsx --test ../../apps/mobile/test/mobile-secure-storage.red.ts
