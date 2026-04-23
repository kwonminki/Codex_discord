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
    ]);
  });
});
