# Codex Discord Sync

Codex Discord Sync connects a Discord server to one or more computers running Local Agents.

## MVP

- Register computers.
- Map workspaces to Discord categories.
- Create managed Discord channels.
- Run role-gated shell commands.
- Import native Codex sessions.
- Record execution audit events.

Direct Codex chat transport is not faked: session links store real Codex session identity for import/recovery, while unprefixed `session-linked` chat remains blocked until a real Codex message transport is added.

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
