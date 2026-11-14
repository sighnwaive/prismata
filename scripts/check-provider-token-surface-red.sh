#!/usr/bin/env sh
set -eu

pnpm --filter @prismata/desktop exec tsx --test ../../packages/sync/test/provider-token-surface.red.ts
