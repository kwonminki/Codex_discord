# Codex Discord Sync Design

Date: 2026-04-23
Status: Draft approved in interactive brainstorming, written for implementation planning

## Goal

Build a system that lets a Discord server operate as a remote control and session surface for Codex across multiple computers.

The core user experience is:

- A Discord server mirrors Codex workspaces and sessions in a way that feels natural for Discord.
- If a computer is online, authorized Discord users can browse files and run shell commands against that computer from Discord.
- Discord categories and channels map cleanly onto workspace and session concepts.
- Existing native Codex sessions can be discovered from local Codex data and attached to Discord channels without rewriting Codex logs.

## Product Summary

The recommended product shape is a hybrid model:

- Codex native data is used as an import and recovery source.
- This project owns the operational source of truth for Discord mappings, permissions, workspace registrations, and channel state.
- Discord acts as the primary operator interface.

This avoids coupling the product directly to every internal Codex storage detail while still allowing import and recovery from real local Codex sessions.

## Scope

### In Scope for MVP

- Support one Discord server that can manage multiple computers.
- Register multiple computers, each running a Local Agent.
- Register workspaces on each computer.
- Map one Discord category to one workspace on one computer.
- Map one Discord channel to one managed operating room within that workspace.
- Allow a channel to exist before any Codex session is attached.
- Start a new managed Codex session from Discord.
- Import an existing native Codex session from local Codex logs and attach it to a Discord channel.
- Support shell-style file and command execution from Discord.
- Enforce role-based execution permissions.
- Record audit logs for command execution and critical control actions.
- Detect and surface offline machines, missing session links, and invalid workspace paths.

### Explicitly Out of Scope for MVP

- Perfect real-time mirroring of every Codex UI event into Discord.
- Multiple active Codex sessions attached to a single channel at the same time.
- Interactive terminal UI streaming such as `vim`, `top`, or full-screen shells.
- Fully automatic self-healing that recreates or relinks resources without operator approval.
- Discord voice, screenshare, or non-text collaboration features.

## Architecture

The system is split into four major parts.

### 1. Discord Bot

Responsibilities:

- Accept slash commands and message-based commands.
- Enforce role-based authorization.
- Create and manage Discord categories and channels.
- Render formatted results, errors, and status updates back into Discord.
- Coordinate session attach, import, and workspace actions.

### 2. Control DB

Responsibilities:

- Store registered computers and their capabilities.
- Store registered workspaces per computer.
- Store Discord category and channel mappings.
- Store current linked Codex session per channel.
- Store channel mode, current working directory, permission settings, and audit metadata.
- Store reconciliation state such as tombstoned channels, missing sessions, or invalid workspaces.

This database is the product's operational source of truth.

### 3. Local Agent

One Local Agent runs per computer.

Responsibilities:

- Maintain an outbound connection to the control plane.
- Report online or offline status and capabilities.
- Execute shell and file operations on the local machine.
- Enforce workspace boundaries and execution policy before running commands.
- Read local Codex data for session discovery and validation.
- Return stdout, stderr, exit status, and failure type to the bot.

### 4. Codex Adapter

The Codex Adapter lives inside the Local Agent and provides Codex-specific integration.

Responsibilities:

- Read `~/.codex/session_index.jsonl`.
- Read native session transcripts under `~/.codex/sessions/...`.
- Read archived sessions when needed for history or recovery.
- Extract session ids, thread names, timestamps, and path hints.
- Support import and link validation without mutating native Codex storage.

## Data Model

### Computer

Represents one registered machine.

Fields:

- `computer_id`
- `hostname`
- `agent_status`
- `last_heartbeat_at`
- `capabilities`
- `allowed_roles`

### Workspace

Represents a folder root on one specific computer.

Fields:

- `workspace_id`
- `computer_id`
- `absolute_path`
- `display_name`
- `status`

Important rule:

- The same absolute path on two different computers is treated as two different workspaces because the computer identity is part of the mapping.

### Category Mapping

Represents the Discord category linked to one workspace on one computer.

Fields:

- `discord_category_id`
- `workspace_id`
- `computer_id`
- `sync_status`

Important rule:

- One Discord category maps to one workspace on one computer.

### Managed Channel

Represents one Discord channel used as an operating room inside a workspace.

Fields:

- `channel_id`
- `workspace_id`
- `computer_id`
- `channel_mode`
- `cwd`
- `status`
- `current_session_link_id`

Important rules:

- A managed channel may exist before any Codex session is attached.
- A managed channel has at most one active Codex session link at a time.
- Historical attachments can remain in metadata, but only one is active.

### Codex Session Link

Represents the attachment between a managed channel and a Codex session.

Fields:

- `session_link_id`
- `channel_id`
- `codex_session_id`
- `session_origin`
- `thread_name_snapshot`
- `attached_at`
- `availability_status`

Important rules:

- `session_origin` is either `managed_new` or `imported_native`.
- Import never renames or rewrites native Codex logs.
- The immutable link is the Codex session id, not the thread name.

## Mapping Model

The recommended mapping model is:

- Computer -> one Local Agent
- Workspace on a computer -> one Discord category
- Managed operating room -> one Discord text channel
- Channel -> zero or one active Codex session link

This preserves the feel of:

- Codex folders -> Discord categories
- Codex sessions -> Discord channels

but with one deliberate refinement:

- The channel is the operating room, and the Codex session is an attachment to that room rather than the same thing.

This separation is what makes new session creation, existing session import, and administrative shell usage coexist cleanly.

## Naming Convention

To reduce ambiguity in a multi-computer setup, Discord naming should include machine context.

Recommended conventions:

- category name: `<computer_display_name> / <workspace_display_name>`
- shell administration channel: `shell-admin`
- session-linked channels: short purpose-oriented names such as `planning-sync`, `bugfix-auth`, or `rebuild-agent`

Display names may change over time, but stored identity must always rely on immutable ids rather than names.

## Command Model

There are two channel modes.

### 1. `shell-admin` Mode

Purpose:

- Machine administration
- Workspace browsing
- Debugging and recovery

Behavior:

- Bare messages are interpreted as commands.
- Examples: `ls`, `pwd`, `git status`, `npm test`

Access:

- Restricted to approved operational roles.

### 2. `session-linked` Mode

Purpose:

- Codex conversation with occasional operational commands

Behavior:

- Normal text is treated as Codex conversation.
- Operational commands must use slash commands or a prefix.
- Examples: `/session attach`, `/session import`, `!ls`, `!cat README.md`

This avoids ambiguity between human conversation and shell execution.

## Execution Context Rules

To keep behavior deterministic across repeated Discord commands:

- each managed channel stores its own current working directory
- the initial cwd for a channel is the mapped workspace root
- a successful `cd` updates only that channel's cwd
- one channel must not change another channel's cwd
- commands are serialized per channel so two shell actions do not race against the same channel context
- different channels in the same workspace may run independently

## Command Families

### Workspace Commands

- `ls`
- `tree`
- `pwd`
- `cd`
- `find`
- `cat`

### Shell Commands

- `git status`
- `npm test`
- `python ...`
- build, diagnostics, and maintenance commands

### Session Commands

- `/session new`
- `/session attach`
- `/session import`
- `/session list`

### Machine Commands

- `/computer list`
- `/workspace open`
- `/sync reconcile`
- agent status queries

## Permission and Safety Model

The user chose a broad execution model, including shell execution, so safety boundaries must be explicit.

### Authorization

- Only approved Discord roles can execute commands.
- Authorization is checked per computer and per workspace.
- Channel mode affects what syntax is accepted, but does not bypass role checks.

### Execution Policy Tiers

#### Tier 1: Safe Read

Examples:

- `ls`
- `pwd`
- `cat`
- `find`

Policy:

- Executes immediately if the role, channel, and workspace are allowed.

#### Tier 2: Normal Mutate

Examples:

- `mkdir`
- `touch`
- `git checkout -b`
- non-destructive build commands

Policy:

- Executes after role check.
- Always recorded in the audit log.

#### Tier 3: Dangerous Mutate

Examples:

- `rm`
- force pushes
- destructive git commands

Policy:

- Requires explicit confirmation in the same channel.
- Must never run silently.

### MVP Safety Constraints

- No full-screen interactive terminal programs.
- No background daemons launched from Discord.
- No execution in unmanaged or unauthorized channels.
- No silent destructive actions.

### Audit Requirements

For each execution, store:

- who triggered it
- which Discord channel triggered it
- target computer
- target workspace
- cwd at execution time
- raw command text
- tier classification
- timestamp
- result status

## Session Lifecycle

Managed channels move through four primary states.

### 1. Created

- Channel exists.
- Workspace and computer mapping exist.
- No Codex session is attached yet.

### 2. Attached

- Channel links to either a new managed session or an imported native session.

### 3. Active

- Commands and Codex chat operate against the linked session context.

### 4. Archived or Detached

- Channel is closed, archived, or detached from the current session.
- Historical link metadata remains available.

## Primary Workflows

### Start New Session from Discord

1. Admin creates a category and channel for a workspace.
2. Admin runs `/session new`.
3. The system creates a managed session record in the Control DB.
4. The Local Agent starts a fresh Codex session in the mapped workspace.
5. The channel stores the linked Codex session id and becomes active.

### Import Existing Native Codex Session

1. Admin runs `/session import` in a managed channel.
2. The Local Agent reads native Codex session data.
3. The bot shows recent sessions with title, timestamp, and workspace hints.
4. Admin selects one session.
5. The system stores the link without changing native Codex data.

## Reconciliation and Drift Handling

The MVP should detect drift aggressively but repair conservatively.

### Discord Channel Exists, But DB Record Is Missing

- Mark the channel as unmanaged.
- Offer an explicit adopt action.
- Do not guess ownership automatically.

### DB Link Exists, But Discord Channel Was Deleted

- Keep the historical record.
- Mark the channel mapping as tombstoned.
- Offer recreation into the same workspace mapping.

### Linked Codex Session Missing Locally

- Mark the session link as unavailable.
- Block execution that depends on that link.
- Require explicit reattach or import.

### Computer Offline

- Keep categories and channels visible.
- Surface offline status.
- Block execution while offline.

### Name Drift Between Discord and Codex

- Titles may drift.
- Session identity is resolved by Codex session id, not by channel name or thread title.
- MVP should not auto-rename channels based on native Codex title drift.

### Workspace Path Invalid or Moved

- Mark the workspace as invalid.
- Prevent execution until an admin remaps it to a valid absolute path on that computer.

## Background Sync Jobs

Recommended background checks:

- Local Agent heartbeat
- workspace path validation
- session link validation against local Codex data
- Discord object existence checks

Deliberately excluded auto-fixes for MVP:

- auto-renaming channels from Codex titles
- auto-deleting stale Discord channels
- auto-attaching a different session when one disappears
- auto-recreating missing local paths

## Discord Response Model

Each command response should follow a consistent pattern.

### Immediate Acknowledgement

The bot should immediately show:

- target computer
- target workspace
- cwd
- queued or running state

### Output Delivery

- Short output can be returned inline.
- Long output should be truncated in-channel with a clear continuation strategy.
- Failures should have distinct error types such as permission denied, offline agent, timeout, or unsafe command.

## MVP Build Order

Recommended implementation order:

1. Control DB and Local Agent heartbeat
2. Discord guild, category, and channel sync
3. Workspace and shell command execution
4. Codex session import and attach
5. Reconciliation and audit polish

## Testing Strategy

### Unit Tests

Cover:

- mapping rules
- permission evaluation
- channel state transitions
- command tier classification
- reconciliation decisions

### Integration Tests

Cover the end-to-end orchestration between:

- Discord command intake
- Control DB writes
- Local Agent job dispatch
- result reporting back to Discord

### Parser Tests with Realistic Codex Samples

Use fixture samples modeled after:

- `~/.codex/session_index.jsonl`
- native session transcript files under `~/.codex/sessions/...`

Validate:

- session discovery
- thread name extraction
- timestamp extraction
- missing or malformed data handling

### End-to-End Smoke Tests

Cover:

1. register a computer
2. register a workspace
3. create a category
4. create a channel
5. import an existing Codex session
6. run `ls`
7. verify dangerous command confirmation flow
8. verify offline-agent blocking

## Decisions Locked During Brainstorming

- Use a hybrid model where the project owns operational state and Codex native data acts as an import and recovery source.
- Support multi-computer operation from the start.
- Use role-based permissions rather than single-user authorization.
- Allow shell execution, not just read-only file commands.
- Separate channel creation from session attach and start.
- Use two channel modes: `shell-admin` and `session-linked`.
- Use explicit operator approval for risky recovery actions rather than aggressive auto-healing.

## Risks to Watch During Implementation

- Native Codex storage formats may evolve over time, so the adapter should isolate format-specific parsing.
- Discord message UX can become confusing if command syntax and conversational syntax are not sharply separated by channel mode.
- Shell execution will become unsafe quickly if workspace boundaries and role checks are not enforced at the agent boundary.
- Multi-computer support increases the importance of stable machine identity and clear category naming.

## Recommendation

Proceed with implementation planning based on the architecture above.

The first implementation plan should focus on:

- stable domain model and DB schema
- Local Agent protocol
- Discord bot command surface
- Codex native session import adapter
- safety and audit enforcement
