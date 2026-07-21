import { randomUUID } from "node:crypto";
import {
  appendFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type {
  CodexApprovalDecision,
  CodexApprovalRequest,
  CodexRunnerProgressEvent,
  CodexUserInputRequest,
  CodexUserInputResponse,
} from "./codexRunner.js";

export type DirectWorkerJobType = "run-command" | "run-codex-prompt" | "run-claude-prompt";
export type DirectWorkerJobStatus = "queued" | "running" | "completed" | "failed";

export interface DirectWorkerJobRequest {
  version: 1;
  jobId: string;
  type: DirectWorkerJobType;
  queueKey: string;
  payload: unknown;
  createdAt: string;
}

export interface DirectWorkerJobState {
  version: 1;
  jobId: string;
  status: DirectWorkerJobStatus;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  workerPid?: number | null;
}

export type DirectWorkerJobResult =
  | { jobId: string; result: unknown; completedAt: string }
  | { jobId: string; error: { message: string }; completedAt: string };

export type DirectWorkerJobEvent =
  | { type: "progress"; at: string; event: CodexRunnerProgressEvent }
  | { type: "approval"; at: string; approvalId: string; request: CodexApprovalRequest }
  | { type: "user-input"; at: string; userInputId: string; request: CodexUserInputRequest };

export interface DirectWorkerControlRequest {
  version: 1;
  controlId: string;
  controlKey: string;
  action: "steer" | "interrupt";
  content?: string;
  createdAt: string;
}

export interface DirectWorkerControlResult {
  controlId: string;
  result: unknown;
  completedAt: string;
}

function validId(value: string): string {
  const normalized = value.trim();

  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(normalized)) {
    throw new Error("Direct worker identifier contains unsupported characters.");
  }

  return normalized;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function createJsonOnce(filePath: string, value: unknown): Promise<boolean> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await link(temporaryPath, filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return false;
    }
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export function defaultDirectWorkerRoot(): string {
  return path.resolve(process.env.CONNECT_WORKER_ROOT ?? ".connect/worker");
}

export function createDirectWorkerStore(rootPath = defaultDirectWorkerRoot()) {
  const root = path.resolve(rootPath);
  const jobsRoot = path.join(root, "jobs");
  const controlsRoot = path.join(root, "controls");

  function jobDirectory(jobId: string): string {
    return path.join(jobsRoot, validId(jobId));
  }

  function controlDirectory(controlId: string): string {
    return path.join(controlsRoot, validId(controlId));
  }

  return {
    rootPath: root,
    async enqueue(input: {
      jobId?: string;
      type: DirectWorkerJobType;
      queueKey: string;
      payload: unknown;
    }): Promise<DirectWorkerJobRequest> {
      const jobId = validId(input.jobId ?? randomUUID());
      const request: DirectWorkerJobRequest = {
        version: 1,
        jobId,
        type: input.type,
        queueKey: input.queueKey.trim() || jobId,
        payload: input.payload,
        createdAt: new Date().toISOString(),
      };
      const directory = jobDirectory(jobId);
      const requestPath = path.join(directory, "request.json");
      const created = await createJsonOnce(requestPath, request);

      if (!created) {
        const existing = await readJson<DirectWorkerJobRequest>(requestPath);
        if (!existing) {
          throw new Error(`Direct worker job request disappeared: ${jobId}`);
        }
        return existing;
      }

      await writeJsonAtomic(path.join(directory, "state.json"), {
        version: 1,
        jobId,
        status: "queued",
        updatedAt: request.createdAt,
      } satisfies DirectWorkerJobState);
      return request;
    },
    async listRequests(): Promise<DirectWorkerJobRequest[]> {
      let entries: string[];
      try {
        entries = await readdir(jobsRoot);
      } catch (error) {
        if (isMissing(error)) {
          return [];
        }
        throw error;
      }

      const requests = await Promise.all(
        entries.map((entry) => readJson<DirectWorkerJobRequest>(path.join(jobsRoot, entry, "request.json"))),
      );
      return requests
        .filter((request): request is DirectWorkerJobRequest => Boolean(request?.jobId))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    readRequest(jobId: string) {
      return readJson<DirectWorkerJobRequest>(path.join(jobDirectory(jobId), "request.json"));
    },
    readState(jobId: string) {
      return readJson<DirectWorkerJobState>(path.join(jobDirectory(jobId), "state.json"));
    },
    async markRunning(jobId: string): Promise<void> {
      const now = new Date().toISOString();
      await writeJsonAtomic(path.join(jobDirectory(jobId), "state.json"), {
        version: 1,
        jobId,
        status: "running",
        updatedAt: now,
        startedAt: now,
        workerPid: process.pid,
      } satisfies DirectWorkerJobState);
    },
    async complete(jobId: string, result: unknown): Promise<void> {
      const completedAt = new Date().toISOString();
      await writeJsonAtomic(path.join(jobDirectory(jobId), "result.json"), {
        jobId,
        result,
        completedAt,
      } satisfies DirectWorkerJobResult);
      await writeJsonAtomic(path.join(jobDirectory(jobId), "state.json"), {
        version: 1,
        jobId,
        status: "completed",
        updatedAt: completedAt,
        completedAt,
        workerPid: process.pid,
      } satisfies DirectWorkerJobState);
    },
    async fail(jobId: string, error: unknown): Promise<void> {
      const completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error || "Direct worker job failed");
      await writeJsonAtomic(path.join(jobDirectory(jobId), "result.json"), {
        jobId,
        error: { message },
        completedAt,
      } satisfies DirectWorkerJobResult);
      await writeJsonAtomic(path.join(jobDirectory(jobId), "state.json"), {
        version: 1,
        jobId,
        status: "failed",
        updatedAt: completedAt,
        completedAt,
        workerPid: process.pid,
      } satisfies DirectWorkerJobState);
    },
    readResult(jobId: string) {
      return readJson<DirectWorkerJobResult>(path.join(jobDirectory(jobId), "result.json"));
    },
    async appendProgress(jobId: string, event: CodexRunnerProgressEvent): Promise<void> {
      const record: DirectWorkerJobEvent = { type: "progress", at: new Date().toISOString(), event };
      await mkdir(jobDirectory(jobId), { recursive: true });
      await appendFile(path.join(jobDirectory(jobId), "events.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
    },
    async requestApproval(jobId: string, request: CodexApprovalRequest): Promise<string> {
      const approvalId = randomUUID();
      const record: DirectWorkerJobEvent = {
        type: "approval",
        at: new Date().toISOString(),
        approvalId,
        request,
      };
      await mkdir(jobDirectory(jobId), { recursive: true });
      await appendFile(path.join(jobDirectory(jobId), "events.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
      return approvalId;
    },
    async requestUserInput(jobId: string, request: CodexUserInputRequest): Promise<string> {
      const userInputId = randomUUID();
      const record: DirectWorkerJobEvent = {
        type: "user-input",
        at: new Date().toISOString(),
        userInputId,
        request,
      };
      await mkdir(jobDirectory(jobId), { recursive: true });
      await appendFile(path.join(jobDirectory(jobId), "events.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
      return userInputId;
    },
    async readEvents(jobId: string): Promise<DirectWorkerJobEvent[]> {
      let raw: string;
      try {
        raw = await readFile(path.join(jobDirectory(jobId), "events.jsonl"), "utf8");
      } catch (error) {
        if (isMissing(error)) {
          return [];
        }
        throw error;
      }

      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as DirectWorkerJobEvent];
          } catch {
            return [];
          }
        });
    },
    async readDeliveryCursor(jobId: string): Promise<number> {
      const cursor = await readJson<{ eventCount?: unknown }>(
        path.join(jobDirectory(jobId), "delivery-cursor.json"),
      );
      return typeof cursor?.eventCount === "number" && cursor.eventCount >= 0
        ? Math.floor(cursor.eventCount)
        : 0;
    },
    writeDeliveryCursor(jobId: string, eventCount: number): Promise<void> {
      return writeJsonAtomic(path.join(jobDirectory(jobId), "delivery-cursor.json"), {
        eventCount: Math.max(0, Math.floor(eventCount)),
        updatedAt: new Date().toISOString(),
      });
    },
    writeApprovalDecision(jobId: string, approvalId: string, decision: CodexApprovalDecision) {
      return writeJsonAtomic(
        path.join(jobDirectory(jobId), "approvals", `${validId(approvalId)}.json`),
        decision,
      );
    },
    readApprovalDecision(jobId: string, approvalId: string) {
      return readJson<CodexApprovalDecision>(
        path.join(jobDirectory(jobId), "approvals", `${validId(approvalId)}.json`),
      );
    },
    writeUserInputResponse(jobId: string, userInputId: string, response: CodexUserInputResponse) {
      return writeJsonAtomic(
        path.join(jobDirectory(jobId), "user-input", `${validId(userInputId)}.json`),
        response,
      );
    },
    readUserInputResponse(jobId: string, userInputId: string) {
      return readJson<CodexUserInputResponse>(
        path.join(jobDirectory(jobId), "user-input", `${validId(userInputId)}.json`),
      );
    },
    async markDelivered(jobId: string): Promise<void> {
      await writeJsonAtomic(path.join(jobDirectory(jobId), "delivered.json"), {
        jobId,
        deliveredAt: new Date().toISOString(),
      });
      await rm(jobDirectory(jobId), { recursive: true, force: true });
    },
    isDelivered(jobId: string) {
      return pathExists(path.join(jobDirectory(jobId), "delivered.json"));
    },
    async removeJob(jobId: string): Promise<void> {
      await rm(jobDirectory(jobId), { recursive: true, force: true });
    },
    async enqueueControl(input: {
      controlKey: string;
      action: "steer" | "interrupt";
      content?: string;
    }): Promise<DirectWorkerControlRequest> {
      const controlId = randomUUID();
      const request: DirectWorkerControlRequest = {
        version: 1,
        controlId,
        controlKey: input.controlKey,
        action: input.action,
        ...(input.content ? { content: input.content } : {}),
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(path.join(controlDirectory(controlId), "request.json"), request);
      return request;
    },
    async listPendingControls(): Promise<DirectWorkerControlRequest[]> {
      let entries: string[];
      try {
        entries = await readdir(controlsRoot);
      } catch (error) {
        if (isMissing(error)) {
          return [];
        }
        throw error;
      }

      const controls = await Promise.all(
        entries.map(async (entry) => {
          if (await pathExists(path.join(controlsRoot, entry, "result.json"))) {
            return null;
          }
          return readJson<DirectWorkerControlRequest>(path.join(controlsRoot, entry, "request.json"));
        }),
      );
      return controls
        .filter((control): control is DirectWorkerControlRequest => Boolean(control?.controlId))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    async completeControl(controlId: string, result: unknown): Promise<void> {
      await writeJsonAtomic(path.join(controlDirectory(controlId), "result.json"), {
        controlId,
        result,
        completedAt: new Date().toISOString(),
      } satisfies DirectWorkerControlResult);
    },
    readControlResult(controlId: string) {
      return readJson<DirectWorkerControlResult>(path.join(controlDirectory(controlId), "result.json"));
    },
    async removeControl(controlId: string): Promise<void> {
      await rm(controlDirectory(controlId), { recursive: true, force: true });
    },
  };
}

export type DirectWorkerStore = ReturnType<typeof createDirectWorkerStore>;
