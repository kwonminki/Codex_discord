import { createServer } from "node:http";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { runCodexAppServerPrompt } from "./codexAppServerRunner.js";

const socketPaths: string[] = [];

afterEach(async () => {
  await Promise.all(socketPaths.splice(0).map((socketPath) => unlink(socketPath).catch(() => undefined)));
});

describe("runCodexAppServerPrompt", () => {
  it("runs a prompt through the Codex app-server protocol", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "codex-app-server-runner-"));
    const socketPath = path.join("/tmp", `codex-app-server-runner-${process.pid}-${Date.now()}.sock`);
    socketPaths.push(socketPath);
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer, perMessageDeflate: false });
    const received: Array<{ method: string; params: unknown }> = [];

    try {
      await new Promise<void>((resolve) => httpServer.listen(socketPath, resolve));

      wsServer.on("connection", (socket) => {
        socket.on("message", (raw) => {
          const message = JSON.parse(raw.toString()) as { id?: number; method?: string; params?: unknown };

          if (!message.method) {
            return;
          }

          received.push({ method: message.method, params: message.params });

          if (message.method === "initialize") {
            socket.send(
              JSON.stringify({
                id: message.id,
                result: {
                  userAgent: "Codex Desktop/0.0.0 test",
                  codexHome: path.join(workspaceRoot, ".codex"),
                  platformFamily: "unix",
                  platformOs: "macos",
                },
              }),
            );
            return;
          }

          if (message.method === "thread/start") {
            socket.send(
              JSON.stringify({
                id: message.id,
                result: {
                  thread: {
                    id: "thread-1",
                  },
                },
              }),
            );
            socket.send(
              JSON.stringify({
                method: "thread/started",
                params: {
                  thread: {
                    id: "thread-1",
                  },
                },
              }),
            );
            return;
          }

          if (message.method === "turn/start") {
            socket.send(
              JSON.stringify({
                id: message.id,
                result: {
                  turn: {
                    id: "turn-1",
                    status: "inProgress",
                    items: [],
                    itemsView: "notLoaded",
                    error: null,
                  },
                },
              }),
            );
            socket.send(
              JSON.stringify({
                method: "item/agentMessage/delta",
                params: {
                  threadId: "thread-1",
                  turnId: "turn-1",
                  itemId: "item-1",
                  delta: "완료",
                },
              }),
            );
            socket.send(
              JSON.stringify({
                method: "item/completed",
                params: {
                  threadId: "thread-1",
                  turnId: "turn-1",
                  item: {
                    type: "agentMessage",
                    id: "item-1",
                    text: "완료했습니다.",
                    phase: "final_answer",
                  },
                },
              }),
            );
            socket.send(
              JSON.stringify({
                method: "turn/completed",
                params: {
                  threadId: "thread-1",
                  turn: {
                    id: "turn-1",
                    status: "completed",
                    error: null,
                  },
                },
              }),
            );
          }
        });
      });

      const events: unknown[] = [];
      const result = await runCodexAppServerPrompt({
        workspaceRoot,
        cwd: workspaceRoot,
        prompt: "테스트",
        timeoutMs: 5_000,
        appServerSocketPath: socketPath,
        onProgress: (event) => {
          events.push(event);
        },
      });

      expect(result).toMatchObject({
        status: "completed",
        finalMessage: "완료했습니다.",
        sessionId: "thread-1",
        exitCode: 0,
      });
      expect(events).toEqual(
        expect.arrayContaining([
          { type: "thread-started", sessionId: "thread-1" },
          { type: "agent-message", text: "완료했습니다." },
        ]),
      );
      expect(received).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "thread/start" }),
          expect.objectContaining({ method: "turn/start" }),
        ]),
      );
    } finally {
      wsServer.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("answers app-server command approval requests", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "codex-app-server-runner-"));
    const socketPath = path.join("/tmp", `codex-app-server-runner-approval-${process.pid}-${Date.now()}.sock`);
    socketPaths.push(socketPath);
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer, perMessageDeflate: false });
    let approvalResponse: unknown = null;

    try {
      await new Promise<void>((resolve) => httpServer.listen(socketPath, resolve));

      wsServer.on("connection", (socket) => {
        socket.on("message", (raw) => {
          const message = JSON.parse(raw.toString()) as {
            id?: number | string;
            method?: string;
            params?: unknown;
            result?: unknown;
          };

          if (message.id === "approval-1" && !message.method) {
            approvalResponse = message.result;
            socket.send(
              JSON.stringify({
                method: "item/agentMessage/delta",
                params: {
                  threadId: "thread-approval",
                  turnId: "turn-approval",
                  itemId: "item-approval",
                  delta: "승인됨",
                },
              }),
            );
            socket.send(
              JSON.stringify({
                method: "item/completed",
                params: {
                  threadId: "thread-approval",
                  turnId: "turn-approval",
                  item: {
                    type: "agentMessage",
                    id: "item-approval",
                    text: "승인 후 완료했습니다.",
                    phase: "final_answer",
                  },
                },
              }),
            );
            socket.send(
              JSON.stringify({
                method: "turn/completed",
                params: {
                  threadId: "thread-approval",
                  turn: {
                    id: "turn-approval",
                    status: "completed",
                    error: null,
                  },
                },
              }),
            );
            return;
          }

          if (!message.method) {
            return;
          }

          if (message.method === "initialize") {
            socket.send(
              JSON.stringify({
                id: message.id,
                result: {
                  userAgent: "Codex Desktop/0.0.0 test",
                  codexHome: path.join(workspaceRoot, ".codex"),
                  platformFamily: "unix",
                  platformOs: "macos",
                },
              }),
            );
            return;
          }

          if (message.method === "thread/start") {
            socket.send(
              JSON.stringify({
                id: message.id,
                result: {
                  thread: {
                    id: "thread-approval",
                  },
                },
              }),
            );
            return;
          }

          if (message.method === "turn/start") {
            socket.send(
              JSON.stringify({
                id: message.id,
                result: {
                  turn: {
                    id: "turn-approval",
                    status: "inProgress",
                    items: [],
                    itemsView: "notLoaded",
                    error: null,
                  },
                },
              }),
            );
            socket.send(
              JSON.stringify({
                id: "approval-1",
                method: "item/commandExecution/requestApproval",
                params: {
                  threadId: "thread-approval",
                  turnId: "turn-approval",
                  itemId: "command-1",
                  startedAtMs: Date.now(),
                  command: "pnpm test",
                  cwd: workspaceRoot,
                  reason: "테스트 승인이 필요합니다.",
                },
              }),
            );
          }
        });
      });

      const approvalRequests: unknown[] = [];
      const result = await runCodexAppServerPrompt({
        workspaceRoot,
        cwd: workspaceRoot,
        prompt: "테스트",
        timeoutMs: 5_000,
        appServerSocketPath: socketPath,
        onApprovalRequest: (request) => {
          approvalRequests.push(request);
          return { decision: "acceptForSession" };
        },
      });

      expect(approvalRequests).toEqual([
        expect.objectContaining({
          kind: "command",
          command: "pnpm test",
          cwd: workspaceRoot,
          reason: "테스트 승인이 필요합니다.",
        }),
      ]);
      expect(approvalResponse).toEqual({ decision: "acceptForSession" });
      expect(result).toMatchObject({
        status: "completed",
        finalMessage: "승인 후 완료했습니다.",
        sessionId: "thread-approval",
      });
    } finally {
      wsServer.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
