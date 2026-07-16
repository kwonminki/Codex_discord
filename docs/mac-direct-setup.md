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
  --workspace-root "/Users/kwonmingi/Documents/Codex" \
  --initial-cwd "/Users/kwonmingi/Documents/Codex/2026-07-16/new-chat/work/codex-discord-connector" \
  --workspace-name "Kwon Mac Codex" \
  --computer-name "Kwon Mac" \
  --codex-home "$HOME/.codex"
```

This writes `.connect/config.json` and `.env`. Do not commit those files.

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

The polling interval defaults to 1 second and can be changed with:

```bash
CONNECT_TASK_NOTIFICATION_INTERVAL_MS=2000
```

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
