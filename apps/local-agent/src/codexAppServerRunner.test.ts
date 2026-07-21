import { createServer } from "node:http";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
  interruptActiveCodexAppServerTurn,
  runCodexAppServerPrompt,
  steerActiveCodexAppServerTurn,
} from "./codexAppServerRunner.js";

const socketPaths: string[] = [];

afterEach(async () => {
  await Promise.all(socketPaths.splice(0).map((socketPath) => unlink(socketPath).catch(() => undefined)));
});

describe("runCodexAppServerPrompt", () => {
  it("steers and interrupts an active turn through its control key", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "codex-app-server-control-"));
    const socketPath = path.join("/tmp", `codex-app-server-control-${process.pid}-${Date.now()}.sock`);
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
            socket.send(JSON.stringify({ id: message.id, result: {} }));
            return;
          }

          if (message.method === "thread/start") {
            socket.send(JSON.stringify({ id: message.id, result: { thread: { id: "control-thread-1" } } }));
            return;
          }

          if (message.method === "turn/start") {
            socket.send(JSON.stringify({
              id: message.id,
              result: { turn: { id: "control-turn-1", status: "inProgress", items: [] } },
            }));
            return;
          }

          if (message.method === "turn/steer") {
            socket.send(JSON.stringify({ id: message.id, result: { turnId: "control-turn-1" } }));
            return;
          }

          if (message.method === "turn/interrupt") {
            socket.send(JSON.stringify({ id: message.id, result: {} }));
            socket.send(JSON.stringify({
              method: "turn/completed",
              params: {
                threadId: "control-thread-1",
                turn: { id: "control-turn-1", status: "interrupted", error: { message: "Interrupted" } },
              },
            }));
          }
        });
      });

      const runPromise = runCodexAppServerPrompt({
        workspaceRoot,
        cwd: workspaceRoot,
        prompt: "긴 작업을 시작해줘",
        timeoutMs: 5_000,
        sessionId: null,
        controlKey: "discord-channel-1",
        appServerSocketPath: socketPath,
      });

      let steerResult = await steerActiveCodexAppServerTurn("discord-channel-1", "구현 방향을 바꿔줘");
      for (let attempt = 0; attempt < 20 && steerResult.status === "no-active-turn"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        steerResult = await steerActiveCodexAppServerTurn("discord-channel-1", "구현 방향을 바꿔줘");
      }

      expect(steerResult).toMatchObject({
        status: "accepted",
        threadId: "control-thread-1",
        turnId: "control-turn-1",
      });
      expect(await interruptActiveCodexAppServerTurn("discord-channel-1")).toMatchObject({
        status: "accepted",
        threadId: "control-thread-1",
        turnId: "control-turn-1",
      });
      await expect(runPromise).resolves.toMatchObject({ status: "failed", finalMessage: "Interrupted" });
      await expect(interruptActiveCodexAppServerTurn("discord-channel-1")).resolves.toMatchObject({
        status: "no-active-turn",
      });
      expect(received).toEqual(expect.arrayContaining([
        expect.objectContaining({
          method: "turn/steer",
          params: {
            threadId: "control-thread-1",
            expectedTurnId: "control-turn-1",
            input: [{ type: "text", text: "구현 방향을 바꿔줘", text_elements: [] }],
          },
        }),
        expect.objectContaining({
          method: "turn/interrupt",
          params: { threadId: "control-thread-1", turnId: "control-turn-1" },
        }),
      ]));
    } finally {
      wsServer.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

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
                method: "item/started",
                params: {
                  threadId: "thread-1",
                  turnId: "turn-1",
                  item: {
                    type: "commandExecution",
                    id: "command-1",
                    command: "pnpm test",
                    cwd: workspaceRoot,
                  },
                },
              }),
            );
            socket.send(
              JSON.stringify({
                method: "item/commandExecution/outputDelta",
                params: {
                  threadId: "thread-1",
                  turnId: "turn-1",
                  itemId: "command-1",
                  delta: "330 tests passed\n",
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
                    type: "commandExecution",
                    id: "command-1",
                    command: "pnpm test",
                    cwd: workspaceRoot,
                    exitCode: 0,
                    durationMs: 850,
                  },
                },
              }),
            );
            socket.send(
              JSON.stringify({
                method: "item/reasoning/summaryTextDelta",
                params: {
                  threadId: "thread-1",
                  turnId: "turn-1",
                  itemId: "reasoning-1",
                  summaryIndex: 0,
                  delta: "샘플 경계를 다시 확인했습니다.",
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
                    type: "reasoning",
                    id: "reasoning-1",
                    summary: [],
                    content: ["외부로 보내면 안 되는 raw reasoning"],
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
          {
            type: "operation-progress",
            label: "명령 실행 중",
            detail: `명령: pnpm test · 위치: ${workspaceRoot}`,
            eventType: "item/started",
          },
          {
            type: "operation-progress",
            label: "명령 실행 완료",
            detail: `명령: pnpm test · 위치: ${workspaceRoot} · 종료 코드: 0 · 소요: 850ms · 출력: 330 tests passed`,
            eventType: "item/completed",
          },
          {
            type: "operation-progress",
            label: "생각 정리",
            detail: "샘플 경계를 다시 확인했습니다.",
            eventType: "item/completed",
          },
          { type: "agent-message", text: "완료했습니다." },
        ]),
      );
      expect(JSON.stringify(events)).not.toContain("외부로 보내면 안 되는 raw reasoning");
      expect(received).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "thread/start",
            params: expect.objectContaining({
              approvalPolicy: "never",
              sandbox: "danger-full-access",
            }),
          }),
          expect.objectContaining({
            method: "turn/start",
            params: expect.objectContaining({
              approvalPolicy: "never",
              sandboxPolicy: { type: "dangerFullAccess" },
            }),
          }),
        ]),
      );
    } finally {
      wsServer.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("forks an existing app-server thread before starting a turn", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "codex-app-server-runner-"));
    const socketPath = path.join("/tmp", `codex-app-server-runner-fork-${process.pid}-${Date.now()}.sock`);
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

          if (message.method === "thread/fork") {
            socket.send(
              JSON.stringify({
                id: message.id,
                result: {
                  newThread: {
                    id: "fork-thread-1",
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
                    id: "fork-turn-1",
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
                method: "item/completed",
                params: {
                  threadId: "fork-thread-1",
                  turnId: "fork-turn-1",
                  item: {
                    type: "agentMessage",
                    id: "fork-message-1",
                    text: "분기 세션이 준비되었습니다.",
                    phase: "final_answer",
                  },
                },
              }),
            );
            socket.send(
              JSON.stringify({
                method: "turn/completed",
                params: {
                  threadId: "fork-thread-1",
                  turn: {
                    id: "fork-turn-1",
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
        prompt: "fork 준비",
        timeoutMs: 5_000,
        sessionId: "source-thread-1",
        forkSession: true,
        appServerSocketPath: socketPath,
        onProgress: (event) => {
          events.push(event);
        },
      });

      expect(result).toMatchObject({
        status: "completed",
        finalMessage: "분기 세션이 준비되었습니다.",
        sessionId: "fork-thread-1",
        exitCode: 0,
      });
      expect(events).toEqual(
        expect.arrayContaining([
          { type: "thread-started", sessionId: "fork-thread-1" },
          { type: "agent-message", text: "분기 세션이 준비되었습니다." },
        ]),
      );
      expect(received).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "thread/fork",
            params: expect.objectContaining({
              threadId: "source-thread-1",
              approvalPolicy: "never",
              sandbox: "danger-full-access",
            }),
          }),
          expect.objectContaining({
            method: "turn/start",
            params: expect.objectContaining({
              threadId: "fork-thread-1",
            }),
          }),
        ]),
      );
      expect(received.some((entry) => entry.method === "thread/resume")).toBe(false);
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
