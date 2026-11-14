#!/usr/bin/env sh
set -eu

missing=0
invalid=0

forbidden_path() {
  pattern="$1"

  if [ -e "$pattern" ]; then
    printf 'forbidden path still exists: %s\n' "$pattern" >&2
    invalid=1
  fi
}

forbidden_grep() {
  pattern="$1"
  path="$2"

  if [ ! -f "$path" ]; then
    printf 'missing: %s\n' "$path" >&2
    missing=1
    return
  fi

  if grep -Eq "$pattern" "$path"; then
    printf 'forbidden contract still present: %s :: %s\n' "$path" "$pattern" >&2
    invalid=1
  fi
}

# Shared package no longer ships a Supabase runtime client.
forbidden_path "packages/sync/src/supabase.ts"
forbidden_grep '"@supabase/supabase-js"' "packages/sync/package.json"
forbidden_grep "export \\* from './supabase'" "packages/sync/src/index.ts"

# Desktop runtime no longer keeps a Supabase-named shim or shell contract field.
forbidden_path "apps/desktop/src/supabase.ts"
forbidden_grep "from './supabase'" "apps/desktop/src/main.ts"
forbidden_grep "from './supabase'" "apps/desktop/src/auth-flow.ts"
forbidden_grep 'supabase:' "apps/desktop/electron/main.ts"
forbidden_grep 'supabase:' "apps/desktop/electron/main.mjs"
forbidden_grep "src/supabase.ts" "apps/desktop/electron/main.mjs"

# Mobile runtime no longer keeps a Supabase-named shim or bootstrap import.
forbidden_path "apps/mobile/src/supabase.ts"
forbidden_grep "from './src/supabase'" "apps/mobile/index.js"
forbidden_grep "from './supabase'" "apps/mobile/src/auth-flow.tsx"

# App/runtime docs and checks no longer depend on legacy Supabase env names.
forbidden_grep 'VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|PRISMATA_SUPABASE_URL|PRISMATA_SUPABASE_ANON_KEY' "README.md"
forbidden_grep 'VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY' "scripts/check-dotenvx-dev-red.sh"
forbidden_grep 'VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY' "scripts/check-desktop-env-propagation-red.sh"

if [ "$missing" -ne 0 ] || [ "$invalid" -ne 0 ]; then
  printf 'backend runtime removal validation failed\n' >&2
  exit 1
fi

printf 'backend runtime removal validation passed\n'
