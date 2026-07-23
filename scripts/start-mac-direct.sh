#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${CODEX_DISCORD_REPO_ROOT:-${SCRIPT_DIR:h}}"
COMPONENT="${1:-${CONNECT_COMPONENT:-all}}"

case "$COMPONENT" in
  all|bot|worker|relay) ;;
  *)
    echo "usage: $0 [all|bot|worker|relay]" >&2
    exit 2
    ;;
esac

export PATH="$HOME/.local/bin:/Applications/ChatGPT.app/Contents/Resources:/Applications/Codex.app/Contents/Resources:/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CODEX_DISCORD_CODEX_RUNNER="app-server"

NODE_COMMAND="${CODEX_DISCORD_NODE_COMMAND:-$(command -v node || true)}"
if [[ -z "$NODE_COMMAND" ]]; then
  echo "Node.js was not found. Install a supported Node.js version or set CODEX_DISCORD_NODE_COMMAND." >&2
  exit 1
fi

if [[ -z "${CODEX_DISCORD_CODEX_COMMAND:-}" ]]; then
  if [[ -x "/Applications/ChatGPT.app/Contents/Resources/codex" ]]; then
    export CODEX_DISCORD_CODEX_COMMAND="/Applications/ChatGPT.app/Contents/Resources/codex"
  elif [[ -x "/Applications/Codex.app/Contents/Resources/codex" ]]; then
    export CODEX_DISCORD_CODEX_COMMAND="/Applications/Codex.app/Contents/Resources/codex"
  elif command -v codex >/dev/null 2>&1; then
    export CODEX_DISCORD_CODEX_COMMAND="$(command -v codex)"
  fi
fi

if [[ -z "${CODEX_DISCORD_CLAUDE_COMMAND:-}" ]] && command -v claude >/dev/null 2>&1; then
  export CODEX_DISCORD_CLAUDE_COMMAND="$(command -v claude)"
fi

if [[ ! -f "$REPO_ROOT/package.json" ]]; then
  echo "AI Agent Discord Connector repo was not found at $REPO_ROOT" >&2
  echo "Set CODEX_DISCORD_REPO_ROOT to the source checkout path." >&2
  exit 1
fi

cd "$REPO_ROOT"

case "$COMPONENT" in
  bot)
    exec "$NODE_COMMAND" --import tsx apps/discord-bot/src/index.ts
    ;;
  worker)
    exec "$NODE_COMMAND" --import tsx apps/local-agent/src/directWorker.ts
    ;;
  relay)
    exec "$NODE_COMMAND" --import tsx apps/relay-bot/src/index.ts
    ;;
  all)
    exec "$NODE_COMMAND" --import tsx apps/connect-cli/src/index.ts start --direct
    ;;
esac
