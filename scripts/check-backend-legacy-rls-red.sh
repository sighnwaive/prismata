#!/usr/bin/env sh
set -eu

missing=0
invalid=0

require_grep() {
  pattern="$1"
  path="$2"

  if ! grep -Eq "$pattern" "$path"; then
    printf 'contract mismatch: %s :: %s\n' "$path" "$pattern" >&2
    invalid=1
  fi
}

migration_path=$(ls supabase/migrations/*_device_records_rls.sql 2>/dev/null | head -n 1 || true)

if [ -z "$migration_path" ]; then
  printf 'missing: supabase/migrations/*_device_records_rls.sql\n' >&2
  missing=1
else
  require_grep 'alter table public\.device_records enable row level security' "$migration_path"
  require_grep 'create policy .*device_records.*select.* on public\.device_records' "$migration_path"
  require_grep 'create policy .*device_records.*insert.* on public\.device_records' "$migration_path"
  require_grep 'create policy .*device_records.*update.* on public\.device_records' "$migration_path"
  require_grep 'using \(auth\.uid\(\) = user_id\)' "$migration_path"
  require_grep 'with check \(auth\.uid\(\) = user_id\)' "$migration_path"
fi

if [ "$missing" -ne 0 ] || [ "$invalid" -ne 0 ]; then
  printf 'device_records RLS red-stage validation failed\n' >&2
  exit 1
fi

printf 'device_records RLS red-stage validation passed\n'
