# Contributing

Thanks for considering a contribution to Codex Discord Connector.

This project can execute local shell commands and expose local workspace output through Discord. Contributions should treat security, operator clarity, and safe defaults as product requirements.

## Before You Start

- Read `README.md` for the user-facing workflow.
- Read `docs/operator-guide.md` for channel modes, sync behavior, and deployment details.
- Read `SECURITY.md` before changing command execution, Discord permissions, token handling, package contents, or transcript/session handling.
- Check existing GitHub issues to avoid duplicate work.
- For larger changes, open an issue first and describe the intended behavior, risk area, and test plan.

Do not use a production Discord bot token, production guild, or public/community server for development testing.

## Development Setup

Requirements:

- Node.js `>=20.12.0`
- pnpm `9.15.0` or compatible
- A private Discord test server
- A dedicated test bot token
- A test-only operator role

Install dependencies:

```bash
pnpm install
```

Run the default verification suite:

```bash
pnpm test
pnpm typecheck
```

Set up Direct mode for local manual testing:

```bash
pnpm connect setup --direct
pnpm connect start --direct
```

The setup writes local runtime files such as `.env` and `.connect/config.json`. These files must stay local.

## Project Map

```text
apps/
  connect-cli/      install, setup, and start commands
  control-api/      experimental Hub mode API
  discord-bot/      Discord client, commands, buttons, channel routing
  local-agent/      experimental Hub mode local agent
packages/
  codex-adapter/    Codex session index, state, and transcript parsing
  core/             shared domain types and command policy
docs/
  operator-guide.md operator-facing usage and safety guide
```

Use the existing package boundaries when adding behavior. Prefer small, focused changes over cross-package rewrites.

## What To Test

Run the whole suite before opening a pull request:

```bash
pnpm test
pnpm typecheck
npm pack --dry-run
```

Review the `npm pack --dry-run` file list. It must not include:

- `.env`
- `.connect/`
- local database files
- logs
- Discord tokens
- Codex session or transcript files
- private workspace data

Add focused tests for changed behavior:

- `packages/core`: command policy and shared domain rules.
- `packages/codex-adapter`: Codex session index, state, and transcript parsing.
- `apps/discord-bot`: command routing, slash commands, channel context, Discord response rendering, sync/archive/delete behavior.
- `apps/control-api`: Hub mode API behavior, repositories, reconciliation, agent registry, audit handling.
- `apps/local-agent`: local runner, workspace handling, Codex runner/client behavior.
- `apps/connect-cli`: configuration parsing and setup/start flows.
- `tests/e2e`: cross-package behavior that cannot be covered cleanly at unit level.

When a change affects Discord UI copy, include tests for the rendered response or command route when practical. If the copy may vary by language, cover the locale selection path and at least one fallback case.

## Security Expectations

Keep these rules in mind for every change:

- Role checks must fail closed.
- Admin/main channel behavior must stay separate from session channel behavior.
- Direct mode remains the recommended default.
- Hub mode is experimental and higher risk because it adds a network API and agent path.
- Destructive commands, absolute paths, parent traversal, and shell escape patterns need clear confirmation behavior.
- Shell execution, file browsing, transcript sync, scheduled commands, Discord message deletion, and package publishing are high-risk surfaces.
- Do not log tokens, full local config objects, raw environment variables, private transcript content, or command output that could contain secrets.
- Update `SECURITY.md` when a change affects permissions, shell execution, package contents, network exposure, or token handling.

If you discover a vulnerability involving tokens, local files, command execution, or Discord access controls, do not open a public issue. Follow `SECURITY.md`.

## Pull Request Checklist

Before opening a PR:

- Explain the user-visible change and why it is needed.
- Link the related issue when there is one.
- Include the commands you ran, especially `pnpm test`, `pnpm typecheck`, and `npm pack --dry-run` when relevant.
- Note any manual Discord testing you performed, including Direct mode or Hub mode.
- Call out security-sensitive areas touched by the PR.
- Update README, operator docs, contributing docs, or security docs when behavior changes.
- Keep generated local files, tokens, logs, databases, and Codex session files out of the diff.

## Code Style

- Follow the existing TypeScript style and local module boundaries.
- Prefer explicit names for command/channel state over clever abbreviations.
- Keep user-facing Discord copy clear about what will happen before destructive actions.
- Keep user-facing copy ready for localization: avoid hard-coding new Korean or English strings deep in business logic when a response/template boundary is available.
- Add abstractions only when they remove real duplication or clarify a boundary already present in the project.
- Avoid unrelated refactors in feature or bug-fix PRs.

## Issue Guidelines

Use the issue templates when available:

- Bug reports should include reproduction steps, expected behavior, actual behavior, affected mode, logs with secrets removed, and the security impact if any.
- Feature requests should explain the operator workflow, the channel mode, the security implications, and the acceptance criteria.
- Documentation issues should name the confusing page or section and describe what a new contributor or operator could misunderstand.

Issues that include secrets, tokens, private workspace paths, or transcript contents may be removed or edited for safety.

## License

By contributing, you agree that your contributions are provided under the MIT License used by this project. See `LICENSE` for the full license text.
