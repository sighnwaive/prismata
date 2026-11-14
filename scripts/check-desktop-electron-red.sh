#!/usr/bin/env sh
set -eu

status=0

if ! pnpm exec tsc \
  --noEmit \
  --pretty false \
  --target ES2020 \
  --module ESNext \
  --moduleResolution Bundler \
  --lib ES2020,DOM \
  --types node \
  apps/desktop/test/electron-shell.red.ts; then
  status=1
fi

if ! pnpm --filter @prismata/desktop exec electron test/electron-node-runtime.red.mjs; then
  status=1
fi

if ! node apps/desktop/test/preload-runtime.red.mjs; then
  status=1
fi

if ! node apps/desktop/test/electron-smoke-linux.red.mjs; then
  status=1
fi

if ! node apps/desktop/test/electron-startup-boundary.red.mjs; then
  status=1
fi

if ! node --test apps/desktop/test/electron-import-alignment.test.mjs; then
  status=1
fi

if grep -Eq '"tauri"[[:space:]]*:' "apps/desktop/package.json"; then
  printf 'contract mismatch: apps/desktop/package.json :: legacy tauri script still present\n' >&2
  status=1
fi

if grep -Eq '@tauri-apps/cli' "apps/desktop/package.json"; then
  printf 'contract mismatch: apps/desktop/package.json :: legacy @tauri-apps/cli dependency still present\n' >&2
  status=1
fi

if ! grep -Eq '"dev"[[:space:]]*:[[:space:]]*"[^"]*electron' "apps/desktop/package.json"; then
  printf 'contract mismatch: apps/desktop/package.json :: missing electron dev script\n' >&2
  status=1
fi

if ! grep -Eq '"build"[[:space:]]*:[[:space:]]*"[^"]*electron' "apps/desktop/package.json"; then
  printf 'contract mismatch: apps/desktop/package.json :: missing electron build script\n' >&2
  status=1
fi

if ! grep -Eq '"electron"[[:space:]]*:' "apps/desktop/package.json"; then
  printf 'contract mismatch: apps/desktop/package.json :: missing electron dependency\n' >&2
  status=1
fi

exit "$status"
