#!/bin/zsh
set -euo pipefail

REPO_ROOT="/Users/kwonmingi/Documents/Codex/2026-07-16/new-chat/work/codex-discord-connector"

export PATH="$HOME/.local/bin:/Applications/ChatGPT.app/Contents/Resources:/Applications/Codex.app/Contents/Resources:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CODEX_DISCORD_CODEX_COMMAND="/Applications/ChatGPT.app/Contents/Resources/codex"
export CODEX_DISCORD_CLAUDE_COMMAND="$HOME/.local/bin/claude"
export CODEX_DISCORD_CODEX_RUNNER="app-server"

cd "$REPO_ROOT"
exec /opt/homebrew/bin/node --import tsx apps/connect-cli/src/index.ts start --direct
