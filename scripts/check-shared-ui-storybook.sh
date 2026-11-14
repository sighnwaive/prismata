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

# Shared Tamagui package shape.
require_path "packages/ui/package.json"
require_path "packages/ui/tamagui.config.ts"
require_path "packages/ui/src/components/Button.tsx"
require_path "packages/ui/src/stories/Button.stories.tsx"

# Dedicated web Storybook app so desktop-facing stories do not depend on the Tauri shell.
require_path "apps/storybook/package.json"
require_path "apps/storybook/.storybook/main.ts"
require_path "apps/storybook/.storybook/preview.ts"

# React Native Storybook bootstrap kept in the mobile app.
require_path "apps/mobile/.rnstorybook/index.ts"
require_path "apps/mobile/.rnstorybook/main.ts"

if [ "$missing" -ne 0 ]; then
  printf 'shared ui/storybook scaffold validation failed\n' >&2
  exit 1
fi

printf 'shared ui/storybook scaffold validation passed\n'
