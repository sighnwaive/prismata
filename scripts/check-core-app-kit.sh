#!/usr/bin/env sh
set -eu

missing=0
invalid=0

require_path() {
  path="$1"

  if [ ! -e "$path" ]; then
    printf 'missing: %s\n' "$path" >&2
    missing=1
  fi
}

require_grep() {
  pattern="$1"
  path="$2"

  if [ ! -f "$path" ]; then
    printf 'missing: %s\n' "$path" >&2
    missing=1
    return
  fi

  if ! grep -Eq "$pattern" "$path"; then
    printf 'contract mismatch: %s :: %s\n' "$path" "$pattern" >&2
    invalid=1
  fi
}

# Real token system entry points.
require_path "packages/ui/src/tokens/index.ts"
require_path "packages/ui/src/tokens/themes.ts"
require_path "packages/ui/src/tokens/templates.ts"

# First shared component surface for the core app kit.
require_path "packages/ui/src/components/core/Stack.tsx"
require_path "packages/ui/src/components/core/Text.tsx"
require_path "packages/ui/src/components/core/Surface.tsx"
require_path "packages/ui/src/components/core/Button.tsx"

# Story coverage for the initial shared kit and token visibility in Storybook.
require_path "packages/ui/src/stories/foundations/Tokens.stories.tsx"
require_path "packages/ui/src/stories/core/Stack.stories.tsx"
require_path "packages/ui/src/stories/core/Text.stories.tsx"
require_path "packages/ui/src/stories/core/Surface.stories.tsx"
require_path "packages/ui/src/stories/core/Button.stories.tsx"

# Package contracts: tokens and core kit must be exported from the shared UI entrypoint.
require_grep "export \\* from './tokens'" "packages/ui/src/index.ts"
require_grep "export \\{ Stack \\} from './components/core/Stack'" "packages/ui/src/index.ts"
require_grep "export \\{ Text \\} from './components/core/Text'" "packages/ui/src/index.ts"
require_grep "export \\{ Surface \\} from './components/core/Surface'" "packages/ui/src/index.ts"
require_grep "export \\{ Button \\} from './components/core/Button'" "packages/ui/src/index.ts"
require_grep "from './src/tokens'" "packages/ui/tamagui.config.ts"

if [ "$missing" -ne 0 ] || [ "$invalid" -ne 0 ]; then
  printf 'core app kit validation failed\n' >&2
  exit 1
fi

printf 'core app kit validation passed\n'
