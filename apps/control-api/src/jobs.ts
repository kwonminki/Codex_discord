import { randomUUID } from "node:crypto";
import type { AgentRegistry } from "./agentRegistry.js";

export interface AgentJob {
  jobId: string;
  type: "run-command" | "list-codex-sessions";
  payload: unknown;
}

export function createJob(
  computerId: string,
  type: AgentJob["type"],
  payload: unknown,
) {
  return {
    computerId,
    job: {
      jobId: randomUUID(),
      type,
      payload,
    },
  };
}

export async function dispatchJob(
  registry: Pick<AgentRegistry, "get">,
  computerId: string,
  job: AgentJob,
) {
  const agent = registry.get(computerId);

  if (!agent) {
    throw new Error("Computer is offline");
  }

  await agent.send(job);
}
