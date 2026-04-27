# Contributing

Thanks for considering a contribution to Codex Discord Connecter.

This project can execute local shell commands through Discord, so contributions should treat security and operator clarity as product requirements, not optional polish.

## Development Setup

```bash
pnpm install
pnpm test
pnpm typecheck
```

For local manual testing, create a private Discord test server and configure a dedicated bot token and operator role:

```bash
pnpm connect setup --direct
pnpm connect start --direct
```

Never use a production Discord token or a public/community server for development testing.

## Before Opening a Pull Request

Run:

```bash
pnpm test
pnpm typecheck
npm pack --dry-run
```

Review the `npm pack --dry-run` output. It must not include:

- `.env`
- `.connect/`
- local database files
- logs
- Discord tokens
- Codex session or transcript files
- private workspace data

## Security Expectations

- Keep role checks fail-closed.
- Keep admin/main channel behavior separate from session channel behavior.
- Do not log tokens, full local config objects, raw environment variables, or private transcript content.
- Treat shell execution, file browsing, transcript sync, scheduled commands, and Discord message deletion as high-risk surfaces.
- Update `SECURITY.md` when a change affects permissions, shell execution, package contents, or token handling.

## Code Style

- Follow the existing TypeScript style and local module boundaries.
- Add focused tests for command routing, Discord adapters, and response formatting when behavior changes.
- Prefer small, reviewable changes over broad refactors.
- Keep user-facing Discord copy clear about what will happen before destructive actions.

## License

By contributing, you agree that your contributions are provided under the MIT License used by this project. See `LICENSE` for the full license text.
