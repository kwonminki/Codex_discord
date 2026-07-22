# Codex Discord Connector

[한국어](README.md) | English

A personal bridge for using **Codex and Claude Code running on a Mac or Ubuntu server through Discord threads**.

Send an ordinary Discord message and the agent works on the connected computer, then returns important progress and the final answer to Discord. Images, video, audio, and general files can move in both directions.

> This bot can modify files and execute commands on connected computers. Use it only in a trusted private Discord server and on machines you control.

## Get started

You do not need to follow an installation procedure yourself. Send this repository and request to an AI coding agent such as Codex or Claude Code:

```text
https://github.com/kwonminki/Codex_discord

Read this repository's AI Agent Guide first, then install and configure it on my computer.
Ask me only for required account actions, one step at a time, and configure and verify everything else yourself.
```

The agent detects the conversation language and operating system, then configures Discord resources and local services. After the first computer is ready, it will ask whether you want to connect any additional Mac or Ubuntu servers.

## Supported languages

The connector UI supports:

- Korean
- English
- Simplified Chinese
- Japanese

The installation agent selects the language automatically from the conversation. Buttons, modals, status text, slash command descriptions, and `/howtouse` use that language. User messages and agent-authored answers remain unchanged.

## Using Discord

### New chat

Run `/chat-new` in a Codex or Claude Code parent channel to create a Discord thread and agent session.

```text
/chat-new name:Fix login bug
```

Send natural-language requests in the new thread:

```text
Inspect the current code and fix the login error.
Run the tests and report the result.
Find the broken segment in this video.
```

### Live guidance and queue

An ordinary message sent while Codex is working steers the current task immediately. Use `/queue prompt:` when the request must run as a separate turn after the current task.

```text
/queue prompt:Run the full test suite after the current change
```

The current headless Claude Code integration does not support live steering, so messages sent while it is working wait for the next turn.

### Fork a session

Use `/fork` inside a session thread to copy its conversation context into a new thread. The source and fork remain connected to separate agent sessions.

### Common commands

| Command | Purpose |
| --- | --- |
| `/chat-new` | Create a Discord thread and agent session |
| `/status` | Show activity, last progress, queue, and model settings |
| `/settings` | Show the effective model and effort |
| `/model` | Change a parent default or current thread model |
| `/effort` | Change a parent default or current thread effort |
| `/steer` | Explicitly steer an active Codex task |
| `/queue` | Reserve the next turn or inspect the queue |
| `/queue-clear` | Remove requests that have not started |
| `/interrupt` | Interrupt the active Codex turn |
| `/fork` | Copy the current context into a new thread |
| `/howtouse` | Teach the current agent Discord file and survey output |
| `/where` | Show the computer, working directory, and session ID |

## Files and media

Attach an image, video, audio file, document, or archive to a normal Discord message and describe the task. The bot stores it temporarily on the connected machine and gives the local path to the agent.

Run `/howtouse` once in a session so the agent knows how to return result files and media surveys. Then ask naturally:

```text
Attach the result video and log file to Discord.
Send both result videos and ask me which one is better.
```

- Default input limit: 10 files per message, 100 MiB per file, 250 MiB total
- Default output safety limit: 10 MiB per file
- A lower Discord server upload limit takes precedence.
- Ask the agent to compress, resize, re-encode, or split larger files.

## Notifications

Set each operations channel's Discord notifications to **Only @mentions**.

- Useful progress explanations accumulate quietly without a mention.
- Questions, permission requests, completion, and failure mention the Operator role.
- Long final answers are split across messages or attached as a complete text file.

## Multiple computers

One private Discord server can connect several Mac and Ubuntu machines. After the first installation, tell the agent:

```text
Connect another Ubuntu server to this Discord connector.
```

The agent asks for the machine type, connection method, workspace, and whether to enable Codex and Claude Code. It then reuses the existing Discord setup while creating separate channels and services for that machine.

## Important notes

### Do not run the same session concurrently

Starting work on the same session ID from Discord and Codex Desktop, VS Code, or another IDE at the same time can confuse message order and final-answer placement. Wait for one side to finish or separate the work with `/fork` or `/chat-new`.

### Service shutdown scope differs

- Restarting only the Discord bot leaves active work running in the independent worker.
- Force-stopping the worker or rebooting the computer may terminate active agents and their child processes.

### Permissions are powerful

The default automation setup can access files and commands broadly on the connected machine. Never connect it to a public Discord server or an untrusted role, and never send tokens or passwords in Discord messages.

## Documentation

- [English AI Agent Guide](docs/AI_AGENT_GUIDE.en.md): agent-only installation, updates, service operations, and troubleshooting
- [Korean AI Agent Guide](docs/AI_AGENT_GUIDE.md)
- [Localization Guide](docs/localization.md)
- [Security Policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
