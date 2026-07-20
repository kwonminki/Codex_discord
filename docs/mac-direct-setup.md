# Mac Direct Mode Setup

This repo is intended to be run from source while customizing the connector.

## Discord setup

1. Create a private Discord server for Codex operations.
2. Create a Discord application and bot in the Discord Developer Portal.
3. Enable the bot's `Message Content Intent`.
4. Invite the bot to the private server with scopes:
   - `bot`
   - `applications.commands`
5. Grant only the needed permissions:
   - View Channels
   - Send Messages
   - Read Message History
   - Manage Channels
   - Attach Files
   - Manage Messages, optional for `/clear`
6. Create a dedicated operator role, for example `Codex Operator`.
7. Create a dedicated admin channel, for example `#mac-admin`.
8. Turn on Discord Developer Mode and copy:
   - Bot token
   - Guild/server ID
   - Operator role ID
   - Admin channel ID

## Install from this source checkout

```bash
pnpm install
pnpm typecheck
pnpm test
```

## Configure this Mac

Use the current source checkout so local code changes apply immediately.

```bash
pnpm connect install --direct \
  --token "DISCORD_BOT_TOKEN" \
  --guild-id "DISCORD_GUILD_ID" \
  --role-ids "OPERATOR_ROLE_ID" \
  --channel-id "MAC_ADMIN_CHANNEL_ID" \
  --claude-channel-id "MAC_CLAUDE_CHANNEL_ID" \
  --workspace-root "/Users/kwonmingi/Documents/Codex" \
  --initial-cwd "/Users/kwonmingi/Documents/Codex/2026-07-16/new-chat/work/codex-discord-connector" \
  --workspace-name "Kwon Mac Codex" \
  --computer-name "Kwon Mac" \
  --codex-home "$HOME/.codex"
```

This writes `.connect/config.json` and `.env`. Do not commit those files. In direct mode, `--channel-id` is the Codex/admin channel and `--claude-channel-id` is the optional fixed Claude Code channel for the same computer.

When `--claude-channel-id` is configured, the bot treats that channel as a Claude Code channel. `/chat-new` or `chat new` creates a Claude Code thread under that channel, and messages inside the thread continue the same Claude Code session.

The bot also watches recent Claude Code session logs under `~/.claude/projects`. Sessions started by IDE surfaces such as VS Code or Antigravity are detected from their Claude entrypoint and automatically mapped to new Discord threads under `--claude-channel-id`. Connector-started Claude sessions are skipped so they do not create duplicate threads.

After the first baseline scan, new assistant answers from those external Claude Code sessions are posted back to the mapped Discord thread as `Claude Code 작업 완료` notifications with the final answer. Connector-started Claude sessions are not completion-notified separately because their result is already shown in the Discord request message.

Claude Code completion notifications wait until the latest session activity is an assistant text message and the session has been idle for `CONNECT_CLAUDE_COMPLETION_IDLE_MS`, so intermediate messages followed by tool calls are not treated as final answers.

Claude Code session scanning uses an in-memory `mtime`/file-size cache. Unchanged `~/.claude/projects/**/*.jsonl` files are not reparsed, and appended session logs are read from the new byte range only. The thread auto-linker and completion notifier share the same discovered session list during each poll.

## Start the bot

```bash
pnpm connect start --direct
```

In Discord, run:

```text
help
where
chat new current name:mac-test
sync
```

## Auto-start on Mac login

This Mac uses a user LaunchAgent:

```text
~/Library/LaunchAgents/com.kwonmingi.codex-discord-connector.mac-direct.plist
```

The LaunchAgent calls a wrapper outside `Documents` so macOS privacy checks do not block the script:

```text
~/Library/Application Support/CodexDiscordConnector/start-mac-direct.sh
```

Logs:

```text
~/Library/Logs/codex-discord-connector/mac-direct.out.log
~/Library/Logs/codex-discord-connector/mac-direct.err.log
```

Useful commands:

```bash
launchctl print "gui/$(id -u)/com.kwonmingi.codex-discord-connector.mac-direct"
launchctl kickstart -k "gui/$(id -u)/com.kwonmingi.codex-discord-connector.mac-direct"
tail -f "$HOME/Library/Logs/codex-discord-connector/mac-direct.out.log"
```

## Task completion notifications

The Mac direct bot watches non-archived Codex sessions from the configured `CODEX_HOME` and posts to the configured admin channel when a Codex transcript records `task_complete`.

This includes Codex sessions started from IDE surfaces such as VS Code or Antigravity as long as they write native Codex session data under the same `CODEX_HOME`. CLI/exec sessions are included too; sub-agent and archived sessions are skipped.

The first scan for the current notification scope only records a baseline, so old completed work does not flood Discord after a bot restart or scope change. Future completions are remembered in `.connect/state.json` and are only posted once.

Completion notifications include the latest assistant answer, plus an `이어 작업 요청` button. Long answers are previewed in Discord and attached as `codex-answer.txt`. Press the button to open a Discord modal, write the next instruction, and the bot will try to resume the completed Codex session with that prompt. The follow-up runs through `codex exec resume`; Codex Desktop or IDE sessions that use dynamic tools may not be resumable from exec mode, and those sessions also do not live-update the Desktop app UI from Discord.

For a closer native Codex integration, set `CODEX_DISCORD_CODEX_RUNNER=app-server` before starting the bot. In this mode, Discord prompts are sent through Codex's app-server WebSocket protocol with `thread/start`, `thread/resume`, and `turn/start` instead of `codex exec`. The created or resumed thread is recorded in Codex's native session store and can be opened from Codex surfaces, but a currently visible Desktop, VS Code, or Antigravity panel is not forcibly navigated to that thread by the connector.

Completion polling defaults to 3 seconds, transcript polling defaults to 5 seconds, and both can be changed with:

```bash
CONNECT_TASK_NOTIFICATION_INTERVAL_MS=3000
CONNECT_TRANSCRIPT_SYNC_INTERVAL_MS=5000
CONNECT_CLAUDE_SESSION_SYNC_INTERVAL_MS=5000
CONNECT_CLAUDE_SESSION_SYNC_LOOKBACK_MS=86400000
CONNECT_CLAUDE_SESSION_SYNC_LIMIT=10
CONNECT_CLAUDE_COMPLETION_IDLE_MS=120000
CONNECT_BACKGROUND_POLL_MAX_INTERVAL_MS=20000
CONNECT_BACKGROUND_MAX_LOAD=0.7
```

Background polling backs off when there are no new Codex events, and it skips expensive Codex log scans while normalized system load is above `CONNECT_BACKGROUND_MAX_LOAD`. Set `CONNECT_BACKGROUND_MAX_LOAD=0` to disable load-based skipping.

Codex turns run with the widest local permissions by default:

```bash
CODEX_DISCORD_CODEX_COMMAND=/Applications/ChatGPT.app/Contents/Resources/codex
CODEX_DISCORD_CODEX_APPROVAL_POLICY=never
CODEX_DISCORD_CODEX_SANDBOX=danger-full-access
```

On macOS LaunchAgent services, set `CODEX_DISCORD_CODEX_COMMAND` to the absolute Codex CLI path because login services do not inherit the same `PATH` as an interactive terminal.

Discord Codex prompts use extra high reasoning by default. Use `fast` in a session channel only when you want a quick low-reasoning pass; `task` and `mode default` use `xhigh`.

Claude Code can be launched from a session channel in direct mode:

```text
claude README 요약해줘
claude 이어서 테스트 계획도 잡아줘
```

If `--claude-channel-id` is configured, that Discord channel becomes Claude Code-only: bare natural-language messages go to Claude Code, while shell commands still use the `!` prefix. Running `/chat-new` or `chat new` there creates a Discord thread under the Claude Code channel, and messages inside that thread continue to use Claude Code. The connector runs Claude Code headless with stream JSON output and remembers the returned Claude session ID per Discord channel for later resumes. Set `CODEX_DISCORD_CLAUDE_COMMAND` if `claude` is not on the service `PATH`, and set `CODEX_DISCORD_CLAUDE_PERMISSION_MODE` to override the default `bypassPermissions` mode. Permission approval buttons and Claude hook-based notifications for externally started Claude sessions are not included in the MVP direct integration.

Use this only on trusted machines and private Discord servers. To narrow permissions, set `CODEX_DISCORD_CODEX_APPROVAL_POLICY=on-request` and `CODEX_DISCORD_CODEX_SANDBOX=workspace-write`. For GPU work, the machine running the connector must already see the GPU outside Codex first. Check `nvidia-smi`, `/dev/nvidia*`, and any container runtime GPU settings before changing Codex sandbox settings.

## Development loop

After changing code:

```bash
pnpm typecheck
pnpm test
git status
git add .
git commit -m "..."
git push
```
