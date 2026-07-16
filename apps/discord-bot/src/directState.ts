import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SyncedWorkspaceState {
  workspaceRoot: string;
  workspaceDisplayName: string;
  discordCategoryId: string;
  computerId: string;
  workspaceId: string;
}

export type TranscriptSyncMode = "on-chat" | "realtime";
export type DiscordSessionDeliveryMode = "channel" | "thread";

export interface SyncedSessionChannelState {
  codexSessionId: string | null;
  threadName: string;
  updatedAt: string;
  cwd: string;
  workspaceRoot: string;
  workspaceDisplayName: string;
  discordCategoryId: string | null;
  discordChannelId: string;
  discordParentChannelId?: string | null;
  discordDeliveryMode?: DiscordSessionDeliveryMode;
  channelName: string;
  computerId: string;
  workspaceId: string;
  contextPostedAt?: string | null;
  lastTranscriptMessageKey?: string | null;
  lastTranscriptSyncedAt?: string | null;
  lastTranscriptDiscordMessageId?: string | null;
}

export type ScheduledCommandSpec =
  | { type: "once"; runAt: string }
  | { type: "interval"; everyMs: number }
  | { type: "daily"; time: string }
  | { type: "weekly"; time: string; weekdays: number[] };

export interface ScheduledCommandState {
  id: string;
  channelId: string;
  userId: string;
  roleIds: string[];
  command: string;
  schedule: ScheduledCommandSpec;
  enabled: boolean;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  runCount: number;
}

export interface CodexTaskCompletionNotificationState {
  sessionId: string;
  lastTaskCompleteEventKey: string;
  threadName?: string | null;
  updatedAt?: string | null;
  notifiedAt?: string | null;
}

export interface DirectSyncState {
  version: 1;
  transcriptSyncMode: TranscriptSyncMode;
  archivedCodexSessionIds: string[];
  workspaces: SyncedWorkspaceState[];
  sessionChannels: SyncedSessionChannelState[];
  scheduledCommands: ScheduledCommandState[];
  taskCompletionNotificationsInitializedAt?: string | null;
  taskCompletionNotificationScope?: string | null;
  taskCompletionNotifications: CodexTaskCompletionNotificationState[];
  discordRequestedCodexSessionIds: string[];
}

export type DirectSyncStateWriteInput = Omit<
  DirectSyncState,
  | "transcriptSyncMode"
  | "scheduledCommands"
  | "taskCompletionNotificationsInitializedAt"
  | "taskCompletionNotifications"
  | "discordRequestedCodexSessionIds"
> & {
  transcriptSyncMode?: TranscriptSyncMode;
  scheduledCommands?: ScheduledCommandState[];
  taskCompletionNotificationsInitializedAt?: string | null;
  taskCompletionNotificationScope?: string | null;
  taskCompletionNotifications?: CodexTaskCompletionNotificationState[];
  discordRequestedCodexSessionIds?: string[];
};

export interface DirectSyncStateStore {
  read(): Promise<DirectSyncState>;
  write(state: DirectSyncStateWriteInput): Promise<void>;
  findSessionChannelByDiscordId(discordChannelId: string): Promise<SyncedSessionChannelState | null>;
  updateChannelCwd(discordChannelId: string, cwd: string): Promise<void>;
  updateSessionChannelCodexSession(
    discordChannelId: string,
    codexSessionId: string,
    threadName?: string,
  ): Promise<void>;
  updateTranscriptSyncMode(mode: TranscriptSyncMode): Promise<void>;
  markDiscordRequestedCodexSession(sessionId: string): Promise<void>;
}

export function createEmptyDirectSyncState(): DirectSyncState {
  return {
    version: 1,
    transcriptSyncMode: "realtime",
    archivedCodexSessionIds: [],
    workspaces: [],
    sessionChannels: [],
    scheduledCommands: [],
    taskCompletionNotificationsInitializedAt: null,
    taskCompletionNotificationScope: null,
    taskCompletionNotifications: [],
    discordRequestedCodexSessionIds: [],
  };
}

function normalizeDirectSyncState(state: Partial<DirectSyncState>): DirectSyncState {
  const transcriptSyncMode =
    state.transcriptSyncMode === "realtime" || state.transcriptSyncMode === "on-chat"
      ? state.transcriptSyncMode
      : "realtime";

  return {
    version: 1,
    transcriptSyncMode,
    archivedCodexSessionIds: Array.isArray(state.archivedCodexSessionIds)
      ? state.archivedCodexSessionIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
    workspaces: Array.isArray(state.workspaces) ? state.workspaces : [],
    sessionChannels: Array.isArray(state.sessionChannels) ? state.sessionChannels : [],
    scheduledCommands: Array.isArray(state.scheduledCommands)
      ? state.scheduledCommands.filter(
          (schedule): schedule is ScheduledCommandState =>
            typeof schedule === "object" &&
            schedule !== null &&
            typeof (schedule as ScheduledCommandState).id === "string" &&
            typeof (schedule as ScheduledCommandState).channelId === "string" &&
            typeof (schedule as ScheduledCommandState).command === "string",
        )
      : [],
    taskCompletionNotificationsInitializedAt:
      typeof state.taskCompletionNotificationsInitializedAt === "string"
        ? state.taskCompletionNotificationsInitializedAt
        : null,
    taskCompletionNotificationScope:
      typeof state.taskCompletionNotificationScope === "string"
        ? state.taskCompletionNotificationScope
        : null,
    taskCompletionNotifications: Array.isArray(state.taskCompletionNotifications)
      ? state.taskCompletionNotifications.filter(
          (notification): notification is CodexTaskCompletionNotificationState =>
            typeof notification === "object" &&
            notification !== null &&
            typeof (notification as CodexTaskCompletionNotificationState).sessionId === "string" &&
            typeof (notification as CodexTaskCompletionNotificationState).lastTaskCompleteEventKey === "string",
        )
      : [],
    discordRequestedCodexSessionIds: Array.isArray(state.discordRequestedCodexSessionIds)
      ? [
          ...new Set(
            state.discordRequestedCodexSessionIds
              .filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0)
              .map((sessionId) => sessionId.toLowerCase()),
          ),
        ]
      : [],
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
        return normalizeDirectSyncState(JSON.parse(await readFile(resolvedStatePath, "utf8")) as Partial<DirectSyncState>);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return createEmptyDirectSyncState();
        }

        throw error;
      }
    },
    async write(state) {
      await mkdir(path.dirname(resolvedStatePath), { recursive: true });
      await writeFile(resolvedStatePath, `${JSON.stringify(normalizeDirectSyncState(state), null, 2)}\n`, "utf8");
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
    async updateSessionChannelCodexSession(discordChannelId, codexSessionId, threadName) {
      const state = await this.read();
      const nextState: DirectSyncState = {
        ...state,
        sessionChannels: state.sessionChannels.map((channel) =>
          channel.discordChannelId === discordChannelId
            ? {
                ...channel,
                codexSessionId,
                threadName: threadName?.trim() || channel.threadName,
                updatedAt: new Date().toISOString(),
              }
            : channel,
        ),
      };

      await this.write(nextState);
    },
    async updateTranscriptSyncMode(mode) {
      const state = await this.read();
      await this.write({
        ...state,
        transcriptSyncMode: mode,
      });
    },
    async markDiscordRequestedCodexSession(sessionId) {
      const normalizedSessionId = sessionId.trim().toLowerCase();

      if (!normalizedSessionId) {
        return;
      }

      const state = await this.read();

      if (state.discordRequestedCodexSessionIds.includes(normalizedSessionId)) {
        return;
      }

      await this.write({
        ...state,
        discordRequestedCodexSessionIds: [...state.discordRequestedCodexSessionIds, normalizedSessionId],
      });
    },
  };
}
