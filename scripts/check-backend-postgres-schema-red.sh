#!/usr/bin/env sh
set -eu

node --test "apps/backend/test/postgres-schema.red.mjs"
