# Operator Guide

## Deployment Modes

Use Direct mode as the default deployment. Direct mode runs the Discord bot on the same computer it controls:

```text
Discord Bot -> Local Computer
```

This is the main supported path. It has the smallest runtime surface, keeps state in the local `.connect/` directory, and is the recommended setup for personal, single-workstation, and small trusted-team use.

Hub mode is the experimental multi-computer path:

```text
Discord Bot -> Control API -> Local Agent -> Local Computer
```

Use Hub mode only when one Discord server must reach more than one computer. It is still a testing-oriented secondary feature and has higher security risk than Direct mode because it adds a network API, websocket agent connections, and more places where credentials, command output, and workspace metadata can be exposed. Do not expose the Control API directly to the public internet. Prefer VPN, firewall rules, localhost-only testing, or another access-control layer, and start with non-sensitive machines.

## Channel Modes

`help` renders shortcut buttons for the common operations in each channel mode. Buttons use the same command router and role checks as typed commands; shell buttons use an internal prefix so they still work inside session-linked Codex chat channels.

The bot also registers Discord-native slash commands on startup. Discord shows them globally, but the bridge enforces channel boundaries at runtime: admin/main channels are for operations, and session-linked channels are for Codex conversation.

Admin/main commands:

- `/where` shows the current channel mode, computer, workspace, cwd, timeout, and linked Codex session.
- `/status` shows the same status card with model preference when present.
- `/browse` opens the current directory browser UI.
- `/shell command:<명령>` runs a shell command through the existing safety policy.
- `/diff` runs `git diff --stat` in the current channel cwd.
- `/sync limit:<숫자>` opens a multi-select picker so only chosen active sessions are synced.
- `/sync-select limit:<숫자>` does the same thing as `/sync` for operators who prefer the explicit name.
- `/sync-all limit:<숫자>` immediately syncs active sessions without opening the picker.
- `/sync-status` summarizes workspace category mappings, synced session channels, archived sessions, and posted context previews.
- `/sync-mode mode:on-chat 또는 realtime` chooses transcript freshness for synced session channels.
- `/sync-delete mode:preview/all/channels/session session_id:<id> confirm:<true/false>` previews or confirms deletion of synced Discord resources without deleting local Codex session files. Preview cards include a dropdown for selecting one synced channel to delete.
- `/sync-archive session_id:<id> confirm:<true/false>` archives a Codex session in bridge state so future sync runs skip it.
- `/schedule action:create mode:once/every/daily/weekly command:<명령> at:<시간> every:<주기> weekdays:<요일>` persists a scheduled command in bridge state.
- `/schedule action:list` lists scheduled commands.
- `/schedule action:delete id:<id>` deletes a scheduled command.
- `/chat-new location:general/current/path name:<이름> cwd:<경로> category:<true/false> prompt:<요청>` creates a new pending Codex chat channel. `general` uses a separate general-chat folder, `current` uses the invoking channel cwd, and `path` uses the provided `cwd`.
- `/reload mode:commands` re-registers Discord slash commands without disconnecting the bot.
- `/reload mode:restart confirm:true` asks the bot process to restart after replying in Discord.

Session-linked commands:

- `/codex prompt:<요청>` sends a normal Codex prompt.
- `/review prompt:<관점>` runs `codex exec review` for the current repository changes.
- `/fix-tests` asks Codex to run tests, diagnose failures, fix them, and verify again.
- `/summarize target:<대상>` asks Codex to summarize a channel or project context.
- `/compact prompt:<요청>` asks Codex to produce a compact working-context summary; it is not an interactive slash passthrough.
- `/skill name:<skill> prompt:<요청>` sends an exec-compatible prompt asking Codex to apply the named skill perspective.
- `/model model:<모델>` stores a per-channel model preference used by later Codex runs until the bot restarts.
- `/archive` opens a confirmation card for the current generated session channel; use `archive confirm` to archive.
- `/where` and `/status` show bridge channel status, including channel mode, computer, workspace, cwd, linked session, and model preference.
- `/browse` opens the current directory browser UI.
- `/shell command:<명령>` runs a shell command through the existing safety policy; typed shell commands in session channels use the `!` prefix.
- `/diff` runs `git diff --stat` in the current channel cwd.
- `/codex-command command:<name> prompt:<args>` maps supported shortcuts such as `model`, `diff`, `review`, `compact`, and `mcp` to working bridge or CLI actions.
- `/schedule action:create mode:once/every/daily/weekly command:<명령> at:<시간> every:<주기> weekdays:<요일>` schedules an existing typed command in this session channel.

These native commands are only shortcuts into the same router. Role checks, command confirmation rules, working-directory state, Codex session linkage, and channel boundaries are unchanged.

Scheduled commands reuse the same router too. The scheduled `command:` value should be a supported typed command such as `shell pwd`, `codex README 요약`, `review 보안 위험 위주`, `sync status`, or `browse`. Schedules are stored in `.connect/state.json`, survive bot restarts, and are checked every 30 seconds by default. Set `CONNECT_SCHEDULE_POLL_INTERVAL_MS` to tune the polling interval.

### shell-admin

Bare messages are treated as shell commands after Discord role checks. Examples:

- `ls`
- `git status`
- `pnpm test`
- Button: `새 일반 채팅`
- Button: `현재 폴더 채팅`
- Button: `세션 선택 동기화`
- Button: `파일 탐색`
- Button: `전체 동기화`
- Button: `삭제 미리보기`
- Button: `명령어 재등록`
- Button: `유지보수`
- Maintenance button: `봇 개발 채팅` creates a current-workspace Codex session with a self-maintenance prompt.
- Maintenance button: `타입체크` runs `pnpm typecheck`; `테스트 실행` runs `pnpm test`.
- Dropdown: `작업 선택`
- Dropdown action: `Git 충돌 점검` runs `git diff --check` to catch conflict markers and whitespace errors before Codex edits continue.
- `ls` result button: `상위 폴더`
- `ls` result button: `새로고침`
- `ls` result button: `이전 페이지` / `다음 페이지`
- `ls` result dropdown: `하위 항목으로 이동`
- `ls` result dropdown: `파일 보기`
- `git status --short` result button: `Diff 보기`
- `pnpm test` result button: `테스트 다시 실행`

Admin/main does not call Codex directly. `codex ...`, `/codex`, `/review`, `/fix-tests`, `/compact`, `/skill`, `/model`, and `/archive` are blocked with guidance to create or use a session channel.

### session-linked

Session-linked channels attach/import native Codex session identity. Normal text is sent to Codex, while operational shell commands use the `!` prefix. Examples:

- `이 세션에서 지금까지 한 일 요약해줘`
- `다음 단계 구현해줘`
- `!ls`
- `!cat README.md`
- `summarize 이번 채널`
- `diff`
- `browse`
- `shell pwd`
- `codex-command mcp list`
- `schedule every 10m command:shell pwd`
- `schedule daily at 09:30 command:codex 오늘 계획 정리`
- `schedule list`
- `archive confirm`
- Button: `이 세션 보관`
- Button: `Codex에게 요청`
- Button: `파일 보기`
- Button: `Git 상태`
- Button: `테스트 실행`
- Button: `Codex 리뷰`
- Button: `테스트 수정`
- Button: `충돌 점검`
- Button: `유지보수`
- Dropdown: `작업 선택`
- `!ls` result dropdown: `하위 항목으로 이동`
- `!ls` result dropdown: `파일 보기`
- `git status --short` result button: `Codex 리뷰`
- failed `pnpm test` result button: `Codex에게 수정 요청`

Session channels do not manage global bridge state. `/sync`, `/sync-all`, `/sync-status`, `/sync-mode`, `/chat-new`, and `/reload` are blocked with guidance to use the admin/main channel.

Component-generated shell commands are routed internally, so file/Git/Test buttons work in session-linked channels even though manually typed shell commands still use the `!` prefix. New-chat buttons open a modal for channel name and initial prompt; `현재 폴더 채팅` and `여기서 새 채팅` use the channel's current cwd.

Codex progress updates are shown as plain Korean text rather than raw JSON event names. Typical statuses are `요청 접수됨`, `세션 연결됨`, `파일 탐색 중`, `이미지 생성 중`, `컨텍스트 압축 중`, `답변 작성 중`, and `응답 정리 중`. If Codex references a local generated image in the final message, the bot attaches that image file to the Discord reply; remote image URLs are included in message content so Discord can preview them.

When `sync` creates or revisits a Codex session channel, the bot posts a compact `이전 Codex 대화 맥락` message once if native transcript context is available. This preview includes recent user requests and Codex final answers, skips injected environment/instruction blocks, and records `contextPostedAt` in `.connect/state.json` to avoid duplicate posting.

Sync and bulk-delete operations send Discord channel mutations with bounded concurrency, so multiple channel creates/deletes can happen at once while still avoiding an unbounded burst against Discord rate limits. To remove just one synced Discord session channel without archiving the Codex session, run `sync delete session <session-id>` to preview and `sync delete session <session-id> confirm` to delete its Discord channel mapping. Use `sync archive <session-id> confirm` only when the session should also stay excluded from future syncs.

Run `/sync`, `sync`, or `sync select 25` in the admin channel to open the session picker. The resulting dropdown shows up to 25 active sessions and sends only the selected session ids through the sync pipeline. Use `/sync-all` or `sync all 25` only when you intentionally want to import every active session immediately.

Use `/sync-mode`, `sync mode on-chat`, or `sync mode realtime` to choose transcript freshness for synced session channels. `on-chat` refreshes a channel right before the next Discord chat resumes the Codex session. `realtime` additionally polls already-synced session channels about every 1 second and posts new desktop-side transcript updates without waiting for a new Discord message. It never creates new Discord channels by itself; newly opened desktop sessions are imported only after an explicit admin `sync` or `/sync`. Recent desktop-side user prompts, assistant commentary, and tool-status events are mirrored, while sessions currently being streamed directly by Discord are marker-updated without duplicate reposting. Tune this interval with `CONNECT_TRANSCRIPT_SYNC_INTERVAL_MS`.

For orientation, run `/where` in any managed channel before executing commands. In an admin channel, run `/sync-status` or `sync status` to check whether state cleanup or selective sync is needed. In a session channel, run `/status` to confirm the linked Codex session and model preference.

To update the bot from Discord, run `reload` for a safe slash-command refresh. Run `reload restart` first if you want the confirmation card, or `reload restart confirm` to restart immediately. Restart automation is handled by `pnpm connect start --direct` and `pnpm connect start --hub`; a bot launched directly with `pnpm dev:bot` will exit and must be started again from the terminal.

For Discord-only bot maintenance, use the admin `유지보수` panel: open `봇 개발 채팅`, ask Codex to make the change in the created session channel, run `타입체크`, run `테스트 실행`, then use `명령어 재등록` for slash-command-only changes or `봇 재시작` for code changes.

## Safety Rules

- Only users with an approved Discord role can run operator actions.
- Each channel starts with a working directory inside the workspace root, and `cd` updates only that channel working directory.
- The Local Agent is not an OS sandbox or chroot; shell execution still runs as the local user.
- Direct mode is the default and recommended deployment.
- Hub mode is experimental, intended for multi-computer testing, and carries higher security risk.
- Commands that reference absolute paths, parent traversal tokens, or shell escape patterns require confirmation.
- Confirmed commands should be treated as full local-user shell access.
- Dangerous commands require confirmation.
- Offline computers block execution.
- Missing Codex session links block session-dependent actions.
- `archive confirm` archives only the bridge mapping and does not move or delete local Codex files.

## Native Codex Import

The Local Agent reads `CODEX_HOME`, usually `$HOME/.codex`, then loads active sessions from `session_index.jsonl`, session transcript files under `sessions/`, and Codex thread state from `state_*.sqlite` when available.

Archived Codex sessions, sub-agent sessions, one-off `codex exec`/CLI sessions, and index entries that cannot be verified in Codex thread state are excluded from default sync. Bridge-archived session ids in `.connect/state.json` are also excluded.

Import is read-only. The agent does not modify native Codex files.
