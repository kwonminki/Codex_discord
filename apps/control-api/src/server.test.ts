import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createAgentRegistry } from "./agentRegistry.js";
import { createServer } from "./server.js";

async function listenOnRandomPort(app: ReturnType<typeof createServer>) {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo | null;

  if (!address) {
    throw new Error("Expected test server to listen on a TCP port");
  }

  return address.port;
}

async function closeSocket(socket: WebSocket) {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  const closed = once(socket, "close");
  socket.close();
  await closed;
}

async function waitForAgentCount(app: ReturnType<typeof createServer>, expectedCount: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await app.inject({ method: "GET", url: "/computers" });
    const agents = response.json() as unknown[];

    if (agents.length === expectedCount) {
      return agents;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Expected ${expectedCount} registered agents`);
}

describe("control api server", () => {
  it("responds to health checks", async () => {
    const app = createServer({ agentRegistry: createAgentRegistry() });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it("lists registered online agents", async () => {
    const registry = createAgentRegistry();
    registry.register({
      computerId: "computer-1",
      displayName: "macbook-pro-01",
      capabilities: ["shell", "codex-import"],
      send: async () => {},
    });

    const app = createServer({ agentRegistry: registry });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/computers",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        {
          computerId: "computer-1",
          displayName: "macbook-pro-01",
          capabilities: ["shell", "codex-import"],
          status: "online",
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it("registers an agent from the websocket hello message", async () => {
    const app = createServer({ agentRegistry: createAgentRegistry() });
    const port = await listenOnRandomPort(app);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/agents`);

    try {
      await once(socket, "open");
      socket.send(
        JSON.stringify({
          type: "agent-hello",
          computerId: "computer-1",
          displayName: "macbook-pro-01",
          capabilities: ["shell", "codex-import"],
        }),
      );

      await expect(waitForAgentCount(app, 1)).resolves.toEqual([
        {
          computerId: "computer-1",
          displayName: "macbook-pro-01",
          capabilities: ["shell", "codex-import"],
          status: "online",
        },
      ]);
    } finally {
      await closeSocket(socket);
      await app.close();
    }
  });

  it("dispatches an HTTP job to a websocket agent and returns its result", async () => {
    const app = createServer({ agentRegistry: createAgentRegistry(), jobTimeoutMs: 1_000 });
    const port = await listenOnRandomPort(app);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/agents`);

    try {
      await once(socket, "open");
      socket.send(
        JSON.stringify({
          type: "agent-hello",
          computerId: "computer-1",
          displayName: "macbook-pro-01",
          capabilities: ["shell"],
        }),
      );
      await waitForAgentCount(app, 1);

      const inboundJob = once(socket, "message");
      const responsePromise = fetch(`http://127.0.0.1:${port}/computers/computer-1/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "run-command",
          payload: {
            workspaceRoot: "/repo",
            cwd: "/repo",
            command: "ls",
            timeoutMs: 3_000,
            confirmedDangerous: false,
          },
        }),
      });

      const [rawJob] = await inboundJob;
      const job = JSON.parse(rawJob.toString()) as { jobId: string; type: string; payload: unknown };
      expect(job).toMatchObject({
        type: "run-command",
        payload: {
          workspaceRoot: "/repo",
          cwd: "/repo",
          command: "ls",
          timeoutMs: 3_000,
          confirmedDangerous: false,
        },
      });

      socket.send(
        JSON.stringify({
          type: "agent-job-result",
          jobId: job.jobId,
          result: {
            status: "completed",
            stdout: "README.md\n",
            stderr: "",
            exitCode: 0,
          },
        }),
      );

      const response = await responsePromise;
      await expect(response.json()).resolves.toEqual({
        jobId: job.jobId,
        result: {
          status: "completed",
          stdout: "README.md\n",
          stderr: "",
          exitCode: 0,
        },
      });
    } finally {
      await closeSocket(socket);
      await app.close();
    }
  });

  it("rejects malformed job requests", async () => {
    const app = createServer({ agentRegistry: createAgentRegistry() });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/computers/computer-1/jobs",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: {
          message: "Unsupported agent job type",
        },
      });
    } finally {
      await app.close();
    }
  });
});
