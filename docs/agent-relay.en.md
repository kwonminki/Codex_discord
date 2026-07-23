# Agent Relay Guide

Agent Relay is an optional second Discord bot that alternates final public answers and attachments between two agent session threads. It supports two sessions on one computer, different computers, and any Codex/Claude Code pairing.

## User flow

Run this in agent thread A:

```text
/agent-chat parent:#agent-parent-b peer:agent-thread-b goal:Compare both implementations and agree on an improvement plan max_rounds:6 timeout_minutes:120
```

Select the peer agent's parent channel first. The `peer` autocomplete then searches active and archived threads under that parent. Discord exposes at most 25 autocomplete choices at once, so type part of the thread name to narrow the list. A thread ID, `<#thread-id>` mention, or Discord thread URL is also accepted as a fallback.

The Coordinator asks A first, forwards A's final answer into B, then sends B's answer back into A. Private reasoning and command logs are not relayed. Files emitted through `codex-discord-send` are uploaded by the source Connector to a private relay-control channel and reattached by the Coordinator in the target thread. Cross-machine relay therefore transfers Discord attachment bytes, not unusable source-local paths.

Two consecutive `done` decisions from different agents complete the conversation. `max_rounds`, the overall timeout, `blocked`, a failed turn, or `/agent-chat-stop` also terminate it. The Coordinator mentions the Operator role once in the original A thread. Existing approval and user-question flows still mention the Operator immediately and wait for a response.

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

Each Connector accepts bot-authored requests only from that exact ID and only in agent session threads. Shell-admin channels and all other bot messages remain blocked.

## Run

```bash
pnpm connect start --direct --component relay
```

On macOS, create a separate LaunchAgent that calls `scripts/start-mac-direct.sh relay`. On Ubuntu, create a separate systemd service for the same component command. On native Windows, use `scripts/install-windows-tasks.ps1 -IncludeRelay` to add a separate Relay Scheduled Task. Coordinator state is persisted in `.connect/agent-relay/conversations.json`; after a restart it also scans recent results in the relay-control channel.

Restart each Connector gateway once after applying relay configuration. Do not restart its independent Direct Worker, so active agent jobs remain alive.

## Commands

- `/agent-chat`: choose a peer parent and searchable thread, then start the conversation
- `/agent-chat-status`: inspect the current or latest conversation
- `/agent-chat-stop`: stop future relay turns; it does not force-kill an agent turn already running

## Limits and cautions

- Defaults are 6 round trips and 120 minutes, configurable per command.
- Up to 9 source result files, 10MiB each, cross to the peer in one turn. A long peer response may use the tenth attachment as text.
- Avoid using either session from Desktop, an IDE, or an ordinary Discord request during relay. Human messages do not steer a relay turn and wait in a separate queue, but the underlying session context is shared.
- Never implement relay by accepting every bot message. Preserve all three checks: exact Coordinator bot ID, agent-thread mode, and machine-readable result callbacks.
- Run only one Coordinator instance per Guild. Multiple Connector computers sharing that Coordinator and control channel is expected.
