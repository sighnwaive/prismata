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

# Shared sync client package for desktop/mobile consumption.
require_path "packages/sync/package.json"
require_path "packages/sync/src/index.ts"

# Local backend data scaffold for config and migrations.
require_path "supabase/config.toml"
require_path "supabase/migrations"

if [ "$missing" -ne 0 ]; then
  printf 'backend/sync scaffold validation failed\n' >&2
  exit 1
fi

printf 'backend/sync scaffold validation passed\n'
