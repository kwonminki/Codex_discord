# Codex Discord Connector

[한국어](README.md) | English

A personal bridge that lets you use **Codex and Claude Code running on a Mac or Ubuntu server through Discord threads**.

Send an ordinary Discord message and the agent works on the connected computer, posts useful progress, and returns the final answer. Images, video, audio, and general files can travel in both directions.

> This bot can modify files and execute commands on the connected computer. Use it only in a trusted private Discord server and on computers you control.

## Let an AI agent install it

Give the following request to Codex, Claude Code, or another coding agent on the Mac or Ubuntu machine you want to connect:

```text
https://github.com/kwonminki/Codex_discord

Clone this repository and read docs/AI_AGENT_GUIDE.en.md completely first.
Inspect the current code and my OS, then install it in Direct mode.
Configure the connector UI in the language I am using without asking me for language codes or config values.
Use the Codex app-server runner and register the Discord bot and worker as separate
LaunchAgent or systemd services. Preserve any active jobs during deployment.
Run pnpm typecheck and pnpm test, then verify the Discord ready log.
For a first install, guide me one step at a time through creating a private Discord
server, application, bot, and server invite. After the bot joins, use the Discord API
to configure roles, categories, Codex/Claude channels, permissions, slash commands,
and the optional release webhook. Ask me only for values that cannot be discovered.
```

The complete installation and operations contract for agents is in [AI Agent Guide](docs/AI_AGENT_GUIDE.en.md).

## Language is automatic

The installation agent detects the language used in the conversation and configures the connector UI to match. Users do not need to know language codes, environment variables, or configuration paths.

- The connector UI supports Korean, English, Simplified Chinese, and Japanese.
- User-facing READMEs are maintained only in Korean and English.
- For another language, the installation agent adds only the translation catalog, verifies it, and launches the connector.
- Buttons, modals, status text, slash command descriptions, setup prompts, and `/howtouse` use the configured language.
- User messages and agent-authored answers are preserved as written.

The installation agent handles the implementation details using [Localization Guide](docs/localization.md).

## What you prepare

### Private Discord server and bot

Create a private server, then create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications). Enable Message Content Intent and invite the bot with the `bot` and `applications.commands` scopes.

For a first personal setup, temporary Administrator permission is the simplest route. You can reduce it after installation. Automated setup needs View Channels, Send Messages, Send Messages in Threads, Read Message History, Embed Links, Attach Files, Create Public Threads, Manage Threads, Manage Channels, and optionally Manage Roles and Manage Webhooks.

The user must complete Discord login, OAuth approval, 2FA, and CAPTCHA. Once the bot has joined the server and has permission, the installation agent can create:

- Categories, parent channels, and session threads
- An Operator role and channel permission overwrites
- Slash command registrations
- A release announcement webhook
- Mac LaunchAgent or Ubuntu systemd services

### Operator role and notifications

Use a role such as `Codex Operator` as the allowlist. The bot mentions this role for questions, permission requests, completion, and failure.

Set channel notifications to **Only @mentions**. Progress remains visible without constant notifications, while events that need attention still notify you.

### Per-machine channels

Use different parent channels for every connected machine and agent:

```text
#mac-codex
#mac-claude-code
#gpu-server-codex
#gpu-server-claude
```

The same bot token can be used by multiple machines, but their Codex and Claude channel IDs must never overlap.

## Install manually

Requirements:

- Node.js `^20.19.0` or `>=22.12.0`
- pnpm `9.15.0`
- A logged-in Codex CLI
- Optional logged-in Claude Code CLI

```bash
git clone https://github.com/kwonminki/Codex_discord.git
cd Codex_discord
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm connect install --direct
pnpm connect start --direct
```

The setup command creates `.connect/config.json` and `.env`. These files may contain the Discord bot token and must never be committed.

Direct mode is recommended. It does not expose an inbound Control API. The Discord gateway writes durable requests and a separate worker owns Codex, Claude Code, shell commands, and their child processes.

## Daily use

Send natural language in a Codex or Claude session thread:

```text
Inspect the current code and fix the login failure. Run the tests afterward.
```

Common commands:

| Command | Purpose |
| --- | --- |
| `/chat-new` | Create a Discord thread and a new agent session |
| `/status` | Show connection, active task, queue, model, and effort |
| `/settings` | Show the effective model and effort |
| `/model model:<name>` | Set the parent default or current thread model |
| `/effort level:<level>` | Set reasoning effort; `default` restores inheritance |
| `/steer prompt:<text>` | Steer the currently running Codex turn |
| `/queue prompt:<text>` | Schedule a separate next turn |
| `/interrupt` | Interrupt the active Codex turn |
| `/fork` | Fork the current session into a new Discord thread |
| `/howtouse` | Teach the current agent how to exchange Discord files and surveys |
| `/where` | Show the connected computer, directory, and session ID |

An ordinary message sent while Codex is running steers the current turn. Use `/queue prompt:` when the text must run as a separate turn. Claude Code headless does not support live steering, so messages sent while it is running wait in FIFO order.

Avoid running the same session from an IDE and Discord at the same time. Use `/fork` or `/chat-new` for parallel work.

## Files and media

Users attach images, video, audio, documents, or archives to an ordinary Discord message. The bot downloads them to the connected machine and gives the agent a local path.

- Input defaults: 10 files per message, 100 MiB per file, 250 MiB total
- Output safety limit: 10 MiB per file
- Discord server upload limits may be lower
- Multiple output files are automatically split across file-only messages

Run `/howtouse` once in a session before asking the agent to send result files or create a media survey. The protocol supports final surveys for Codex and Claude Code, and live `request_user_input` questions for Codex app-server.

## Permissions and models

The default Direct mode is intended for trusted personal automation:

```text
approval=never
sandbox=danger-full-access
network=enabled
```

Claude Code uses `bypassPermissions` by default. The default efforts are Codex `xhigh` and Claude Code `max`; models otherwise follow each CLI's configuration. OS permissions, sudo, macOS privacy controls, Linux ACLs, and container GPU exposure still apply.

## Services and updates

For continuous operation, run the Discord gateway and Direct Worker as separate services.

- Restarting only the bot preserves an active worker job.
- A graceful worker restart drains active work first.
- Force-killing the worker or rebooting can terminate agents and their child processes.

Before updating, check the dirty worktree, active queue, worker jobs, and current PIDs. Pull with `git pull --ff-only`, install locked dependencies, run tests and typecheck, then restart only the processes affected by the changed files.

## More documentation

- [AI Agent Guide](docs/AI_AGENT_GUIDE.en.md)
- [Localization Guide](docs/localization.md)
- [Mac Direct Mode](docs/mac-direct-setup.md)
- [Ubuntu Direct Mode](docs/ubuntu-server-direct-setup.ko.md)
- [Operator Guide](docs/operator-guide.md)
- [Security Policy](SECURITY.md)

MIT License.
