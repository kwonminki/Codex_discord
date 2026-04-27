import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { archiveSyncedCodexSession } from "./codexSessionArchive.js";
import { createDirectSyncStateStore } from "./directState.js";

describe("archiveSyncedCodexSession", () => {
  it("marks a synced Codex session as archived and removes its Discord channel mapping", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-archive-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const guild = {
      deleteChannel: vi.fn().mockResolvedValue(undefined),
    };

    try {
      await stateStore.write({
        version: 1,
        archivedCodexSessionIds: [],
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

      await expect(
        archiveSyncedCodexSession({
          stateStore,
          guild,
          discordChannelId: "channel-1",
        }),
      ).resolves.toEqual({
        codexSessionId: "session-1",
        deletedChannel: true,
        removedChannelMapping: true,
        wasAlreadyArchived: false,
      });

      expect(guild.deleteChannel).toHaveBeenCalledWith("channel-1");
      await expect(stateStore.findSessionChannelByDiscordId("channel-1")).resolves.toBeNull();
      await expect(stateStore.read()).resolves.toMatchObject({
        archivedCodexSessionIds: ["session-1"],
        sessionChannels: [],
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
