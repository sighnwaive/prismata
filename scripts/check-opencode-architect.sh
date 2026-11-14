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

agent_path=".opencode/agents/architect.md"
docs_path="docs/architecture/README.md"

require_path "$agent_path"
require_path "$docs_path"

if [ -f "$agent_path" ]; then
  require_grep '^description: .*[Aa]rchitect' "$agent_path"
  require_grep '^mode: subagent$' "$agent_path"
  require_grep '^  edit:$' "$agent_path"
  require_grep '^    "\*": deny$' "$agent_path"
  require_grep '^    docs/\*\*: allow$' "$agent_path"
  require_grep '^  bash: deny$' "$agent_path"
  require_grep '^  task: deny$' "$agent_path"
  require_grep '^    docs/\*\*: allow$' "$agent_path"
  require_grep '^    \*\*/\*PRD\*: allow$' "$agent_path"
  require_grep '^    \*\*/\*prd\*: allow$' "$agent_path"
  require_grep 'must never edit code' "$agent_path"
  require_grep 'must not modify PRDs' "$agent_path"
  require_grep 'docs/architecture/\*\* is the source of truth for architecture' "$agent_path"
  require_grep 'direct implementation or code changes to other agents' "$agent_path"
  require_grep 'primary working area' "$agent_path"
fi

if [ -f "$docs_path" ]; then
  require_grep 'source of truth for architecture' "$docs_path"
fi

if [ "$missing" -ne 0 ] || [ "$invalid" -ne 0 ]; then
  printf 'opencode architect validation failed\n' >&2
  exit 1
fi

printf 'opencode architect validation passed\n'
