import type { DirectSyncStateStore } from "./directState.js";
import { mapWithConcurrency } from "./concurrency.js";

export type SyncedDeleteMode = "all" | "channels" | "session";

const DISCORD_DELETE_CONCURRENCY = 5;

export interface DiscordGuildDeleteSurface {
  deleteChannel(id: string): Promise<void>;
  deleteCategory(id: string): Promise<void>;
}

export interface DeletePreviewResult {
  mode: SyncedDeleteMode;
  sessionId?: string | null;
  channelCount: number;
  categoryCount: number;
  channelNames: string[];
  categoryNames: string[];
  channelOptions: Array<{
    sessionId: string;
    channelName: string;
    workspaceDisplayName: string;
    updatedAt: string;
  }>;
}

export interface DeleteSyncedDiscordSessionsResult {
  mode: SyncedDeleteMode;
  sessionId?: string | null;
  deletedChannels: number;
  deletedCategories: number;
  missingChannels: number;
  missingCategories: number;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

export async function previewSyncedDiscordSessionDelete(input: {
  stateStore: DirectSyncStateStore;
  mode: SyncedDeleteMode;
  sessionId?: string | null;
}): Promise<DeletePreviewResult> {
  const state = await input.stateStore.read();
  const targetChannels =
    input.mode === "session"
      ? state.sessionChannels.filter((channel) => channel.codexSessionId === input.sessionId)
      : state.sessionChannels;
  const categoryNames =
    input.mode === "all"
      ? uniqueValues(state.workspaces.map((workspace) => workspace.workspaceDisplayName))
      : [];

  return {
    mode: input.mode,
    ...(input.mode === "session" ? { sessionId: input.sessionId ?? null } : {}),
    channelCount: targetChannels.length,
    categoryCount: input.mode === "all" ? state.workspaces.length : 0,
    channelNames: targetChannels.map((channel) => channel.channelName),
    categoryNames,
    channelOptions: targetChannels.flatMap((channel) =>
      channel.codexSessionId
        ? [
            {
              sessionId: channel.codexSessionId,
              channelName: channel.channelName,
              workspaceDisplayName: channel.workspaceDisplayName,
              updatedAt: channel.updatedAt,
            },
          ]
        : [],
    ).slice(0, 25),
  };
}

async function ignoreMissingDiscordDelete(operation: () => Promise<void>): Promise<"deleted" | "missing"> {
  try {
    await operation();
    return "deleted";
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    const status = error instanceof Error && "status" in error ? String(error.status) : "";

    if (code === "10003" || status === "404") {
      return "missing";
    }

    throw error;
  }
}

export async function deleteSyncedDiscordSessions(input: {
  guild: DiscordGuildDeleteSurface;
  stateStore: DirectSyncStateStore;
  mode: SyncedDeleteMode;
  sessionId?: string | null;
}): Promise<DeleteSyncedDiscordSessionsResult> {
  const state = await input.stateStore.read();
  const targetChannels =
    input.mode === "session"
      ? state.sessionChannels.filter((channel) => channel.codexSessionId === input.sessionId)
      : state.sessionChannels;
  const result: DeleteSyncedDiscordSessionsResult = {
    mode: input.mode,
    ...(input.mode === "session" ? { sessionId: input.sessionId ?? null } : {}),
    deletedChannels: 0,
    deletedCategories: 0,
    missingChannels: 0,
    missingCategories: 0,
  };

  const channelStatuses = await mapWithConcurrency(
    targetChannels,
    DISCORD_DELETE_CONCURRENCY,
    async (channel) => ignoreMissingDiscordDelete(() => input.guild.deleteChannel(channel.discordChannelId)),
  );

  for (const status of channelStatuses) {
    if (status === "deleted") {
      result.deletedChannels += 1;
    } else {
      result.missingChannels += 1;
    }
  }

  if (input.mode === "all") {
    const categoryStatuses = await mapWithConcurrency(
      state.workspaces,
      DISCORD_DELETE_CONCURRENCY,
      async (workspace) => ignoreMissingDiscordDelete(() => input.guild.deleteCategory(workspace.discordCategoryId)),
    );

    for (const status of categoryStatuses) {
      if (status === "deleted") {
        result.deletedCategories += 1;
      } else {
        result.missingCategories += 1;
      }
    }
  }

  const targetChannelIds = new Set(targetChannels.map((channel) => channel.discordChannelId));
  const targetCategoryIds = new Set(state.workspaces.map((workspace) => workspace.discordCategoryId));
  await input.stateStore.update((latestState) => ({
    ...latestState,
    workspaces: input.mode === "all"
      ? latestState.workspaces.filter(
          (workspace) => !targetCategoryIds.has(workspace.discordCategoryId),
        )
      : latestState.workspaces,
    sessionChannels: latestState.sessionChannels.filter(
      (channel) => !targetChannelIds.has(channel.discordChannelId),
    ),
  }));

  return result;
}
