#!/usr/bin/env sh
set -eu

invalid=0

forbidden_grep() {
  pattern="$1"
  path="$2"
  message="$3"

  if grep -Eq "$pattern" "$path"; then
    printf 'naming conflict: %s :: %s\n' "$path" "$message" >&2
    invalid=1
  fi
}

# RED: onboarding and root checks should stop leading with Supabase-specific naming.
forbidden_grep '^## Supabase local setup$' 'README.md' 'contains a Supabase-first setup section heading'
forbidden_grep 'check:supabase-clients' 'package.json' 'exposes a Supabase-specific root check name'
forbidden_grep 'check:device-records-rls-red' 'package.json' 'exposes a legacy device_records-first root check name'
forbidden_grep 'Supabase project scaffold for local config and migrations\.' 'scripts/check-backend-sync.sh' 'describes backend sync validation with Supabase-first wording'

if [ "$invalid" -ne 0 ]; then
  printf 'backend doc naming red-stage validation failed\n' >&2
  exit 1
fi

printf 'backend doc naming red-stage validation passed\n'
