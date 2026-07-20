import os from "node:os";
import path from "node:path";
import { connectAgent } from "./agentClient.js";

const computerId = process.env.AGENT_COMPUTER_ID ?? "local-dev";
const displayName = process.env.AGENT_DISPLAY_NAME ?? computerId;
const hostname = process.env.AGENT_HOSTNAME ?? os.hostname();
const allowedRoleIds =
  process.env.DISCORD_ALLOWED_ROLE_IDS?.split(",")
    .map((roleId) => roleId.trim())
    .filter((roleId) => roleId.length > 0) ?? [];
const wsUrl = process.env.CONTROL_WS_URL ?? "ws://127.0.0.1:4317/agents";
const workspaceRoot = process.env.AGENT_WORKSPACE_ROOT;
const workspaces = workspaceRoot
  ? [
      {
        id: `${computerId}:${path.resolve(workspaceRoot)}`,
        absolutePath: path.resolve(workspaceRoot),
        displayName:
          process.env.AGENT_WORKSPACE_DISPLAY_NAME ?? path.basename(path.resolve(workspaceRoot)),
      },
    ]
  : [];

connectAgent(wsUrl, {
  computerId,
  displayName,
  hostname,
  allowedRoleIds,
  capabilities: ["shell", "codex-import", "codex-chat", "claude-code"],
  workspaces,
});

console.log(`local-agent ${computerId} connecting to ${wsUrl}`);
