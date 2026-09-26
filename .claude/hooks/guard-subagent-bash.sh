#!/usr/bin/env bash
# PreToolUse(Bash) guard for Spec Kit build/chore subagents (sk-implementer, sk-converger,
# sk-test-runner, sk-chore). Exit 2 blocks the call and the stderr text is shown to the agent.
#
# Each rule encodes a failure seen while building specs 005–007:
#   - only the orchestrator commits (parallel agents collided on .git/index.lock);
#   - agents never start/stop the stack (the user runs a live production stack from it);
#   - never touch the production overlay (real eBay calls with production keys);
#   - Node runs only inside Docker (constitution V);
#   - no recursive deletes outside scratch space.
set -euo pipefail

cmd=$(jq -r '.tool_input.command // ""')

block() {
  echo "Blocked by guard-subagent-bash: $1. Report back to the orchestrator instead." >&2
  exit 2
}

if grep -Eq '(^|[^[:alnum:]_-])git[[:space:]]+(commit|push|checkout|switch|reset|rebase|merge|stash|tag|branch[[:space:]]+-[dD])([[:space:]]|$)' <<<"$cmd"; then
  block "git history/branch changes are orchestrator-only"
fi

if grep -Eq 'docker[[:space:]]+compose([[:space:]]+-f[[:space:]]+[^[:space:]]+)*[[:space:]]+(up|down|stop|restart|kill|rm)([[:space:]]|$)' <<<"$cmd"; then
  block "starting/stopping the compose stack is orchestrator-only (use 'docker compose run --rm <svc> ...')"
fi

if grep -q 'docker-compose\.prod' <<<"$cmd"; then
  block "the production overlay makes real eBay calls with production keys"
fi

if ! grep -q 'docker' <<<"$cmd" && grep -Eq '(^|[^[:alnum:]_./-])(npm|npx|node)([[:space:]]|$)' <<<"$cmd"; then
  block "Node/npm run only inside Docker (docker compose run --rm api|web ...)"
fi

if grep -Eq 'rm[[:space:]]+(-[[:alpha:]]*r[[:alpha:]]*f|-[[:alpha:]]*f[[:alpha:]]*r)' <<<"$cmd" \
   && ! grep -Eq 'scratchpad|/tmp/|web/(dist|playwright-report|test-results)' <<<"$cmd"; then
  block "recursive delete outside scratch/build-output paths"
fi

exit 0
