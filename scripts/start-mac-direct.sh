#!/bin/zsh
set -euo pipefail

REPO_ROOT="/Users/kwonmingi/Documents/Codex/2026-07-16/new-chat/work/codex-discord-connector"
COMPONENT="${1:-${CONNECT_COMPONENT:-all}}"

case "$COMPONENT" in
  all|bot|worker) ;;
  *)
    echo "usage: $0 [all|bot|worker]" >&2
    exit 2
    ;;
esac

export PATH="$HOME/.local/bin:/Applications/ChatGPT.app/Contents/Resources:/Applications/Codex.app/Contents/Resources:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CODEX_DISCORD_CODEX_COMMAND="/Applications/ChatGPT.app/Contents/Resources/codex"
export CODEX_DISCORD_CLAUDE_COMMAND="$HOME/.local/bin/claude"
export CODEX_DISCORD_CODEX_RUNNER="app-server"

cd "$REPO_ROOT"

case "$COMPONENT" in
  bot)
    exec /opt/homebrew/bin/node --import tsx apps/discord-bot/src/index.ts
    ;;
  worker)
    exec /opt/homebrew/bin/node --import tsx apps/local-agent/src/directWorker.ts
    ;;
  all)
    exec /opt/homebrew/bin/node --import tsx apps/connect-cli/src/index.ts start --direct
    ;;
esac
