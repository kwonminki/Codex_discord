import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { deleteSyncedDiscordSessions, previewSyncedDiscordSessionDelete } from "./codexSessionDelete.js";
import { createDirectSyncStateStore } from "./directState.js";

function seededState() {
  return {
    version: 1 as const,
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
      {
        codexSessionId: "session-2",
        threadName: "Fix sync",
        updatedAt: "2026-04-23T01:00:00.000Z",
        cwd: "/repo",
        workspaceRoot: "/repo",
        workspaceDisplayName: "repo",
        discordCategoryId: "category-1",
        discordChannelId: "channel-2",
        channelName: "fix-sync",
        computerId: "local-dev",
        workspaceId: "local-dev:/repo",
      },
    ],
  };
}

describe("synced Discord session deletion", () => {
  it("previews synced channels and categories without deleting anything", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "delete-preview-"));

    try {
      const store = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
      await store.write(seededState());

      await expect(previewSyncedDiscordSessionDelete({ stateStore: store, mode: "all" })).resolves.toEqual({
        mode: "all",
        channelCount: 2,
        categoryCount: 1,
        channelNames: ["build-bridge", "fix-sync"],
        categoryNames: ["repo"],
      });
      await expect(store.read()).resolves.toEqual(seededState());
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("deletes channels and categories only when confirmed", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "delete-confirm-"));
    const guild = {
      deleteChannel: vi.fn().mockResolvedValue(undefined),
      deleteCategory: vi.fn().mockResolvedValue(undefined),
    };

    try {
      const store = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
      await store.write(seededState());

      await expect(
        deleteSyncedDiscordSessions({
          guild,
          stateStore: store,
          mode: "all",
        }),
      ).resolves.toEqual({
        mode: "all",
        deletedChannels: 2,
        deletedCategories: 1,
        missingChannels: 0,
        missingCategories: 0,
      });
      expect(guild.deleteChannel).toHaveBeenCalledWith("channel-1");
      expect(guild.deleteChannel).toHaveBeenCalledWith("channel-2");
      expect(guild.deleteCategory).toHaveBeenCalledWith("category-1");
      await expect(store.read()).resolves.toEqual({
        version: 1,
        workspaces: [],
        sessionChannels: [],
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("can delete only channels and keep category mappings", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "delete-channels-"));
    const guild = {
      deleteChannel: vi.fn().mockResolvedValue(undefined),
      deleteCategory: vi.fn().mockResolvedValue(undefined),
    };

    try {
      const store = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
      await store.write(seededState());

      await expect(
        deleteSyncedDiscordSessions({
          guild,
          stateStore: store,
          mode: "channels",
        }),
      ).resolves.toMatchObject({
        deletedChannels: 2,
        deletedCategories: 0,
      });
      expect(guild.deleteCategory).not.toHaveBeenCalled();
      await expect(store.read()).resolves.toMatchObject({
        workspaces: seededState().workspaces,
        sessionChannels: [],
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
