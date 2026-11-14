#!/usr/bin/env sh
set -eu

pnpm exec tsc \
  --noEmit \
  --pretty false \
  --skipLibCheck \
  --target ES2020 \
  --module ESNext \
  --moduleResolution Bundler \
  --lib ES2020,DOM \
  "packages/sync/test/node-ambient-shim.red.d.ts" \
  "packages/sync/test/auth-bootstrap-result.red.ts"
