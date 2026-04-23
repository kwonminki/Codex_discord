import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDirectSyncStateStore } from "./directState.js";

describe("direct sync state store", () => {
  it("persists synced session channels and updates per-channel cwd", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "direct-state-"));

    try {
      const store = createDirectSyncStateStore(path.join(tempRoot, "state.json"));

      await store.write({
        version: 1,
        workspaces: [
          {
            workspaceRoot: "/repo",
            workspaceDisplayName: "repo",
            discordCategoryId: "category-1",
            computerId: "local-dev",
            workspaceId: "local-dev:/repo",
          },
        ],
        sessionChannels: [
          {
            codexSessionId: "session-1",
            threadName: "Build bridge",
            updatedAt: "2026-04-23T00:00:00.000Z",
            cwd: "/repo",
            workspaceRoot: "/repo",
            workspaceDisplayName: "repo",
            discordCategoryId: "category-1",
            discordChannelId: "channel-1",
            channelName: "build-bridge",
            computerId: "local-dev",
            workspaceId: "local-dev:/repo",
          },
        ],
      });

      await expect(store.read()).resolves.toMatchObject({
        version: 1,
        sessionChannels: [
          {
            codexSessionId: "session-1",
            discordChannelId: "channel-1",
            cwd: "/repo",
          },
        ],
      });

      await store.updateChannelCwd("channel-1", "/repo/apps");

      await expect(store.findSessionChannelByDiscordId("channel-1")).resolves.toMatchObject({
        codexSessionId: "session-1",
        cwd: "/repo/apps",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
