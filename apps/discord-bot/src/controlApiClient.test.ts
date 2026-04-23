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
    ]);
  });
});
