import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SyncedWorkspaceState {
  workspaceRoot: string;
  workspaceDisplayName: string;
  discordCategoryId: string;
  computerId: string;
  workspaceId: string;
}

export interface SyncedSessionChannelState {
  codexSessionId: string;
  threadName: string;
  updatedAt: string;
  cwd: string;
  workspaceRoot: string;
  workspaceDisplayName: string;
  discordCategoryId: string;
  discordChannelId: string;
  channelName: string;
  computerId: string;
  workspaceId: string;
}

export interface DirectSyncState {
  version: 1;
  workspaces: SyncedWorkspaceState[];
  sessionChannels: SyncedSessionChannelState[];
}

export interface DirectSyncStateStore {
  read(): Promise<DirectSyncState>;
  write(state: DirectSyncState): Promise<void>;
  findSessionChannelByDiscordId(discordChannelId: string): Promise<SyncedSessionChannelState | null>;
  updateChannelCwd(discordChannelId: string, cwd: string): Promise<void>;
}

export function createEmptyDirectSyncState(): DirectSyncState {
  return {
    version: 1,
    workspaces: [],
    sessionChannels: [],
  };
}

export function defaultDirectSyncStatePath(): string {
  return path.resolve(process.env.CONNECT_STATE_PATH ?? ".connect/state.json");
}

export function createDirectSyncStateStore(statePath = defaultDirectSyncStatePath()): DirectSyncStateStore {
  const resolvedStatePath = path.resolve(statePath);

  return {
    async read() {
      try {
        return JSON.parse(await readFile(resolvedStatePath, "utf8")) as DirectSyncState;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return createEmptyDirectSyncState();
        }

        throw error;
      }
    },
    async write(state) {
      await mkdir(path.dirname(resolvedStatePath), { recursive: true });
      await writeFile(resolvedStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    },
    async findSessionChannelByDiscordId(discordChannelId) {
      const state = await this.read();
      return state.sessionChannels.find((channel) => channel.discordChannelId === discordChannelId) ?? null;
    },
    async updateChannelCwd(discordChannelId, cwd) {
      const state = await this.read();
      const nextState: DirectSyncState = {
        ...state,
        sessionChannels: state.sessionChannels.map((channel) =>
          channel.discordChannelId === discordChannelId ? { ...channel, cwd } : channel,
        ),
      };

      await this.write(nextState);
    },
  };
}
