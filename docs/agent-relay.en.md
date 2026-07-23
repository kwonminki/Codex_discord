# Agent Relay Guide

Agent Relay is an optional second Discord bot that alternates final public answers and attachments between two agent session threads. It supports two sessions on one computer, different computers, and any Codex/Claude Code pairing.

## User flow

Run this in agent thread A:

```text
/agent-chat parent:#agent-parent-b peer:agent-thread-b goal:Compare both implementations and agree on an improvement plan max_rounds:20 timeout_minutes:1200
```

Select the peer agent's parent channel first. The `peer` autocomplete then searches active and archived threads under that parent. Discord exposes at most 25 autocomplete choices at once, so type part of the thread name to narrow the list. A thread ID, `<#thread-id>` mention, or Discord thread URL is also accepted as a fallback.

The Coordinator sends A's first execution request through the private relay-control channel, forwards A's final answer into B, then sends B's answer back into A. Execution rules and the full input prompt are not exposed in the work thread. Only the agent's final public answer and attachments are copied into the peer thread; progress and tool events are not used as the next agent's input. Files emitted through `codex-discord-send` are uploaded by the source Connector to the relay-control channel and reattached to both the target thread and the next private request. Cross-machine relay therefore transfers Discord attachment bytes, not unusable source-local paths.

Two consecutive `done` decisions from different agents complete the conversation. One round trip means one answer from A and one from B, and every agent prompt shows the current round trip and individual agent turn. An `extend` decision pauses the conversation and asks the Operator for another round trip. Clicking **왕복 1회 추가** (`Add one round trip`) on the final notice adds two agent turns and resumes with the other agent. Clicking **연장 거절 · 대화 종료** (`Reject extension and stop`) marks it `stopped` and releases both threads immediately. `max_rounds`, the overall timeout, `blocked`, a failed turn, or `/agent-chat-stop` also terminate it. The Coordinator mentions the Operator role once in the original A thread. Existing approval and user-question flows still mention the Operator immediately and wait for a response.

## Discord setup

Create a Discord Application/Bot separate from the existing Connector bot. Install one Coordinator per private Guild with:

The Discord account owner must perform the one-time application creation and OAuth approval in the Developer Portal. An existing bot token and the Discord Bot API cannot create another application. The user only creates the application, enables Message Content Intent, approves the invite, and enters the local secret; the installation agent handles the private channel, roles, permissions, ID discovery, and service registration afterward.

- View Channels
- Send Messages
- Send Messages in Threads
- Read Message History
- Attach Files
- Use Application Commands

Enable Message Content Intent in the Developer Portal. Assign the existing Operator role to the Coordinator Bot. Create a private text channel such as `agent-relay-control`, hide it from ordinary members, and allow only Connector and Coordinator bots to read and write it.

Store the Coordinator secret in `.connect/relay-config.json`:

```json
{
  "version": 1,
  "token": "SECOND_BOT_TOKEN",
  "guildId": "DISCORD_GUILD_ID",
  "operatorRoleIds": ["OPERATOR_ROLE_ID"],
  "controlChannelId": "PRIVATE_RELAY_CONTROL_CHANNEL_ID",
  "connectorBotUserIds": ["EXISTING_CONNECTOR_BOT_USER_ID"],
  "stateRoot": ".connect/agent-relay"
}
```

Keep the file mode `0600` and the `.connect`/state directories mode `0700`. Never put the token in Git or a Discord message.

Add the same Coordinator bot user ID and control channel to every participating machine's Direct `.connect/config.json`:

```json
{
  "direct": {
    "relay": {
      "trustedBotUserIds": ["COORDINATOR_BOT_USER_ID"],
      "controlChannelId": "PRIVATE_RELAY_CONTROL_CHANNEL_ID"
    }
  }
}
```

Each Connector accepts only exact marker requests sent by that bot ID in the private control channel, then executes them against the referenced locally owned agent thread. Ordinary bot messages in work threads, shell-admin channels, and all other bot messages remain blocked.

## Run

```bash
pnpm connect start --direct --component relay
```

On macOS, create a separate LaunchAgent that calls `scripts/start-mac-direct.sh relay`. On Ubuntu, create a separate systemd service for the same component command. On native Windows, use `scripts/install-windows-tasks.ps1 -IncludeRelay` to add a separate Relay Scheduled Task. Coordinator state is persisted in `.connect/agent-relay/conversations.json`; after a restart it also scans recent results in the relay-control channel.

Restart each Connector gateway once after applying relay configuration. Do not restart its independent Direct Worker, so active agent jobs remain alive.

## Commands

- `/agent-chat`: choose a peer parent and searchable thread, then start the conversation; use `max_rounds` for the initial round-trip limit
- `/agent-chat-status`: inspect the current or latest conversation
- `/agent-chat-stop`: stop future relay turns; it does not force-kill an agent turn already running

## Limits and cautions

- Defaults are 20 round trips and 20 hours (1,200 minutes). The command accepts 5 to 1,440 minutes. One round trip is one A answer plus one B answer, or two individual agent turns. Approving an extension resets the deadline to the full originally configured duration from the approval time.
- Only an Operator can click **왕복 1회 추가** (`Add one round trip`) or **연장 거절 · 대화 종료** (`Reject extension and stop`) on an `extend` notice. Approval grants two agent turns; rejection marks the conversation `stopped` and releases both threads. If the buttons are clicked concurrently or reused, only the first valid action succeeds.
- Up to 9 source result files, 10MiB each, cross to the peer in one turn. A long peer response may use the tenth attachment as text.
- Avoid using either session from Desktop, an IDE, or an ordinary Discord request during relay. Human messages do not steer a relay turn and wait in a separate queue, but the underlying session context is shared.
- Never implement relay by accepting every bot message. Preserve every boundary check: exact Coordinator bot ID, private control channel ID, exact request marker, target agent-thread mode, and machine-readable result callbacks. Public notices and peer-answer copies posted by the Coordinator in work threads are not execution requests.
- Run only one Coordinator instance per Guild. Multiple Connector computers sharing that Coordinator and control channel is expected.
