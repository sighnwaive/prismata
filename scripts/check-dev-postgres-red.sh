#!/usr/bin/env sh
set -eu

node --test "apps/backend/test/dev-postgres-environment.red.mjs"
