import { describe, expect, it, vi } from "vitest";
import { createWorkspaceDiscordSurface } from "./guildSync.js";

describe("createWorkspaceDiscordSurface", () => {
  it("creates a Discord category and managed shell channel for a workspace", async () => {
    const guild = {
      createCategory: vi.fn().mockResolvedValue({ id: "discord-category-1" }),
      createTextChannel: vi.fn().mockResolvedValue({ id: "discord-channel-1" }),
    };
    const controlApi = {
      createCategoryMapping: vi.fn().mockResolvedValue({
        id: "category:discord-category-1",
        discordCategoryId: "discord-category-1",
        computerId: "computer-1",
        workspaceId: "workspace-1",
        syncStatus: "created",
      }),
      createManagedChannel: vi.fn().mockResolvedValue({
        id: "channel:discord-channel-1",
        discordChannelId: "discord-channel-1",
        computerId: "computer-1",
        workspaceId: "workspace-1",
        channelMode: "shell-admin",
        cwd: "/repo",
        status: "created",
      }),
    };

    await expect(
      createWorkspaceDiscordSurface({
        guild,
        controlApi,
        computerId: "computer-1",
        computerDisplayName: "macbook-pro-01",
        workspaceId: "workspace-1",
        workspaceDisplayName: "project",
        channelName: "shell",
        channelMode: "shell-admin",
      }),
    ).resolves.toEqual({
      categoryId: "discord-category-1",
      channelId: "discord-channel-1",
    });

    expect(guild.createCategory).toHaveBeenCalledWith({
      name: "macbook-pro-01 / project",
    });
    expect(guild.createTextChannel).toHaveBeenCalledWith({
      name: "shell",
      parentId: "discord-category-1",
    });
    expect(controlApi.createCategoryMapping).toHaveBeenCalledWith({
      id: "category:discord-category-1",
      discordCategoryId: "discord-category-1",
      computerId: "computer-1",
      workspaceId: "workspace-1",
    });
    expect(controlApi.createManagedChannel).toHaveBeenCalledWith({
      id: "channel:discord-channel-1",
      discordChannelId: "discord-channel-1",
      computerId: "computer-1",
      workspaceId: "workspace-1",
      channelMode: "shell-admin",
    });
  });
});
