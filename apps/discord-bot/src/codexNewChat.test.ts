import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createNewCodexChatChannel } from "./codexNewChat.js";
import { createDirectSyncStateStore } from "./directState.js";

describe("createNewCodexChatChannel", () => {
  it("creates a category-less pending Codex chat channel in a dedicated general chat folder by default", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "new-chat-"));
    const generalChatsRoot = path.join(tempRoot, "Codex");
    const expectedChatRoot = path.join(generalChatsRoot, "2026-04-22-new-chat");

    try {
      const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
      const guild = {
        createCategory: vi.fn(),
        createTextChannel: vi.fn().mockResolvedValue({ id: "channel-general" }),
      };
      const controlApi = {
        createCategoryMapping: vi.fn(),
        createManagedChannel: vi.fn().mockResolvedValue({ id: "managed-1" }),
        linkCodexSession: vi.fn(),
      };

      const result = await createNewCodexChatChannel({
        guild,
        controlApi,
        stateStore,
        computerId: "local-dev",
        computerDisplayName: "Local Dev",
        defaultWorkspaceRoot: tempRoot,
        generalChatsRoot,
        now: new Date("2026-04-22T12:00:00.000Z"),
        name: null,
        cwd: null,
        useCategory: false,
        initialPrompt: null,
      });

      expect(result).toMatchObject({
        discordChannelId: "channel-general",
        discordCategoryId: null,
        channelName: "general-codex-chat",
        cwd: expectedChatRoot,
        workspaceRoot: expectedChatRoot,
        pendingSession: true,
      });
      await expect(stat(expectedChatRoot).then((stats) => stats.isDirectory())).resolves.toBe(true);
      expect(guild.createCategory).not.toHaveBeenCalled();
      expect(guild.createTextChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "general-codex-chat",
          parentId: null,
        }),
      );
      expect(controlApi.createManagedChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          discordChannelId: "channel-general",
          channelMode: "session-linked",
        }),
      );
      await expect(stateStore.findSessionChannelByDiscordId("channel-general")).resolves.toMatchObject({
        codexSessionId: null,
        discordCategoryId: null,
        workspaceDisplayName: "General Chat",
        workspaceRoot: expectedChatRoot,
        cwd: expectedChatRoot,
        workspaceId: `local-dev:${expectedChatRoot}`,
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates a pending Codex chat thread when a thread parent channel is configured", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "new-chat-"));
    const generalChatsRoot = path.join(tempRoot, "Codex");

    try {
      const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
      const guild = {
        createCategory: vi.fn(),
        createTextChannel: vi.fn(),
        createThread: vi.fn().mockResolvedValue({ id: "thread-general" }),
      };
      const controlApi = {
        createCategoryMapping: vi.fn(),
        createManagedChannel: vi.fn().mockResolvedValue({ id: "managed-1" }),
        linkCodexSession: vi.fn(),
      };

      const result = await createNewCodexChatChannel({
        guild,
        controlApi,
        stateStore,
        computerId: "local-dev",
        computerDisplayName: "Local Dev",
        defaultWorkspaceRoot: tempRoot,
        generalChatsRoot,
        now: new Date("2026-04-22T12:00:00.000Z"),
        name: "Discord thread",
        cwd: null,
        useCategory: false,
        initialPrompt: null,
        sessionThreadParentChannelId: "admin-channel",
      });

      expect(result).toMatchObject({
        discordChannelId: "thread-general",
        channelName: "discord-thread",
        pendingSession: true,
      });
      expect(guild.createTextChannel).not.toHaveBeenCalled();
      expect(guild.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Discord thread",
          parentChannelId: "admin-channel",
          autoArchiveDuration: 10_080,
        }),
      );
      await expect(stateStore.findSessionChannelByDiscordId("thread-general")).resolves.toMatchObject({
        codexSessionId: null,
        discordParentChannelId: "admin-channel",
        discordDeliveryMode: "thread",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates a workspace category when a cwd is requested", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "new-chat-"));
    const appsRoot = path.join(tempRoot, "apps");

    try {
      const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
      const guild = {
        createCategory: vi.fn().mockResolvedValue({ id: "category-apps" }),
        createTextChannel: vi.fn().mockResolvedValue({ id: "channel-apps" }),
      };
      const controlApi = {
        createCategoryMapping: vi.fn().mockResolvedValue({ id: "category-mapping-1" }),
        createManagedChannel: vi.fn().mockResolvedValue({ id: "managed-1" }),
        linkCodexSession: vi.fn(),
      };

      const result = await createNewCodexChatChannel({
        guild,
        controlApi,
        stateStore,
        computerId: "local-dev",
        computerDisplayName: "Local Dev",
        defaultWorkspaceRoot: tempRoot,
        name: "Bot UI",
        cwd: appsRoot,
        useCategory: true,
        initialPrompt: "UI 개선 시작",
      });

      expect(result).toMatchObject({
        discordChannelId: "channel-apps",
        discordCategoryId: "category-apps",
        channelName: "bot-ui",
        cwd: appsRoot,
        initialPrompt: "UI 개선 시작",
      });
      expect(guild.createCategory).toHaveBeenCalledWith({ name: "apps" });
      expect(guild.createTextChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "bot-ui",
          parentId: "category-apps",
        }),
      );
      await expect(stateStore.findSessionChannelByDiscordId("channel-apps")).resolves.toMatchObject({
        codexSessionId: null,
        discordCategoryId: "category-apps",
        workspaceRoot: appsRoot,
        workspaceDisplayName: "apps",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("resolves current-folder chat requests from the invoking channel cwd", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "new-chat-"));
    const currentCwd = path.join(tempRoot, "apps", "discord-bot");

    try {
      const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
      const guild = {
        createCategory: vi.fn().mockResolvedValue({ id: "category-discord-bot" }),
        createTextChannel: vi.fn().mockResolvedValue({ id: "channel-current" }),
      };
      const controlApi = {
        createCategoryMapping: vi.fn().mockResolvedValue({ id: "category-mapping-1" }),
        createManagedChannel: vi.fn().mockResolvedValue({ id: "managed-1" }),
        linkCodexSession: vi.fn(),
      };

      const result = await createNewCodexChatChannel({
        guild,
        controlApi,
        stateStore,
        computerId: "local-dev",
        computerDisplayName: "Local Dev",
        defaultWorkspaceRoot: tempRoot,
        currentCwd,
        name: "현재 작업",
        cwd: ".",
        useCategory: true,
        initialPrompt: null,
      });

      expect(result).toMatchObject({
        discordChannelId: "channel-current",
        discordCategoryId: "category-discord-bot",
        channelName: "현재-작업",
        cwd: currentCwd,
        workspaceRoot: currentCwd,
        workspaceDisplayName: "discord-bot",
      });
      expect(guild.createCategory).toHaveBeenCalledWith({ name: "discord-bot" });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("recreates a missing workspace category before creating a located chat", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "new-chat-"));

    try {
      const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
      await stateStore.write({
        version: 1,
        archivedCodexSessionIds: [],
        workspaces: [
          {
            workspaceRoot: tempRoot,
            workspaceDisplayName: path.basename(tempRoot),
            discordCategoryId: "deleted-category",
            computerId: "local-dev",
            workspaceId: `local-dev:${tempRoot}`,
          },
        ],
        sessionChannels: [],
      });
      const guild = {
        createCategory: vi.fn().mockResolvedValue({ id: "category-recreated" }),
        createTextChannel: vi
          .fn()
          .mockRejectedValueOnce(new Error("Invalid Form Body parent_id[CHANNEL_PARENT_INVALID]: Category does not exist"))
          .mockResolvedValueOnce({ id: "channel-recovered" }),
      };
      const controlApi = {
        createCategoryMapping: vi.fn().mockResolvedValue({ id: "category-mapping-1" }),
        createManagedChannel: vi.fn().mockResolvedValue({ id: "managed-1" }),
        linkCodexSession: vi.fn(),
      };

      await createNewCodexChatChannel({
        guild,
        controlApi,
        stateStore,
        computerId: "local-dev",
        computerDisplayName: "Local Dev",
        defaultWorkspaceRoot: tempRoot,
        name: "Recovered",
        cwd: tempRoot,
        useCategory: true,
        initialPrompt: null,
      });

      expect(guild.createCategory).toHaveBeenCalledWith({ name: path.basename(tempRoot) });
      expect(guild.createTextChannel).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parentId: "category-recreated",
        }),
      );
      await expect(stateStore.read()).resolves.toMatchObject({
        workspaces: [
          {
            discordCategoryId: "category-recreated",
          },
        ],
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
