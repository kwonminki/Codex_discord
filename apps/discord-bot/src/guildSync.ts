import { createWorkspaceCategoryName, type ChannelMode } from "@codex-discord/core";
import type { ControlApiClient } from "./controlApiClient.js";

export interface DiscordGuildSurface {
  createCategory(input: { name: string }): Promise<{ id: string }>;
  createTextChannel(input: { name: string; parentId: string }): Promise<{ id: string }>;
}

export interface CreateWorkspaceDiscordSurfaceInput {
  guild: DiscordGuildSurface;
  controlApi: Pick<ControlApiClient, "createCategoryMapping" | "createManagedChannel">;
  computerId: string;
  computerDisplayName: string;
  workspaceId: string;
  workspaceDisplayName: string;
  channelName: string;
  channelMode: ChannelMode;
}

export async function createWorkspaceDiscordSurface(input: CreateWorkspaceDiscordSurfaceInput) {
  const category = await input.guild.createCategory({
    name: createWorkspaceCategoryName(input.computerDisplayName, input.workspaceDisplayName),
  });

  await input.controlApi.createCategoryMapping({
    id: `category:${category.id}`,
    discordCategoryId: category.id,
    computerId: input.computerId,
    workspaceId: input.workspaceId,
  });

  const channel = await input.guild.createTextChannel({
    name: input.channelName,
    parentId: category.id,
  });

  await input.controlApi.createManagedChannel({
    id: `channel:${channel.id}`,
    discordChannelId: channel.id,
    computerId: input.computerId,
    workspaceId: input.workspaceId,
    channelMode: input.channelMode,
  });

  return {
    categoryId: category.id,
    channelId: channel.id,
  };
}
