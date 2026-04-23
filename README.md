# Codex Discord Sync

Codex Discord Sync connects a Discord server to one or more computers running Local Agents.

## MVP

- Register computers.
- Map workspaces to Discord categories.
- Create managed Discord channels.
- Run role-gated shell commands.
- Ask Codex from Discord with `codex <prompt>` in shell-admin channels.
- Import native Codex sessions.
- Record execution audit events.

Codex chat uses the local `codex exec` CLI and stores the returned session id per Discord channel while the bot process is running. Shell-admin channels use `codex <prompt>` for Codex prompts. Session-linked channels send regular text to Codex and use `!` for shell commands.

## Development

- `pnpm install`
- `DATABASE_URL="file:./dev.sqlite" pnpm prisma db push`
- `pnpm test`
- `pnpm typecheck`

## Quick Connect

For one Discord server connected directly to this computer, run:

```bash
pnpm connect install --direct
pnpm connect start --direct
```

Direct mode writes `.connect/config.json` and `.env`, then starts only the Discord bot. It does not need the Control API or Local Agent process, so it is the easiest single-computer setup. Direct mode cannot control multiple computers.

In the configured Discord channel:

```text
help
sync
codex sync 10
sync delete preview
sync delete all confirm
codex 이 프로젝트 구조 설명해줘
codex README에 사용법 추가해줘
ls
cd apps
cat README.md
```

`sync` reads local Codex sessions from `~/.codex/session_index.jsonl`, groups them by workspace folder, creates one Discord category per folder, and creates one Discord text channel per Codex session. The channel mapping is stored in `.connect/state.json`.

Synced Discord channels can be bulk-deleted from the admin channel:

```text
sync delete preview
sync delete channels confirm
sync delete all confirm
```

`sync delete channels confirm` deletes only synced Discord text channels and keeps categories in state. `sync delete all confirm` deletes synced Discord text channels and categories, then clears `.connect/state.json`. These commands never delete or move local Codex session files.

After sync, use the generated session channels like Codex rooms:

```text
이 세션에서 지금까지 한 일 요약해줘
다음 단계 구현해줘
!ls
!cat README.md
```

Codex prompts run through the local Codex CLI with workspace-write sandboxing. Restart the bot after code updates so Discord uses the latest behavior.

For multi-computer hub mode, run:

```bash
pnpm connect setup --hub
pnpm connect start --hub
```

Hub mode keeps the existing `Discord Bot -> Control API -> Local Agent` topology and supports multiple computers.

## Processes

- `pnpm dev:control`
- `pnpm dev:agent`
- `pnpm dev:bot`

## Control API Loop

- Local Agents connect to the Control API over `ws://<host>:<port>/agents`.
- Agent hello messages persist computer presence and advertised workspaces in the Control DB.
- Persisted computers and workspaces can be listed with `GET /inventory`.
- Workspace mappings can be created with `POST /workspaces/:workspaceId/category-mappings` and `POST /workspaces/:workspaceId/channels`.
- The Discord bot has a guild sync service that creates workspace categories/channels and registers their IDs with the Control API.
- Codex sessions can be attached to managed Discord channels with `POST /discord/channels/:discordChannelId/session-links`.
- Existing native Codex sessions can be listed through an online agent with `POST /computers/:computerId/codex-sessions`.
- Command jobs can be submitted with `POST /computers/:computerId/jobs`.
- The Control API forwards each job to the online Local Agent and returns the agent result envelope.
- The Discord bot resolves managed channel context from `CONTROL_API_URL` and sends command messages to the linked computer.

Copy `.env.example` to `.env` and fill in the Discord credentials before starting the services.
