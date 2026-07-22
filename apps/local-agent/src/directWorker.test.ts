import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createDirectWorkerClient } from "../../discord-bot/src/directWorkerClient.js";
import { startDirectWorker } from "./directWorker.js";
import { createDirectWorkerStore } from "./directWorkerStore.js";

describe("direct worker", () => {
  it("wakes immediately for a new job while retaining a slow polling fallback", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-worker-wake-"));
    const store = createDirectWorkerStore(path.join(root, "worker"));
    const worker = await startDirectWorker({ store, pollIntervalMs: 10_000, maxConcurrency: 1 });
    const client = createDirectWorkerClient({ store, pollIntervalMs: 10 });

    try {
      const startedAt = Date.now();
      await expect(client.submit({
        jobId: "wake-job",
        type: "run-command",
        queueKey: "thread-1",
        payload: {
          workspaceRoot: root,
          cwd: root,
          command: "printf woke",
          timeoutMs: 5_000,
          confirmedDangerous: true,
        },
      })).resolves.toMatchObject({ result: { status: "completed", stdout: "woke" } });
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      await worker.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps executing a durable job while a second client reconnects to the same job id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-worker-"));
    const workspace = path.join(root, "workspace");
    const store = createDirectWorkerStore(path.join(root, "worker"));
    const worker = await startDirectWorker({ store, pollIntervalMs: 10, maxConcurrency: 2 });
    const firstClient = createDirectWorkerClient({ store, pollIntervalMs: 10 });
    const secondClient = createDirectWorkerClient({ store, pollIntervalMs: 10 });

    try {
      const input = {
        jobId: "discord-request-1",
        type: "run-command" as const,
        queueKey: "thread-1",
        payload: {
          workspaceRoot: root,
          cwd: root,
          command: `mkdir -p '${workspace}' && sleep 0.15 && printf survived`,
          timeoutMs: 5_000,
          confirmedDangerous: true,
        },
      };
      const originalWaiter = firstClient.submit(input);

      await expect(secondClient.submit(input)).resolves.toMatchObject({
        jobId: "discord-request-1",
        result: {
          status: "completed",
          stdout: "survived",
        },
      });
      await expect(originalWaiter).resolves.toMatchObject({ jobId: "discord-request-1" });
    } finally {
      await worker.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes jobs with the same queue key while allowing durable result reads", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-worker-order-"));
    const outputPath = path.join(root, "order.txt");
    const store = createDirectWorkerStore(path.join(root, "worker"));
    const firstClient = createDirectWorkerClient({ store, pollIntervalMs: 10 });
    const secondClient = createDirectWorkerClient({ store, pollIntervalMs: 10 });

    try {
      const basePayload = {
        workspaceRoot: root,
        cwd: root,
        timeoutMs: 5_000,
        confirmedDangerous: true,
      };
      const first = firstClient.submit({
        jobId: "ordered-1",
        type: "run-command",
        queueKey: "thread-1",
        payload: { ...basePayload, command: `sleep 0.1; printf 'first\\n' >> '${outputPath}'` },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = secondClient.submit({
        jobId: "ordered-2",
        type: "run-command",
        queueKey: "thread-1",
        payload: { ...basePayload, command: `printf 'second\\n' >> '${outputPath}'` },
      });
      const startedAt = Date.now();
      const worker = await startDirectWorker({ store, pollIntervalMs: 1_500, maxConcurrency: 4 });

      try {
        await Promise.all([first, second]);
        expect(Date.now() - startedAt).toBeLessThan(1_000);
        await expect(readFile(outputPath, "utf8")).resolves.toBe("first\nsecond\n");
      } finally {
        await worker.stop();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists the Discord progress delivery cursor for reconnecting clients", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-worker-cursor-"));
    const store = createDirectWorkerStore(path.join(root, "worker"));

    try {
      await store.enqueue({
        jobId: "cursor-job",
        type: "run-command",
        queueKey: "thread-1",
        payload: {},
      });
      await store.appendProgress("cursor-job", { type: "agent-message", text: "first" });
      await expect(store.readEvents("cursor-job")).resolves.toHaveLength(1);
      await store.appendProgress("cursor-job", { type: "agent-message", text: "second" });
      await store.writeDeliveryCursor("cursor-job", 1);
      await store.complete("cursor-job", { status: "completed" });
      const delivered: string[] = [];

      await expect(store.readDeliveryCursor("cursor-job")).resolves.toBe(1);
      await expect(store.readEvents("cursor-job")).resolves.toHaveLength(2);
      await createDirectWorkerClient({ store, pollIntervalMs: 10 }).submit({
        jobId: "cursor-job",
        type: "run-command",
        queueKey: "thread-1",
        payload: {},
        onProgress: (event) => {
          if (event.type === "agent-message") {
            delivered.push(event.text);
          }
        },
      });
      expect(delivered).toEqual(["second"]);
      await expect(store.readDeliveryCursor("cursor-job")).resolves.toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists request_user_input events and delivers the Discord answer to the worker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-worker-user-input-"));
    const store = createDirectWorkerStore(path.join(root, "worker"));

    try {
      await store.enqueue({
        jobId: "user-input-job",
        type: "run-codex-prompt",
        queueKey: "thread-1",
        payload: {},
      });
      const userInputId = await store.requestUserInput("user-input-job", {
        threadId: "codex-thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        questions: [{
          id: "mode",
          header: "모드",
          question: "어떤 모드를 사용할까요?",
          isOther: false,
          isSecret: false,
          options: [{ label: "안전", description: "보수적으로 실행합니다." }],
        }],
        autoResolutionMs: null,
      });
      await store.complete("user-input-job", { status: "completed" });
      const requests: unknown[] = [];

      await createDirectWorkerClient({ store, pollIntervalMs: 10 }).submit({
        jobId: "user-input-job",
        type: "run-codex-prompt",
        queueKey: "thread-1",
        payload: {},
        onUserInputRequest: (request) => {
          requests.push(request);
          return { answers: { mode: { answers: ["안전"] } } };
        },
      });

      expect(requests).toEqual([expect.objectContaining({ itemId: "item-1" })]);
      await expect(store.readUserInputResponse("user-input-job", userInputId)).resolves.toEqual({
        answers: { mode: { answers: ["안전"] } },
      });
      await expect(store.readDeliveryCursor("user-input-job")).resolves.toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps processing turn controls while draining an active job", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-worker-drain-control-"));
    const store = createDirectWorkerStore(path.join(root, "worker"));
    const handledControls: string[] = [];
    const worker = await startDirectWorker({
      store,
      pollIntervalMs: 10,
      maxConcurrency: 1,
      controlCodexTurn: async (control) => {
        handledControls.push(`${control.action}:${control.content ?? ""}`);
        return { status: "accepted", message: "Steering accepted while draining." };
      },
    });
    const client = createDirectWorkerClient({ store, pollIntervalMs: 10 });

    try {
      const job = client.submit({
        jobId: "draining-job",
        type: "run-command",
        queueKey: "thread-1",
        payload: {
          workspaceRoot: root,
          cwd: root,
          command: "sleep 0.2",
          timeoutMs: 5_000,
          confirmedDangerous: true,
        },
      });

      for (let attempt = 0; attempt < 50; attempt += 1) {
        if ((await store.readState("draining-job"))?.status === "running") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await expect(store.readState("draining-job")).resolves.toMatchObject({ status: "running" });

      const stopping = worker.stop();
      await expect(client.control({
        controlKey: "thread-1",
        action: "steer",
        content: "새 지시",
      })).resolves.toEqual({
        status: "accepted",
        message: "Steering accepted while draining.",
      });
      await Promise.all([job, stopping]);
      expect(handledControls).toEqual(["steer:새 지시"]);
    } finally {
      await worker.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
