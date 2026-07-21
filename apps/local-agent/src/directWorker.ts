import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  interruptActiveCodexAppServerTurn,
  runCodexAppServerPrompt,
  steerActiveCodexAppServerTurn,
} from "./codexAppServerRunner.js";
import { runClaudePrompt, type RunClaudePromptInput } from "./claudeRunner.js";
import { runCodexPrompt, type CodexApprovalDecision, type RunCodexPromptInput } from "./codexRunner.js";
import { createDirectWorkerStore, type DirectWorkerJobRequest, type DirectWorkerStore } from "./directWorkerStore.js";
import { runWorkspaceCommand, type RunWorkspaceCommandInput } from "./runner.js";

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_CONCURRENCY = 4;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function processIsAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApproval(
  store: DirectWorkerStore,
  jobId: string,
  approvalId: string,
): Promise<CodexApprovalDecision> {
  for (;;) {
    const decision = await store.readApprovalDecision(jobId, approvalId);
    if (decision) {
      return decision;
    }
    await wait(250);
  }
}

async function runWorkerJob(store: DirectWorkerStore, request: DirectWorkerJobRequest): Promise<unknown> {
  if (request.type === "run-command") {
    return runWorkspaceCommand(request.payload as RunWorkspaceCommandInput);
  }

  if (request.type === "run-claude-prompt") {
    const input = request.payload as RunClaudePromptInput;
    return runClaudePrompt({
      ...input,
      onProgress: (event) => store.appendProgress(request.jobId, event),
    });
  }

  const payload = request.payload as {
    runner?: "app-server" | "exec";
    input: RunCodexPromptInput;
  };
  const runnerInput: RunCodexPromptInput = {
    ...payload.input,
    onProgress: (event) => store.appendProgress(request.jobId, event),
    onApprovalRequest: async (approvalRequest) => {
      const approvalId = await store.requestApproval(request.jobId, approvalRequest);
      return waitForApproval(store, request.jobId, approvalId);
    },
  };

  return payload.runner === "app-server" && runnerInput.mode !== "review"
    ? runCodexAppServerPrompt(runnerInput)
    : runCodexPrompt(runnerInput);
}

async function acquireWorkerLock(rootPath: string): Promise<() => Promise<void>> {
  const lockPath = path.join(rootPath, "worker.lock");
  await mkdir(rootPath, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath);
      await writeFile(path.join(lockPath, "pid"), `${process.pid}\n`, "utf8");
      return () => rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }

      const ownerPid = Number.parseInt(await readFile(path.join(lockPath, "pid"), "utf8").catch(() => ""), 10);
      if (processIsAlive(ownerPid)) {
        throw new Error(`Direct worker is already running with PID ${ownerPid}.`);
      }
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  throw new Error("Could not acquire the direct worker lock.");
}

export async function startDirectWorker(options: {
  store?: DirectWorkerStore;
  pollIntervalMs?: number;
  maxConcurrency?: number;
  controlCodexTurn?: (input: {
    controlKey: string;
    action: "steer" | "interrupt";
    content?: string;
  }) => Promise<unknown>;
} = {}): Promise<{ stop(): Promise<void> }> {
  const store = options.store ?? createDirectWorkerStore();
  const releaseLock = await acquireWorkerLock(store.rootPath);
  const pollIntervalMs = options.pollIntervalMs ?? positiveInteger(
    process.env.CONNECT_DIRECT_WORKER_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const maxConcurrency = options.maxConcurrency ?? positiveInteger(
    process.env.CONNECT_DIRECT_WORKER_CONCURRENCY,
    DEFAULT_MAX_CONCURRENCY,
  );
  const activeJobs = new Map<string, Promise<void>>();
  const activeQueueKeys = new Set<string>();
  let stopping = false;
  let ticking = false;
  let stopPromise: Promise<void> | null = null;
  const controlCodexTurn = options.controlCodexTurn ?? (async (control) =>
    control.action === "steer"
      ? steerActiveCodexAppServerTurn(control.controlKey, control.content ?? "")
      : interruptActiveCodexAppServerTurn(control.controlKey));

  async function recoverInterruptedJobs(): Promise<void> {
    for (const request of await store.listRequests()) {
      const state = await store.readState(request.jobId);
      if (state?.status === "running" && state.workerPid !== process.pid && !processIsAlive(state.workerPid)) {
        await store.fail(request.jobId, new Error("Direct worker restarted while this job was running."));
      }
    }
  }

  async function execute(request: DirectWorkerJobRequest): Promise<void> {
    activeQueueKeys.add(request.queueKey);
    await store.markRunning(request.jobId);

    try {
      await store.complete(request.jobId, await runWorkerJob(store, request));
    } catch (error) {
      await store.fail(request.jobId, error);
    } finally {
      activeQueueKeys.delete(request.queueKey);
      activeJobs.delete(request.jobId);
    }
  }

  async function processControls(): Promise<void> {
    for (const control of await store.listPendingControls()) {
      const result = await controlCodexTurn(control);
      await store.completeControl(control.controlId, result);
    }
  }

  async function tick(): Promise<void> {
    if (ticking) {
      return;
    }

    ticking = true;
    try {
      await processControls();
      if (stopping) {
        return;
      }
      const requests = await store.listRequests();

      for (const request of requests) {
        if (stopping) {
          break;
        }
        if (activeJobs.size >= maxConcurrency) {
          break;
        }

        if (activeJobs.has(request.jobId) || activeQueueKeys.has(request.queueKey)) {
          continue;
        }

        const state = await store.readState(request.jobId);
        if (state?.status !== "queued") {
          continue;
        }

        const execution = execute(request);
        activeJobs.set(request.jobId, execution);
      }
    } finally {
      ticking = false;
    }
  }

  await recoverInterruptedJobs();
  await tick();
  const timer = setInterval(() => {
    void tick().catch((error) => console.error("direct-worker poll failed", error));
  }, pollIntervalMs);

  function stop(): Promise<void> {
    if (stopPromise) {
      return stopPromise;
    }
    stopping = true;
    stopPromise = (async () => {
      while (ticking) {
        await wait(Math.min(pollIntervalMs, 25));
      }
      await Promise.allSettled(activeJobs.values());
      clearInterval(timer);
      while (ticking) {
        await wait(Math.min(pollIntervalMs, 25));
      }
      await processControls();
      await releaseLock();
    })();
    return stopPromise;
  }

  return { stop };
}

async function main(): Promise<void> {
  const worker = await startDirectWorker();
  console.info(`direct-worker ready with PID ${process.pid}`);
  let stopping = false;

  const stop = (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.info(`direct-worker received ${signal}; draining active jobs before exit`);
    void worker.stop().finally(() => process.exit(0));
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  await main();
}
