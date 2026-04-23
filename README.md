# Codex Discord Sync

Codex Discord Sync connects a Discord server to one or more computers running Local Agents.

## MVP

- Register computers.
- Map workspaces to Discord categories.
- Create managed Discord channels.
- Run role-gated shell commands.
- Import native Codex sessions.
- Record execution audit events.

## Development

- `pnpm install`
- `DATABASE_URL="file:./dev.sqlite" pnpm prisma db push`
- `pnpm test`
- `pnpm typecheck`

## Processes

- `pnpm dev:control`
- `pnpm dev:agent`
- `pnpm dev:bot`

## Control API Loop

- Local Agents connect to the Control API over `ws://<host>:<port>/agents`.
- Agent hello messages persist computer presence and advertised workspaces in the Control DB.
- Workspace mappings can be created with `POST /workspaces/:workspaceId/category-mappings` and `POST /workspaces/:workspaceId/channels`.
- The Discord bot has a guild sync service that creates workspace categories/channels and registers their IDs with the Control API.
- Codex sessions can be attached to managed Discord channels with `POST /discord/channels/:discordChannelId/session-links`.
- Command jobs can be submitted with `POST /computers/:computerId/jobs`.
- The Control API forwards each job to the online Local Agent and returns the agent result envelope.
- The Discord bot resolves managed channel context from `CONTROL_API_URL` and sends command messages to the linked computer.

Copy `.env.example` to `.env` and fill in the Discord credentials before starting the services.
