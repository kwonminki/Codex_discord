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

Copy `.env.example` to `.env` and fill in the Discord credentials before starting the services.
