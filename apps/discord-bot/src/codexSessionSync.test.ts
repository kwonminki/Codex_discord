import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { syncCodexSessionsToDiscord } from "./codexSessionSync.js";
import { createDirectSyncStateStore } from "./directState.js";

describe("syncCodexSessionsToDiscord", () => {
  it("creates one Discord category per Codex workspace and one channel per Codex session", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-sync-"));
    const store = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const guild = {
      createCategory: vi
        .fn()
        .mockResolvedValueOnce({ id: "category-repo" })
        .mockResolvedValueOnce({ id: "category-other" }),
      createTextChannel: vi
        .fn()
        .mockResolvedValueOnce({ id: "channel-a" })
        .mockResolvedValueOnce({ id: "channel-b" })
        .mockResolvedValueOnce({ id: "channel-c" }),
    };
    const controlApi = {
      createCategoryMapping: vi.fn().mockResolvedValue({}),
      createManagedChannel: vi.fn().mockResolvedValue({}),
      linkCodexSession: vi.fn().mockResolvedValue({}),
    };

    try {
      await expect(
        syncCodexSessionsToDiscord({
          guild,
          controlApi,
          stateStore: store,
          computerId: "local-dev",
          computerDisplayName: "Local Dev",
          defaultWorkspaceRoot: "/fallback",
          sessions: [
            {
              id: "session-a",
              threadName: "Codex Discord sync design",
              updatedAt: "2026-04-23T10:00:00.000Z",
              cwdHint: "/repo",
            },
            {
              id: "session-b",
              threadName: "Direct mode 구현",
              updatedAt: "2026-04-23T09:00:00.000Z",
              cwdHint: "/repo",
            },
            {
              id: "session-c",
              threadName: "Other project task",
              updatedAt: "2026-04-23T08:00:00.000Z",
              cwdHint: "/other",
            },
          ],
          limit: 25,
        }),
      ).resolves.toEqual({
        createdCategories: 2,
        existingCategories: 0,
        createdChannels: 3,
        existingChannels: 0,
        skippedSessions: 0,
      });

      expect(guild.createCategory).toHaveBeenCalledWith({ name: "repo" });
      expect(guild.createCategory).toHaveBeenCalledWith({ name: "other" });
      expect(guild.createTextChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "codex-discord-sync-design",
          parentId: "category-repo",
          topic: expect.stringContaining("session-a"),
        }),
      );
      expect(controlApi.linkCodexSession).toHaveBeenCalledWith(
        expect.objectContaining({
          discordChannelId: "channel-a",
          codexSessionId: "session-a",
          origin: "imported_native",
        }),
      );
      await expect(store.findSessionChannelByDiscordId("channel-b")).resolves.toMatchObject({
        codexSessionId: "session-b",
        workspaceRoot: "/repo",
        channelName: "direct-mode-구현",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
