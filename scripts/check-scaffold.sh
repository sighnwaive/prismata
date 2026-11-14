#!/usr/bin/env sh
set -eu

missing=0

require_path() {
  path="$1"

  if [ ! -e "$path" ]; then
    printf 'missing: %s\n' "$path" >&2
    missing=1
  fi
}

# Root workspace and shared TypeScript config.
require_path "package.json"
require_path "pnpm-workspace.yaml"
require_path "tsconfig.base.json"

# Desktop app scaffold.
require_path "apps/desktop/package.json"
require_path "apps/desktop/electron/main.ts"

# Mobile app scaffold.
require_path "apps/mobile/package.json"
require_path "apps/mobile/android"
require_path "apps/mobile/ios"

# GitHub Pages website.
require_path "apps/web/package.json"
require_path "apps/web/index.html"
require_path "apps/web/vite.config.ts"

# Shared packages for cross-app TypeScript code.
require_path "packages/ui/package.json"
require_path "packages/core/package.json"

if [ "$missing" -ne 0 ]; then
  printf 'scaffold validation failed\n' >&2
  exit 1
fi

printf 'scaffold validation passed\n'
