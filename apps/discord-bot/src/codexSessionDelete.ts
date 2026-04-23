import { createEmptyDirectSyncState, type DirectSyncStateStore } from "./directState.js";

export type SyncedDeleteMode = "all" | "channels";

export interface DiscordGuildDeleteSurface {
  deleteChannel(id: string): Promise<void>;
  deleteCategory(id: string): Promise<void>;
}

export interface DeletePreviewResult {
  mode: SyncedDeleteMode;
  channelCount: number;
  categoryCount: number;
  channelNames: string[];
  categoryNames: string[];
}

export interface DeleteSyncedDiscordSessionsResult {
  mode: SyncedDeleteMode;
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
}): Promise<DeletePreviewResult> {
  const state = await input.stateStore.read();
  const categoryNames =
    input.mode === "all"
      ? uniqueValues(state.workspaces.map((workspace) => workspace.workspaceDisplayName))
      : [];

  return {
    mode: input.mode,
    channelCount: state.sessionChannels.length,
    categoryCount: input.mode === "all" ? state.workspaces.length : 0,
    channelNames: state.sessionChannels.map((channel) => channel.channelName),
    categoryNames,
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
}): Promise<DeleteSyncedDiscordSessionsResult> {
  const state = await input.stateStore.read();
  const result: DeleteSyncedDiscordSessionsResult = {
    mode: input.mode,
    deletedChannels: 0,
    deletedCategories: 0,
    missingChannels: 0,
    missingCategories: 0,
  };

  for (const channel of state.sessionChannels) {
    const status = await ignoreMissingDiscordDelete(() => input.guild.deleteChannel(channel.discordChannelId));

    if (status === "deleted") {
      result.deletedChannels += 1;
    } else {
      result.missingChannels += 1;
    }
  }

  if (input.mode === "all") {
    for (const workspace of state.workspaces) {
      const status = await ignoreMissingDiscordDelete(() => input.guild.deleteCategory(workspace.discordCategoryId));

      if (status === "deleted") {
        result.deletedCategories += 1;
      } else {
        result.missingCategories += 1;
      }
    }
  }

  await input.stateStore.write(
    input.mode === "all"
      ? createEmptyDirectSyncState()
      : {
          ...state,
          sessionChannels: [],
        },
  );

  return result;
}
