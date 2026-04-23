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

async function waitForCondition(assertion: () => void | Promise<void>) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
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

  it("persists computer presence from the websocket hello message", async () => {
    const heartbeats: unknown[] = [];
    const offlineComputers: string[] = [];
    const app = createServer({
      agentRegistry: createAgentRegistry(),
      computerPresence: {
        upsertHeartbeat: async (input) => {
          heartbeats.push(input);
        },
        markOffline: async (computerId) => {
          offlineComputers.push(computerId);
        },
      },
    });
    const port = await listenOnRandomPort(app);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/agents`);

    try {
      await once(socket, "open");
      socket.send(
        JSON.stringify({
          type: "agent-hello",
          computerId: "computer-1",
          displayName: "macbook-pro-01",
          hostname: "macbook-pro-01.local",
          allowedRoleIds: ["role-operator"],
          capabilities: ["shell", "codex-import"],
          workspaces: [
            {
              id: "computer-1:/Users/me/project",
              absolutePath: "/Users/me/project",
              displayName: "project",
            },
          ],
        }),
      );

      await waitForCondition(() => {
        expect(heartbeats).toEqual([
          {
            id: "computer-1",
            displayName: "macbook-pro-01",
            hostname: "macbook-pro-01.local",
            allowedRoleIds: ["role-operator"],
            capabilities: ["shell", "codex-import"],
            workspaces: [
              {
                id: "computer-1:/Users/me/project",
                absolutePath: "/Users/me/project",
                displayName: "project",
              },
            ],
          },
        ]);
      });

      await closeSocket(socket);
      await waitForCondition(() => {
        expect(offlineComputers).toEqual(["computer-1"]);
      });
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

  it("returns a managed Discord channel context", async () => {
    const app = createServer({
      agentRegistry: createAgentRegistry(),
      channelContexts: {
        findByDiscordChannelId: async () => ({
          channelMode: "shell-admin",
          allowedRoleIds: ["role-operator"],
          computerId: "computer-1",
          computerDisplayName: "macbook-pro-01",
          workspaceDisplayName: "repo",
          workspaceRoot: "/repo",
          cwd: "/repo",
          timeoutMs: 3_000,
        }),
      },
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/discord/channels/discord-channel-1/context",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        channelMode: "shell-admin",
        allowedRoleIds: ["role-operator"],
        computerId: "computer-1",
        computerDisplayName: "macbook-pro-01",
        workspaceDisplayName: "repo",
        workspaceRoot: "/repo",
        cwd: "/repo",
        timeoutMs: 3_000,
      });
    } finally {
      await app.close();
    }
  });

  it("returns 404 for unmanaged Discord channel context lookups", async () => {
    const app = createServer({
      agentRegistry: createAgentRegistry(),
      channelContexts: {
        findByDiscordChannelId: async () => null,
      },
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/discord/channels/unmanaged/context",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: {
          message: "Discord channel is not managed",
        },
      });
    } finally {
      await app.close();
    }
  });

  it("creates a workspace category mapping through the control api", async () => {
    const requests: unknown[] = [];
    const app = createServer({
      agentRegistry: createAgentRegistry(),
      workspaceMappings: {
        createCategoryMapping: async (input) => {
          requests.push(input);
          return {
            id: input.id,
            discordCategoryId: input.discordCategoryId,
            computerId: input.computerId,
            workspaceId: input.workspaceId,
            syncStatus: "created",
          };
        },
        createManagedChannel: async () => {
          throw new Error("unexpected channel create");
        },
      },
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/workspaces/workspace-1/category-mappings",
        payload: {
          id: "category-1",
          discordCategoryId: "discord-category-1",
          computerId: "computer-1",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        id: "category-1",
        discordCategoryId: "discord-category-1",
        computerId: "computer-1",
        workspaceId: "workspace-1",
        syncStatus: "created",
      });
      expect(requests).toEqual([
        {
          id: "category-1",
          discordCategoryId: "discord-category-1",
          computerId: "computer-1",
          workspaceId: "workspace-1",
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it("creates a managed channel through the control api", async () => {
    const requests: unknown[] = [];
    const app = createServer({
      agentRegistry: createAgentRegistry(),
      workspaceMappings: {
        createCategoryMapping: async () => {
          throw new Error("unexpected category create");
        },
        createManagedChannel: async (input) => {
          requests.push(input);
          return {
            id: input.id,
            discordChannelId: input.discordChannelId,
            computerId: input.computerId,
            workspaceId: input.workspaceId,
            channelMode: input.channelMode,
            cwd: "/repo",
            status: "created",
          };
        },
      },
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/workspaces/workspace-1/channels",
        payload: {
          id: "channel-1",
          discordChannelId: "discord-channel-1",
          computerId: "computer-1",
          channelMode: "shell-admin",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        id: "channel-1",
        discordChannelId: "discord-channel-1",
        computerId: "computer-1",
        workspaceId: "workspace-1",
        channelMode: "shell-admin",
        cwd: "/repo",
        status: "created",
      });
      expect(requests).toEqual([
        {
          id: "channel-1",
          discordChannelId: "discord-channel-1",
          computerId: "computer-1",
          workspaceId: "workspace-1",
          channelMode: "shell-admin",
        },
      ]);
    } finally {
      await app.close();
    }
  });
});
