import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDirectControlClient } from "./directControlClient.js";
import { createDirectSyncStateStore } from "./directState.js";

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

  it("resolves synced Codex session channels from direct state", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "direct-control-state-"));

    try {
      const stateStore = createDirectSyncStateStore(path.join(workspaceRoot, "state.json"));
      await stateStore.write({
        version: 1,
        workspaces: [
          {
            workspaceRoot,
            workspaceDisplayName: "repo",
            discordCategoryId: "category-1",
            computerId: "local-dev",
            workspaceId: `local-dev:${workspaceRoot}`,
          },
        ],
        sessionChannels: [
          {
            codexSessionId: "session-1",
            threadName: "Build bridge",
            updatedAt: "2026-04-23T00:00:00.000Z",
            cwd: workspaceRoot,
            workspaceRoot,
            workspaceDisplayName: "repo",
            discordCategoryId: "category-1",
            discordChannelId: "session-channel-1",
            channelName: "build-bridge",
            computerId: "local-dev",
            workspaceId: `local-dev:${workspaceRoot}`,
          },
        ],
      });
      const client = createDirectControlClient(
        {
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
            channelId: "admin-channel",
            channelMode: "shell-admin",
            timeoutMs: 5_000,
            codexHome: path.join(workspaceRoot, ".codex"),
          },
        },
        { stateStore },
      );

      await expect(client.getChannelContext("session-channel-1")).resolves.toMatchObject({
        channelMode: "session-linked",
        codexSessionId: "session-1",
        workspaceRoot,
        cwd: workspaceRoot,
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
