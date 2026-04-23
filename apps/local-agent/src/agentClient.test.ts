import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { connectAgent, createAgentHelloMessage, handleAgentJob } from "./agentClient.js";

let cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()));
  cleanup = [];
});

describe("agent client", () => {
  it("creates a hello message for registration", () => {
    expect(
      createAgentHelloMessage({
        computerId: "local-dev",
        displayName: "Local Dev",
        hostname: "local-dev.local",
        allowedRoleIds: ["role-operator"],
        capabilities: ["shell", "codex-import"],
        workspaces: [
          {
            id: "local-dev:/Users/me/project",
            absolutePath: "/Users/me/project",
            displayName: "project",
          },
        ],
      }),
    ).toEqual({
      type: "agent-hello",
      computerId: "local-dev",
      displayName: "Local Dev",
      hostname: "local-dev.local",
      allowedRoleIds: ["role-operator"],
      capabilities: ["shell", "codex-import"],
      workspaces: [
        {
          id: "local-dev:/Users/me/project",
          absolutePath: "/Users/me/project",
          displayName: "project",
        },
      ],
    });
  });

  it("rejects unknown jobs", async () => {
    await expect(
      handleAgentJob({
        jobId: "job-1",
        type: "unknown",
        payload: {},
      }),
    ).rejects.toThrow("Unsupported agent job type");
  });

  it("sends a result envelope for a successful websocket job", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-agent-"));
    const server = new WebSocketServer({ port: 0 });
    cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
    cleanup.push(() => fs.rm(workspaceRoot, { recursive: true, force: true }));

    const serverReady = once(server, "listening");
    await serverReady;
    const address = server.address();
    if (typeof address === "string" || !address) {
      throw new Error("Expected server to listen on a TCP port");
    }

    const socket = connectAgent(`ws://127.0.0.1:${address.port}/agents`, {
      computerId: "computer-1",
      displayName: "Computer 1",
      hostname: "computer-1.local",
      allowedRoleIds: ["role-operator"],
      capabilities: ["shell", "codex-import"],
      workspaces: [
        {
          id: "computer-1:/repo",
          absolutePath: "/repo",
          displayName: "repo",
        },
      ],
    });
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }

          socket.once("close", () => resolve());
          socket.close();
        }),
    );

    const [connection] = await once(server, "connection");
    const serverSocket = connection as WebSocket;

    const [helloMessage] = await once(serverSocket, "message");
    expect(JSON.parse(helloMessage.toString())).toEqual({
      type: "agent-hello",
      computerId: "computer-1",
      displayName: "Computer 1",
      hostname: "computer-1.local",
      allowedRoleIds: ["role-operator"],
      capabilities: ["shell", "codex-import"],
      workspaces: [
        {
          id: "computer-1:/repo",
          absolutePath: "/repo",
          displayName: "repo",
        },
      ],
    });

    const resultMessage = once(serverSocket, "message");
    serverSocket.send(
      JSON.stringify({
        jobId: "job-1",
        type: "run-command",
        payload: {
          workspaceRoot,
          cwd: workspaceRoot,
          command: "printf hello",
          timeoutMs: 5_000,
          confirmedDangerous: false,
        },
      }),
    );

    const [rawResult] = await resultMessage;
    expect(JSON.parse(rawResult.toString())).toEqual({
      type: "agent-job-result",
      jobId: "job-1",
      result: {
        status: "completed",
        stdout: "hello",
        stderr: "",
        exitCode: 0,
      },
    });

    socket.close();
  });

  it("sends an error envelope for an unsupported websocket job", async () => {
    const server = new WebSocketServer({ port: 0 });
    cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

    await once(server, "listening");
    const address = server.address();
    if (typeof address === "string" || !address) {
      throw new Error("Expected server to listen on a TCP port");
    }

    const socket = connectAgent(`ws://127.0.0.1:${address.port}/agents`, {
      computerId: "computer-1",
      displayName: "Computer 1",
      hostname: "computer-1.local",
      allowedRoleIds: ["role-operator"],
      capabilities: ["shell", "codex-import"],
      workspaces: [],
    });
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }

          socket.once("close", () => resolve());
          socket.close();
        }),
    );

    const [connection] = await once(server, "connection");
    const serverSocket = connection as WebSocket;

    await once(serverSocket, "message");

    const resultMessage = once(serverSocket, "message");
    serverSocket.send(JSON.stringify({ jobId: "job-2", type: "unknown", payload: {} }));

    const [rawResult] = await resultMessage;
    expect(JSON.parse(rawResult.toString())).toEqual({
      type: "agent-job-result",
      jobId: "job-2",
      error: {
        message: "Unsupported agent job type",
      },
    });

    socket.close();
  });
});
