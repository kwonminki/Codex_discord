# Operator Guide

## Channel Modes

### shell-admin

Bare messages are treated as shell commands after Discord role checks. Examples:

- `ls`
- `git status`
- `pnpm test`

### session-linked

Normal messages are Codex chat. Operational commands use the `!` prefix. Examples:

- `!ls`
- `!cat README.md`

## Safety Rules

- Only users with an approved Discord role can run operator actions.
- Each channel starts with a working directory inside the workspace root, and `cd` updates only that channel working directory.
- The Local Agent is not an OS sandbox or chroot; shell execution still runs as the local user.
- Commands that reference absolute paths, parent traversal tokens, or shell escape patterns require confirmation.
- Confirmed commands should be treated as full local-user shell access.
- Dangerous commands require confirmation.
- Offline computers block execution.
- Missing Codex session links block session-dependent actions.

## Native Codex Import

The Local Agent reads `CODEX_HOME`, usually `$HOME/.codex`, then loads `session_index.jsonl` and session transcript files under `sessions/`.

Import is read-only. The agent does not modify native Codex files.
