import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createControlApiClient } from "./controlApiClient.js";

let cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()));
  cleanup = [];
});

describe("createControlApiClient", () => {
  it("posts command jobs to the control api and fetches channel context", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const server = createServer((request, response) => {
      if (request.method === "GET") {
        requests.push({ url: request.url ?? "", body: null });
        response.writeHead(200, { "content-type": "application/json" });
        if (request.url === "/inventory") {
          response.end(
            JSON.stringify([
              {
                id: "computer-1",
                displayName: "macbook-pro-01",
                hostname: "macbook-pro-01.local",
                status: "online",
                allowedRoleIds: ["role-operator"],
                capabilities: ["shell", "codex-import"],
                workspaces: [
                  {
                    id: "workspace-1",
                    absolutePath: "/repo",
                    displayName: "repo",
                    status: "valid",
                  },
                ],
              },
            ]),
          );
          return;
        }
        response.end(
          JSON.stringify({
            channelMode: "shell-admin",
            allowedRoleIds: ["role-operator"],
            computerId: "computer-1",
            computerDisplayName: "macbook-pro-01",
            workspaceDisplayName: "repo",
            workspaceRoot: "/repo",
            cwd: "/repo",
            timeoutMs: 3_000,
          }),
        );
        return;
      }

      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          url: request.url ?? "",
          body: JSON.parse(Buffer.concat(chunks).toString()) as unknown,
        });
        response.writeHead(200, { "content-type": "application/json" });
        if (request.method === "PATCH") {
          response.end(JSON.stringify({ cwd: "/repo/src" }));
          return;
        }
        if (request.url?.includes("/audit-events")) {
          response.end(
            JSON.stringify({
              id: "audit-1",
              channelId: "channel-1",
              userId: "discord-user-1",
              targetComputerId: "computer-1",
              targetWorkspaceId: "workspace-1",
              cwd: "/repo",
              rawCommand: "ls",
              tier: "safe-read",
              resultStatus: "completed",
            }),
          );
          return;
        }
        if (request.url?.includes("/session-links")) {
          response.end(
            JSON.stringify({
              id: "session-link-1",
              channelId: "channel-1",
              codexSessionId: "codex-session-1",
              origin: "imported_native",
              threadNameSnapshot: "Codex Discord planning",
              availabilityStatus: "available",
            }),
          );
          return;
        }
        if (request.url?.includes("/codex-sessions")) {
          response.end(
            JSON.stringify({
              jobId: "job-sessions-1",
              result: [
                {
                  id: "codex-session-1",
                  threadName: "Codex Discord planning",
                  updatedAt: "2026-04-22T01:15:24.714Z",
                  cwdHint: "/repo",
                },
              ],
            }),
          );
          return;
        }
        if (request.url?.includes("/category-mappings")) {
          response.end(
            JSON.stringify({
              id: "category:discord-category-1",
              discordCategoryId: "discord-category-1",
              computerId: "computer-1",
              workspaceId: "workspace-1",
              syncStatus: "created",
            }),
          );
          return;
        }
        if (request.url?.includes("/channels")) {
          response.end(
            JSON.stringify({
              id: "channel:discord-channel-1",
              discordChannelId: "discord-channel-1",
              computerId: "computer-1",
              workspaceId: "workspace-1",
              channelMode: "shell-admin",
              cwd: "/repo",
              status: "created",
            }),
          );
          return;
        }
        response.end(JSON.stringify({ jobId: "job-1", result: { status: "completed" } }));
      });
    });

    server.listen(0, "127.0.0.1");
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const client = createControlApiClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    await expect(
      client.submitCommandJob({
        computerId: "computer-1",
        payload: {
          workspaceRoot: "/repo",
          cwd: "/repo",
          command: "ls",
          timeoutMs: 3_000,
          confirmedDangerous: false,
        },
      }),
    ).resolves.toEqual({ jobId: "job-1", result: { status: "completed" } });
    await expect(client.getChannelContext("discord-channel-1")).resolves.toEqual({
      channelMode: "shell-admin",
      allowedRoleIds: ["role-operator"],
      computerId: "computer-1",
      computerDisplayName: "macbook-pro-01",
      workspaceDisplayName: "repo",
      workspaceRoot: "/repo",
      cwd: "/repo",
      timeoutMs: 3_000,
    });
    await expect(client.listInventory()).resolves.toEqual([
      {
        id: "computer-1",
        displayName: "macbook-pro-01",
        hostname: "macbook-pro-01.local",
        status: "online",
        allowedRoleIds: ["role-operator"],
        capabilities: ["shell", "codex-import"],
        workspaces: [
          {
            id: "workspace-1",
            absolutePath: "/repo",
            displayName: "repo",
            status: "valid",
          },
        ],
      },
    ]);
    await expect(
      client.createCategoryMapping({
        id: "category:discord-category-1",
        discordCategoryId: "discord-category-1",
        computerId: "computer-1",
        workspaceId: "workspace-1",
      }),
    ).resolves.toEqual({
      id: "category:discord-category-1",
      discordCategoryId: "discord-category-1",
      computerId: "computer-1",
      workspaceId: "workspace-1",
      syncStatus: "created",
    });
    await expect(
      client.createManagedChannel({
        id: "channel:discord-channel-1",
        discordChannelId: "discord-channel-1",
        computerId: "computer-1",
        workspaceId: "workspace-1",
        channelMode: "shell-admin",
      }),
    ).resolves.toEqual({
      id: "channel:discord-channel-1",
      discordChannelId: "discord-channel-1",
      computerId: "computer-1",
      workspaceId: "workspace-1",
      channelMode: "shell-admin",
      cwd: "/repo",
      status: "created",
    });
    await expect(
      client.updateChannelCwd({
        discordChannelId: "discord-channel-1",
        cwd: "/repo/src",
      }),
    ).resolves.toEqual({ cwd: "/repo/src" });
    await expect(
      client.recordCommandAudit({
        discordChannelId: "discord-channel-1",
        userId: "discord-user-1",
        cwd: "/repo",
        rawCommand: "ls",
        tier: "safe-read",
        resultStatus: "completed",
      }),
    ).resolves.toEqual({
      id: "audit-1",
      channelId: "channel-1",
      userId: "discord-user-1",
      targetComputerId: "computer-1",
      targetWorkspaceId: "workspace-1",
      cwd: "/repo",
      rawCommand: "ls",
      tier: "safe-read",
      resultStatus: "completed",
    });
    await expect(
      client.linkCodexSession({
        discordChannelId: "discord-channel-1",
        id: "session-link-1",
        codexSessionId: "codex-session-1",
        origin: "imported_native",
        threadNameSnapshot: "Codex Discord planning",
      }),
    ).resolves.toEqual({
      id: "session-link-1",
      channelId: "channel-1",
      codexSessionId: "codex-session-1",
      origin: "imported_native",
      threadNameSnapshot: "Codex Discord planning",
      availabilityStatus: "available",
    });
    await expect(
      client.listCodexSessions({
        computerId: "computer-1",
        codexHome: "/Users/me/.codex",
      }),
    ).resolves.toEqual({
      jobId: "job-sessions-1",
      result: [
        {
          id: "codex-session-1",
          threadName: "Codex Discord planning",
          updatedAt: "2026-04-22T01:15:24.714Z",
          cwdHint: "/repo",
        },
      ],
    });
    expect(requests).toEqual([
      {
        url: "/computers/computer-1/jobs",
        body: {
          type: "run-command",
          payload: {
            workspaceRoot: "/repo",
            cwd: "/repo",
            command: "ls",
            timeoutMs: 3_000,
            confirmedDangerous: false,
          },
        },
      },
      {
        url: "/discord/channels/discord-channel-1/context",
        body: null,
      },
      {
        url: "/inventory",
        body: null,
      },
      {
        url: "/workspaces/workspace-1/category-mappings",
        body: {
          id: "category:discord-category-1",
          discordCategoryId: "discord-category-1",
          computerId: "computer-1",
        },
      },
      {
        url: "/workspaces/workspace-1/channels",
        body: {
          id: "channel:discord-channel-1",
          discordChannelId: "discord-channel-1",
          computerId: "computer-1",
          channelMode: "shell-admin",
        },
      },
      {
        url: "/discord/channels/discord-channel-1/context",
        body: {
          cwd: "/repo/src",
        },
      },
      {
        url: "/discord/channels/discord-channel-1/audit-events",
        body: {
          userId: "discord-user-1",
          cwd: "/repo",
          rawCommand: "ls",
          tier: "safe-read",
          resultStatus: "completed",
        },
      },
      {
        url: "/discord/channels/discord-channel-1/session-links",
        body: {
          id: "session-link-1",
          codexSessionId: "codex-session-1",
          origin: "imported_native",
          threadNameSnapshot: "Codex Discord planning",
        },
      },
      {
        url: "/computers/computer-1/codex-sessions",
        body: {
          codexHome: "/Users/me/.codex",
        },
      },
    ]);
  });

  it("streams Codex prompt progress from the control api", async () => {
    const requests: Array<{ url: string; body: unknown; accept: string | undefined }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          url: request.url ?? "",
          body: JSON.parse(Buffer.concat(chunks).toString()) as unknown,
          accept: request.headers.accept,
        });
        response.writeHead(200, { "content-type": "application/x-ndjson" });
        response.write(
          `${JSON.stringify({
            type: "progress",
            event: {
              type: "agent-message",
              text: "중간 출력입니다.",
            },
          })}\n`,
        );
        response.end(
          `${JSON.stringify({
            type: "result",
            jobId: "job-1",
            result: {
              status: "completed",
              finalMessage: "최종 답변입니다.",
              sessionId: "session-1",
            },
          })}\n`,
        );
      });
    });
    const progressEvents: unknown[] = [];

    server.listen(0, "127.0.0.1");
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const client = createControlApiClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    await expect(
      client.submitCodexPrompt({
        computerId: "computer-1",
        payload: {
          workspaceRoot: "/repo",
          cwd: "/repo",
          prompt: "요약해줘",
          timeoutMs: 3_000,
          sessionId: "session-1",
        },
        onProgress: async (event) => {
          progressEvents.push(event);
        },
      }),
    ).resolves.toEqual({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "최종 답변입니다.",
        sessionId: "session-1",
      },
    });
    expect(progressEvents).toEqual([
      {
        type: "agent-message",
        text: "중간 출력입니다.",
      },
    ]);
    expect(requests).toEqual([
      {
        url: "/computers/computer-1/jobs",
        accept: "application/x-ndjson",
        body: {
          type: "run-codex-prompt",
          streamProgress: true,
          payload: {
            workspaceRoot: "/repo",
            cwd: "/repo",
            prompt: "요약해줘",
            timeoutMs: 3_000,
            sessionId: "session-1",
          },
        },
      },
    ]);
  });
});
