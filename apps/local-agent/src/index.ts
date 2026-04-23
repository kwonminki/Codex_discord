import { connectAgent } from "./agentClient.js";

const computerId = process.env.AGENT_COMPUTER_ID ?? "local-dev";
const displayName = process.env.AGENT_DISPLAY_NAME ?? computerId;
const wsUrl = process.env.CONTROL_WS_URL ?? "ws://127.0.0.1:4317/agents";

connectAgent(wsUrl, {
  computerId,
  displayName,
  capabilities: ["shell", "codex-import"],
});

console.log(`local-agent ${computerId} connecting to ${wsUrl}`);
