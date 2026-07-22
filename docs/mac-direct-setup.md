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
   - Send Messages in Threads
   - Read Message History
   - Embed Links
   - Create Public Threads
   - Manage Threads
   - Manage Channels
   - Attach Files
   - Manage Messages, optional for `/clear`
6. Create a dedicated operator role, for example `Codex Operator`.
7. Create a dedicated Codex/admin channel, for example `#mac-codex`, and a separate Claude Code channel, for example `#mac-claude-code`.
8. Gather the setup values:
   - Bot token: open the [Discord Developer Portal](https://discord.com/developers/applications), select the application, then use `Bot > Reset Token/Copy`. The Public Key and OAuth2 Client ID are not connector inputs.
   - Guild/server ID: enable `User Settings > Advanced > Developer Mode`, right-click the server icon, and select `Copy Server ID`.
   - Operator role ID: open `Server Settings > Roles`, open the role menu, and select `Copy Role ID`. Assign this role to every connector operator.
   - Codex/admin channel ID: right-click the dedicated Codex channel and select `Copy Channel ID`.
   - Claude Code channel ID: right-click the dedicated Claude Code channel and select `Copy Channel ID`.

The Codex and Claude Code channel IDs must be different. See Discord's [official ID guide](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID) if the copy-ID actions are not visible.

## Install from this source checkout

```bash
pnpm install
pnpm typecheck
pnpm test
```

## Configure this Mac

Use the current source checkout so local code changes apply immediately.

Running `pnpm connect install --direct` without flags now prints the same lookup guide and prompts for both channel IDs. The Claude Code channel can be left blank only when Claude integration is intentionally disabled.

```bash
pnpm connect install --direct \
  --token "DISCORD_BOT_TOKEN" \
  --guild-id "DISCORD_GUILD_ID" \
  --role-ids "OPERATOR_ROLE_ID" \
  --channel-id "MAC_ADMIN_CHANNEL_ID" \
  --claude-channel-id "MAC_CLAUDE_CHANNEL_ID" \
  --workspace-root "/Users/me/Documents/Codex" \
  --initial-cwd "/Users/me/Documents/Codex/Codex_discord" \
  --workspace-name "My Mac Codex" \
  --computer-name "My Mac" \
  --codex-home "$HOME/.codex"
```

This writes `.connect/config.json` and `.env`. Do not commit those files. In direct mode, `--channel-id` is the Codex/admin channel and `--claude-channel-id` is the optional fixed Claude Code channel for the same computer.

When `--claude-channel-id` is configured, the bot treats that channel as a Claude Code channel. `/chat-new` or `chat new` creates a Claude Code thread under that channel, and messages inside the thread continue the same Claude Code session. Inside a linked Codex or Claude Code thread, `/fork` asks for a new thread name and creates a sibling Discord thread. Claude Code forks use `claude --resume <session> --fork-session`; Codex forks use Codex app-server `thread/fork`.

The bot also watches recent Claude Code session logs under `~/.claude/projects`. Sessions started by IDE surfaces such as VS Code or Antigravity are detected from their Claude entrypoint and automatically mapped to new Discord threads under `--claude-channel-id`. Connector-started Claude sessions are skipped so they do not create duplicate threads.

## Incoming Discord attachments

In Direct mode, attach an image, video, audio file, or ordinary file to a message in a managed Codex/Claude Code channel. The gateway downloads it into `.connect/incoming-attachments/<message-id>/` and adds its absolute local path to the agent prompt. An attachment-only message receives a default inspection prompt. In the admin channel, attached files default to Codex; start the caption with `claude ` to send them to Claude Code instead.

Defaults are 10 files per message, 100MiB per file, 250MiB total, and a 7-day local TTL. Override them with `CONNECT_INCOMING_ATTACHMENT_ROOT`, `CONNECT_INCOMING_ATTACHMENT_MAX_FILES`, `CONNECT_INCOMING_ATTACHMENT_MAX_BYTES`, `CONNECT_INCOMING_ATTACHMENT_TOTAL_MAX_BYTES`, and `CONNECT_INCOMING_ATTACHMENT_TTL_MS`. The bot and worker services must run as users that can access the same attachment directory.

After the first baseline scan, new assistant answers from those external Claude Code sessions are posted back to the mapped Discord thread as `Claude Code 작업 완료` notifications with the final answer. Connector-started Claude sessions are not completion-notified separately because their result is already shown in the Discord request message.

Claude Code completion notifications wait until the latest session activity is an assistant text message and the session has been idle for `CONNECT_CLAUDE_COMPLETION_IDLE_MS`, so intermediate messages followed by tool calls are not treated as final answers.

Claude Code session scanning uses an in-memory `mtime`/file-size cache. Unchanged `~/.claude/projects/**/*.jsonl` files are not reparsed, and appended session logs are read from the new byte range only. The thread auto-linker and completion notifier share the same discovered session list during each poll.

## Start the bot and worker

```bash
pnpm connect start --direct
```

The combined command is convenient for foreground development. For an always-on setup, run the two Direct components independently so restarting Discord does not terminate an active Codex or Claude Code process:

```bash
pnpm connect start --direct --component worker
pnpm connect start --direct --component bot
```

Direct requests are persisted under `.connect/discord-queue`, and worker jobs, progress, approvals, Codex user questions, and results under `.connect/worker`. A restarted bot reconnects to the same request ID. A worker that receives `SIGTERM` stops accepting new jobs and waits for active jobs to finish before exiting; queued jobs stay on disk.

In Discord, run:

```text
help
where
chat new current name:mac-test
sync
```

## Auto-start on Mac login

Use two user LaunchAgents:

```text
~/Library/LaunchAgents/com.USER.codex-discord-connector.bot.plist
~/Library/LaunchAgents/com.USER.codex-discord-connector.worker.plist
```

Both LaunchAgents can call a machine-local wrapper outside `Documents` so macOS privacy checks do not block the script. Pass `bot` or `worker` as the final argument:

```text
~/Library/Application Support/CodexDiscordConnector/start-mac-direct.sh
```

The repo wrapper `scripts/start-mac-direct.sh` accepts `all`, `bot`, or `worker`. It derives the repo root from its own source-checkout location. If you copy it elsewhere, set `CODEX_DISCORD_REPO_ROOT` to the absolute checkout path. `CODEX_DISCORD_NODE_COMMAND`, `CODEX_DISCORD_CODEX_COMMAND`, and `CODEX_DISCORD_CLAUDE_COMMAND` can override executable discovery. For the worker LaunchAgent, set `ExitTimeOut` to at least the maximum expected Codex run time, for example `21600` seconds, so launchd does not force-kill a draining worker after its short default timeout.

Logs:

```text
~/Library/Logs/codex-discord-connector/bot.out.log
~/Library/Logs/codex-discord-connector/bot.err.log
~/Library/Logs/codex-discord-connector/worker.out.log
~/Library/Logs/codex-discord-connector/worker.err.log
```

Useful commands:

```bash
launchctl print "gui/$(id -u)/com.USER.codex-discord-connector.bot"
launchctl print "gui/$(id -u)/com.USER.codex-discord-connector.worker"
launchctl kickstart -k "gui/$(id -u)/com.USER.codex-discord-connector.bot"
tail -f "$HOME/Library/Logs/codex-discord-connector/bot.out.log"
```

Restarting only the bot LaunchAgent is safe for active worker jobs. Stopping the worker LaunchAgent drains active jobs when launchd honors `ExitTimeOut`; a host reboot or forced kill still interrupts them. While draining, the worker stops accepting new jobs but continues processing steering and interrupt controls for active turns.

If `worker.out.log` shows a new `direct-worker ready with PID ...` line every few seconds, check for an old one-off refresh job with `launchctl list | grep codex-discord-connector.worker-refresh`. A submitted `worker-refresh-*` job is not part of the normal installation and can race with a newly started turn. Remove it with `launchctl remove <full-label>` while leaving the regular worker LaunchAgent loaded.

## Task completion notifications

The Mac direct bot watches non-archived Codex sessions from the configured `CODEX_HOME` and posts to the configured admin channel when a Codex transcript records `task_complete`.

This includes Codex sessions started from IDE surfaces such as VS Code or Antigravity as long as they write native Codex session data under the same `CODEX_HOME`. CLI/exec sessions are included too; sub-agent and archived sessions are skipped.

The first scan for the current notification scope only records a baseline, so old completed work does not flood Discord after a bot restart or scope change. Future completions are remembered in `.connect/state.json` and are only posted once.

Completion notifications include the latest assistant answer when that answer was not already delivered by a Discord-started turn. Long final answers are split into ordered Discord messages, and the Operator role is mentioned only after all answer chunks have been posted. Obsolete thought/process and Codex-app-open buttons are intentionally not shown.

Set `CODEX_DISCORD_CODEX_RUNNER=app-server` before starting both services. Discord prompts then use Codex's app-server WebSocket protocol with `thread/start`, `thread/resume`, `thread/fork`, `turn/start`, approvals, and `request_user_input`. The created, resumed, or forked thread is recorded in Codex's native session store, but a currently visible Desktop, VS Code, or Antigravity panel is not forcibly refreshed or navigated by the connector. Do not run overlapping turns from an IDE and Discord in the same session; wait for one side to finish or use `/fork`.

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

Discord Codex prompts use `xhigh` reasoning by default, and Claude Code prompts use `max` effort by default. Set persistent computer defaults with `/model`, `/effort`, and `/settings` in each agent main channel. A session thread can override both values and use `default` to inherit the main setting again. `fast` remains a Codex-only alias for a quick low-reasoning pass; `task` uses `xhigh`.

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
