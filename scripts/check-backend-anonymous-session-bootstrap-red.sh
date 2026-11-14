#!/usr/bin/env sh
set -eu

node --test "packages/sync/test/backend-anonymous-session-bootstrap.red.ts"
