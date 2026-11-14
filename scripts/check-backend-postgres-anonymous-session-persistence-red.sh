#!/usr/bin/env sh
set -eu

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5434/prismata}"

docker compose -f docker-compose.local-postgres.yml up -d
docker compose -f docker-compose.local-postgres.yml exec -T postgres psql -U postgres -d prismata < "supabase/migrations/auth_sync_schema_foundation.sql"

DATABASE_URL="$DATABASE_URL" node --test "apps/backend/test/postgres-anonymous-session-persistence.red.mjs"
