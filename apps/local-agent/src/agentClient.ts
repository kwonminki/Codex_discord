import WebSocket from "ws";
import { listNativeCodexSessions } from "./codexAdapter.js";
import { runWorkspaceCommand } from "./runner.js";

export interface AgentConfig {
  computerId: string;
  displayName: string;
  capabilities: string[];
}

export interface AgentJob {
  jobId: string;
  type: string;
  payload: unknown;
}

export function createAgentHelloMessage(config: AgentConfig) {
  return {
    type: "agent-hello",
    computerId: config.computerId,
    displayName: config.displayName,
    capabilities: config.capabilities,
  };
}

export async function handleAgentJob(job: AgentJob) {
  if (job.type === "run-command") {
    return runWorkspaceCommand(job.payload as Parameters<typeof runWorkspaceCommand>[0]);
  }

  if (job.type === "list-codex-sessions") {
    const payload = job.payload as { codexHome: string };
    return listNativeCodexSessions(payload.codexHome);
  }

  throw new Error("Unsupported agent job type");
}

export function connectAgent(wsUrl: string, config: AgentConfig) {
  const socket = new WebSocket(wsUrl);

  socket.on("open", () => {
    socket.send(JSON.stringify(createAgentHelloMessage(config)));
  });

  socket.on("message", (raw) => {
    void (async () => {
      const job = JSON.parse(raw.toString()) as AgentJob;
      const result = await handleAgentJob(job);
      socket.send(JSON.stringify({ type: "agent-job-result", jobId: job.jobId, result }));
    })().catch((error) => {
      console.error("local-agent failed to handle job", error);
    });
  });

  return socket;
}
