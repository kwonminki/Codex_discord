import { randomUUID } from "node:crypto";
import type { AgentRegistry } from "./agentRegistry.js";

export interface AgentJob {
  jobId: string;
  type: "run-command" | "list-codex-sessions" | "run-codex-prompt";
  payload: unknown;
}

export type AgentJobResult =
  | { jobId: string; result: unknown }
  | { jobId: string; error: { message: string } };

export type AgentJobResultEnvelope = AgentJobResult & { type: "agent-job-result" };

export interface AgentJobProgressEnvelope {
  type: "agent-job-progress";
  jobId: string;
  event: unknown;
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

export function createJobDispatcher(
  registry: Pick<AgentRegistry, "get">,
  options: { timeoutMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pendingJobs = new Map<
    string,
    {
      resolve(result: AgentJobResult): void;
      reject(error: Error): void;
      onProgress?: (event: unknown) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  return {
    async dispatchAndWait(
      computerId: string,
      job: AgentJob,
      options: { onProgress?: (event: unknown) => void } = {},
    ): Promise<AgentJobResult> {
      return new Promise<AgentJobResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingJobs.delete(job.jobId);
          reject(new Error("Agent job timed out"));
        }, timeoutMs);

        pendingJobs.set(job.jobId, { resolve, reject, onProgress: options.onProgress, timeout });

        dispatchJob(registry, computerId, job).catch((error: unknown) => {
          pendingJobs.delete(job.jobId);
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error("Agent job dispatch failed"));
        });
      });
    },
    progress(jobId: string, event: unknown) {
      const pendingJob = pendingJobs.get(jobId);

      if (!pendingJob) {
        return false;
      }

      pendingJob.onProgress?.(event);
      return true;
    },
    complete(result: AgentJobResult) {
      const pendingJob = pendingJobs.get(result.jobId);

      if (!pendingJob) {
        return false;
      }

      pendingJobs.delete(result.jobId);
      clearTimeout(pendingJob.timeout);
      pendingJob.resolve(result);
      return true;
    },
  };
}
