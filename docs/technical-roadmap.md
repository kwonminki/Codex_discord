# Technical Roadmap

This document records engineering work that is worth doing but should not be mixed into unrelated feature or bug-fix changes. The line counts below are from the source tree on 2026-07-23, not GitHub's rendered page count.

## Completed Foundations

- [x] Validate Direct Worker job and control payloads with Zod at the disk/process boundary.
- [x] Move malformed durable worker and Discord queue records to private `dead-letter` storage.
- [x] Apply private POSIX modes to queue/worker directories and files.
- [x] Bound the Discord durable queue by TTL, request count, total JSON bytes, and per-request JSON bytes.
- [x] Document that incoming attachment bytes are stored separately from durable request JSON.

These foundations were completed in commit `76be4de`.

## Split Discord Orchestration Modules

Current size:

- `apps/discord-bot/src/messageHandler.ts`: approximately 2,810 lines
- `apps/discord-bot/src/discordClient.ts`: approximately 1,166 lines

`messageHandler.ts` currently coordinates authorization, routing, queues, Codex and Claude execution, approvals, user questions, attachments, session commands, progress, and completion delivery. Split this incrementally while keeping `createDiscordMessageHandler` as the stable composition boundary.

Suggested extraction order:

- [ ] Extract authorization and channel/request routing into pure functions.
- [ ] Extract queue and active-turn control decisions from Discord SDK objects.
- [ ] Extract progress delivery, deduplication, and message chunking.
- [ ] Extract final completion, mention, attachment, and survey delivery.
- [ ] Extract session commands such as fork, queue, status, and interrupt.
- [ ] Move Codex/Claude execution orchestration behind a shared agent execution contract without hiding capability differences.
- [ ] Reduce `discordClient.ts` to Discord transport and interaction adaptation responsibilities.

Acceptance criteria:

- Existing command, fork, queue, steering, approval, user-question, attachment, and completion behavior remains unchanged.
- Channel/session ownership and `controlKey` tests remain explicit.
- Extracted domain decisions can be tested without constructing Discord SDK objects.
- No module becomes a generic dumping ground that merely replaces `messageHandler.ts`.
- Full tests, typecheck, Windows compatibility tests, and manual Direct-mode Discord smoke tests pass.

## Publish Compiled Distribution

The npm package currently ships TypeScript source and starts it through `tsx`. This is convenient for development but couples the published runtime to repository source paths and runtime transpilation.

- [ ] Evaluate `tsup`, `esbuild`, and `tsc` against ESM, dynamic imports, Prisma, and workspace package imports.
- [ ] Produce executable `dist` entrypoints for the CLI, Discord gateway, worker, Control API, and local agent.
- [ ] Update `bin/cdc.js` so production execution does not load `tsx/esm`.
- [ ] Publish only required runtime files, documentation, Prisma schema/assets, and platform launch scripts.
- [ ] Add a packed-tarball install-and-start smoke test rather than checking only the file list.
- [ ] Verify fresh installs on macOS, Ubuntu, and native Windows.
- [ ] Keep source maps useful without embedding local paths or private build metadata.

Acceptance criteria:

- A clean machine can install the packed artifact without TypeScript or `tsx` runtime execution.
- `cdc setup`, Direct bot/worker startup, Codex, Claude Code, slash commands, and service launchers still work.
- `npm pack --dry-run` contains no tests, local state, secrets, logs, transcripts, or unintended source internals.
- Package startup and error messages remain diagnosable on every supported platform.

## Scope Rule

Do not combine either roadmap item with an unrelated feature release. Land each extraction in behavior-preserving slices, and make the compiled-package migration its own release with rollback instructions.
