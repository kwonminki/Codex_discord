import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDirectControlClient } from "./directControlClient.js";

describe("createDirectControlClient", () => {
  it("runs commands directly against the configured local workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "direct-control-"));

    try {
      await writeFile(path.join(workspaceRoot, "README.md"), "hello direct\n", "utf8");
      const client = createDirectControlClient({
        mode: "direct",
        discord: {
          token: "discord-token",
          guildId: "guild-1",
          allowedRoleIds: ["role-operator"],
        },
        direct: {
          computerId: "local-dev",
          computerDisplayName: "Local Dev",
          workspaceId: `local-dev:${workspaceRoot}`,
          workspaceRoot,
          workspaceDisplayName: "repo",
          channelId: "channel-1",
          channelMode: "shell-admin",
          timeoutMs: 5_000,
          codexHome: path.join(workspaceRoot, ".codex"),
        },
      });

      await expect(client.getChannelContext("channel-1")).resolves.toMatchObject({
        computerId: "local-dev",
        workspaceRoot,
        cwd: workspaceRoot,
      });
      await expect(
        client.submitCommandJob({
          computerId: "local-dev",
          payload: {
            workspaceRoot,
            cwd: workspaceRoot,
            command: "cat README.md",
            timeoutMs: 5_000,
            confirmedDangerous: false,
          },
        }),
      ).resolves.toMatchObject({
        result: {
          status: "completed",
          stdout: "hello direct\n",
        },
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
