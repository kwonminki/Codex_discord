import os from "node:os";
import { pathToFileURL } from "node:url";

import type { DiscoveredCodexSession } from "../../../packages/codex-adapter/src/index.js";
import { DISCORD_APPLICATION_COMMANDS } from "./applicationCommands.js";
import { createNewCodexChatChannel, linkPendingNewCodexChatSession } from "./codexNewChat.js";
import { archiveSyncedCodexSession } from "./codexSessionArchive.js";
import {
  deleteSyncedDiscordSessions,
  previewSyncedDiscordSessionDelete,
  type SyncedDeleteMode,
} from "./codexSessionDelete.js";
import {
  syncCodexSessionsToDiscord,
  type DiscordGuildSurface,
  type SyncCodexSessionsProgress,
} from "./codexSessionSync.js";
import { syncCodexSessionTranscriptUpdates } from "./codexTranscriptSync.js";
import { notifyCodexTaskCompletions } from "./codexTaskNotifications.js";
import { syncClaudeCodeSessionsToDiscord } from "./claudeSessionSync.js";
import { loadConnectConfig } from "./connectConfig.js";
import { createControlApiClient } from "./controlApiClient.js";
import { createDirectSyncStateStore } from "./directState.js";
import { createDirectControlClient } from "./directControlClient.js";
import {
  attachDiscordInteractionHandler,
  attachDiscordMessageHandler,
  createDiscordGuildSurface,
  createDiscordClient,
  registerDiscordApplicationCommands,
} from "./discordClient.js";
import { createDiscordMessageHandler } from "./messageHandler.js";
import type { DiscordOutgoingMessage } from "./messageHandler.js";
import { manageScheduledCommand, runDueScheduledCommands } from "./scheduler.js";

export const BOT_RELOAD_EXIT_CODE = 42;
const DEFAULT_TRANSCRIPT_SYNC_INTERVAL_MS = 5_000;
const DEFAULT_TASK_NOTIFICATION_INTERVAL_MS = 3_000;
const DEFAULT_CLAUDE_SESSION_SYNC_INTERVAL_MS = 5_000;
const DEFAULT_CLAUDE_SESSION_SYNC_LOOKBACK_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_CLAUDE_SESSION_SYNC_LIMIT = 10;
const DEFAULT_SCHEDULE_POLL_INTERVAL_MS = 30_000;
const DEFAULT_BACKGROUND_POLL_MAX_INTERVAL_MS = 20_000;
const DEFAULT_BACKGROUND_MAX_NORMALIZED_LOAD = 0.7;

export function resolveRealtimeIntervalMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return fallbackMs;
  }

  return Math.min(Math.max(parsed, 500), 60_000);
}

export function resolveBackgroundMaxNormalizedLoad(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed <= 0) {
    return 0;
  }

  return Math.min(Math.max(parsed, 0.1), 4);
}

function resolveBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

export function shouldSkipBackgroundPolling(input: {
  loadAverage: number;
  cpuCount: number;
  maxNormalizedLoad: number;
}): boolean {
  if (input.maxNormalizedLoad <= 0 || input.cpuCount <= 0 || input.loadAverage <= 0) {
    return false;
  }

  return input.loadAverage / input.cpuCount >= input.maxNormalizedLoad;
}

export interface BackgroundPollState {
  nextRunAt: number;
  currentIntervalMs: number;
}

export function createBackgroundPollState(now: number, baseIntervalMs: number): BackgroundPollState {
  return {
    nextRunAt: now,
    currentIntervalMs: baseIntervalMs,
  };
}

export function shouldRunBackgroundPoll(state: BackgroundPollState, now: number): boolean {
  return now >= state.nextRunAt;
}

export function recordBackgroundPollResult(
  state: BackgroundPollState,
  input: {
    now: number;
    baseIntervalMs: number;
    maxIntervalMs: number;
    changed: boolean;
    skippedForLoad?: boolean;
  },
): void {
  const maxIntervalMs = Math.max(input.baseIntervalMs, input.maxIntervalMs);
  const nextIntervalMs =
    input.changed && !input.skippedForLoad
      ? input.baseIntervalMs
      : Math.min(maxIntervalMs, Math.max(input.baseIntervalMs, state.currentIntervalMs * 2));

  state.currentIntervalMs = nextIntervalMs;
  state.nextRunAt = input.now + nextIntervalMs;
}

export function shouldRunRealtimeSessionAutosync(input: {
  mode: "on-chat" | "realtime";
  now: number;
  lastAutoSyncAt: number;
  intervalMs: number;
}): boolean {
  void input;
  return false;
}

const TRANSCRIPT_SYNC_INTERVAL_MS = resolveRealtimeIntervalMs(
  process.env.CONNECT_TRANSCRIPT_SYNC_INTERVAL_MS,
  DEFAULT_TRANSCRIPT_SYNC_INTERVAL_MS,
);
const TASK_NOTIFICATION_INTERVAL_MS = resolveRealtimeIntervalMs(
  process.env.CONNECT_TASK_NOTIFICATION_INTERVAL_MS,
  DEFAULT_TASK_NOTIFICATION_INTERVAL_MS,
);
const CLAUDE_SESSION_SYNC_INTERVAL_MS = resolveRealtimeIntervalMs(
  process.env.CONNECT_CLAUDE_SESSION_SYNC_INTERVAL_MS,
  DEFAULT_CLAUDE_SESSION_SYNC_INTERVAL_MS,
);
const CLAUDE_SESSION_SYNC_LOOKBACK_MS = resolveBoundedInteger(
  process.env.CONNECT_CLAUDE_SESSION_SYNC_LOOKBACK_MS,
  DEFAULT_CLAUDE_SESSION_SYNC_LOOKBACK_MS,
  60_000,
  7 * 24 * 60 * 60 * 1_000,
);
const CLAUDE_SESSION_SYNC_LIMIT = resolveBoundedInteger(
  process.env.CONNECT_CLAUDE_SESSION_SYNC_LIMIT,
  DEFAULT_CLAUDE_SESSION_SYNC_LIMIT,
  1,
  50,
);
const SCHEDULE_POLL_INTERVAL_MS = resolveRealtimeIntervalMs(
  process.env.CONNECT_SCHEDULE_POLL_INTERVAL_MS,
  DEFAULT_SCHEDULE_POLL_INTERVAL_MS,
);
const BACKGROUND_POLL_MAX_INTERVAL_MS = resolveRealtimeIntervalMs(
  process.env.CONNECT_BACKGROUND_POLL_MAX_INTERVAL_MS,
  DEFAULT_BACKGROUND_POLL_MAX_INTERVAL_MS,
);
const BACKGROUND_MAX_NORMALIZED_LOAD = resolveBackgroundMaxNormalizedLoad(
  process.env.CONNECT_BACKGROUND_MAX_LOAD,
  DEFAULT_BACKGROUND_MAX_NORMALIZED_LOAD,
);

function currentBackgroundLoadInput(): { loadAverage: number; cpuCount: number; maxNormalizedLoad: number } {
  return {
    loadAverage: os.loadavg()[0] ?? 0,
    cpuCount: typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length,
    maxNormalizedLoad: BACKGROUND_MAX_NORMALIZED_LOAD,
  };
}

function outgoingMessageToText(message: DiscordOutgoingMessage): string {
  if (typeof message === "string") {
    return message;
  }

  const lines = [
    message.content,
    ...(message.embeds ?? []).flatMap((embed) => [
      embed.title,
      embed.description,
      ...(embed.fields ?? []).flatMap((field) => [`${field.name}:`, field.value]),
    ]),
  ].filter((line): line is string => typeof line === "string" && line.trim().length > 0);
  const text = lines.join("\n");

  return text.length <= 1_900 ? text : `${text.slice(0, 1_875)}\n... (일부만 표시)`;
}

function resolveReadyGuildSurface(
  client: ReturnType<typeof createDiscordClient>,
  guildId?: string,
): DiscordGuildSurface | null {
  const cache = client.guilds.cache;
  const guild = guildId ? cache.get(guildId) : cache.first();

  return createDiscordGuildSurface(guild ?? null);
}

export async function startBot(): Promise<void> {
  const connectConfig = await loadConnectConfig();
  const token = process.env.DISCORD_TOKEN ?? connectConfig?.discord.token;

  if (!token) {
    throw new Error("DISCORD_TOKEN is required");
  }

  const client = createDiscordClient();
  const startedAt = new Date().toISOString();
  const requestedMode = connectConfig?.mode ?? process.env.CONNECT_MODE;
  const directStateStore = connectConfig?.mode === "direct" ? createDirectSyncStateStore() : null;
  const activelyStreamedSessionIds = new Set<string>();

  if (requestedMode === "direct" && connectConfig?.mode !== "direct") {
    throw new Error("Direct mode requires .connect/config.json. Run `pnpm connect setup --direct`.");
  }

  const controlApiClient =
    connectConfig?.mode === "direct"
      ? createDirectControlClient(connectConfig, { stateStore: directStateStore ?? undefined })
      : createControlApiClient({
            baseUrl:
            connectConfig?.mode === "hub"
              ? connectConfig.hub.controlApiUrl
              : process.env.CONTROL_API_URL ?? "http://127.0.0.1:4317",
        });
  const listDirectCodexSessions =
    connectConfig?.mode === "direct"
      ? async (
          options: {
            activeOnly?: boolean;
            includeExecSessions?: boolean;
            includeSessionIds?: string[];
          } = {},
        ): Promise<DiscoveredCodexSession[]> => {
          const response = await controlApiClient.listCodexSessions({
            computerId: connectConfig.direct.computerId,
            codexHome: connectConfig.direct.codexHome,
            activeOnly: options.activeOnly,
            includeExecSessions: options.includeExecSessions,
            includeSessionIds: options.includeSessionIds,
          });

          if ("error" in response) {
            throw new Error(response.error.message);
          }

          return response.result as DiscoveredCodexSession[];
        }
      : undefined;
  const syncCodexSessions =
    connectConfig?.mode === "direct" && directStateStore
      ? async (input: {
          guild: DiscordGuildSurface;
          limit: number;
          sessionIds?: string[];
          onProgress?: (progress: SyncCodexSessionsProgress) => Promise<void> | void;
        }) => {
          const sessions = await listDirectCodexSessions?.();

          if (!sessions) {
            throw new Error("Direct Codex session listing is not connected.");
          }

          const selectedSessionIds = input.sessionIds ? new Set(input.sessionIds) : null;
          const syncSessions = selectedSessionIds
            ? sessions.filter((session) => selectedSessionIds.has(session.id))
            : sessions;

          return syncCodexSessionsToDiscord({
            guild: input.guild,
            controlApi: controlApiClient,
            stateStore: directStateStore,
            computerId: connectConfig.direct.computerId,
            computerDisplayName: connectConfig.direct.computerDisplayName,
            defaultWorkspaceRoot: connectConfig.direct.workspaceRoot,
            sessions: syncSessions,
            limit: input.limit,
            sessionThreadParentChannelId: connectConfig.direct.channelId,
            mentionRoleIds: connectConfig.discord.allowedRoleIds,
            onProgress: input.onProgress,
          });
        }
      : undefined;
  const previewSelectableCodexSessions =
    connectConfig?.mode === "direct" && directStateStore
      ? async (input: { limit: number }) => {
          const sessions = await listDirectCodexSessions?.();

          if (!sessions) {
            throw new Error("Direct Codex session listing is not connected.");
          }

          const state = await directStateStore.read();
          const archivedSessionIds = new Set(state.archivedCodexSessionIds);
          const activeSessions = sessions.filter((session) => !archivedSessionIds.has(session.id));
          const limit = Math.min(input.limit, 25);

          return {
            sessions: activeSessions.slice(0, limit).map((session) => ({
              id: session.id,
              threadName: session.threadName,
              updatedAt: session.updatedAt,
              workspaceDisplayName:
                session.cwdHint?.split("/").filter(Boolean).at(-1) ?? connectConfig.direct.workspaceDisplayName,
            })),
            totalAvailable: activeSessions.length,
            limit,
          };
        }
      : undefined;
  const syncTranscriptUpdates =
    connectConfig?.mode === "direct" && directStateStore
      ? async (input: {
          guild: DiscordGuildSurface;
          discordChannelId?: string;
          trigger: "on-chat" | "realtime";
          postUpdates?: boolean;
        }) => {
          const state = await directStateStore.read();

          if (input.trigger === "realtime" && state.transcriptSyncMode !== "realtime") {
            return {
              mode: state.transcriptSyncMode,
              trigger: input.trigger,
              checkedChannels: 0,
              updatedChannels: 0,
              postedMessages: 0,
              skippedByMode: true,
            };
          }

          const linkedSessionIds = state.sessionChannels
            .map((channel) => channel.codexSessionId)
            .filter((sessionId): sessionId is string => Boolean(sessionId));

          if (linkedSessionIds.length === 0) {
            return {
              mode: state.transcriptSyncMode,
              trigger: input.trigger,
              checkedChannels: 0,
              updatedChannels: 0,
              postedMessages: 0,
              skippedByMode: false,
            };
          }

          const sessions = await listDirectCodexSessions?.({
            activeOnly: false,
            includeExecSessions: true,
            includeSessionIds: linkedSessionIds,
          });

          if (!sessions) {
            throw new Error("Direct Codex session listing is not connected.");
          }

          return syncCodexSessionTranscriptUpdates({
            guild: input.guild,
            stateStore: directStateStore,
            sessions,
            trigger: input.trigger,
            discordChannelId: input.discordChannelId,
            postUpdates: input.postUpdates,
            ignoredSessionIds: activelyStreamedSessionIds,
            mentionRoleIds: connectConfig.discord.allowedRoleIds,
          });
        }
      : undefined;
  const notifyTaskCompletions =
    connectConfig?.mode === "direct" && directStateStore
      ? async (input: { guild: DiscordGuildSurface }) => {
          const sessions = await listDirectCodexSessions?.({
            activeOnly: false,
            includeExecSessions: true,
          });

          if (!sessions) {
            throw new Error("Direct Codex session listing is not connected.");
          }

          return notifyCodexTaskCompletions({
            guild: input.guild,
            controlApi: controlApiClient,
            stateStore: directStateStore,
            adminChannelId: connectConfig.direct.channelId,
            computerId: connectConfig.direct.computerId,
            defaultWorkspaceRoot: connectConfig.direct.workspaceRoot,
            sessions,
            mentionRoleIds: connectConfig.discord.allowedRoleIds,
            ignoredSessionIds: activelyStreamedSessionIds,
          });
      }
      : undefined;
  const syncClaudeCodeSessions =
    connectConfig?.mode === "direct" && directStateStore && connectConfig.direct.claudeChannelId?.trim()
      ? async (input: { guild: DiscordGuildSurface }) =>
          syncClaudeCodeSessionsToDiscord({
            guild: input.guild,
            controlApi: controlApiClient,
            stateStore: directStateStore,
            computerId: connectConfig.direct.computerId,
            computerDisplayName: connectConfig.direct.computerDisplayName,
            parentChannelId: connectConfig.direct.claudeChannelId?.trim() ?? "",
            mentionRoleIds: connectConfig.discord.allowedRoleIds,
            lookbackMs: CLAUDE_SESSION_SYNC_LOOKBACK_MS,
            limit: CLAUDE_SESSION_SYNC_LIMIT,
          })
      : undefined;
  const getSyncStatus =
    directStateStore
      ? async () => {
          const state = await directStateStore.read();

          return {
            workspaceCount: state.workspaces.length,
            sessionChannelCount: state.sessionChannels.length,
            archivedSessionCount: state.archivedCodexSessionIds.length,
            contextPostedCount: state.sessionChannels.filter((channel) => Boolean(channel.contextPostedAt)).length,
            transcriptSyncMode: state.transcriptSyncMode,
            transcriptSyncedChannelCount: state.sessionChannels.filter((channel) =>
              Boolean(channel.lastTranscriptMessageKey),
            ).length,
          };
      }
      : undefined;
  const setTranscriptSyncMode =
    directStateStore
      ? async (mode: "on-chat" | "realtime") => {
          await directStateStore.updateTranscriptSyncMode(mode);
          return { mode };
        }
      : undefined;
  const reloadBot = async (input: { mode: "commands" | "restart" }) => {
    await registerDiscordApplicationCommands(client, connectConfig?.discord.guildId);

    if (input.mode === "restart") {
      setTimeout(() => {
        process.exit(BOT_RELOAD_EXIT_CODE);
      }, 1_500).unref();
    }

    return {
      mode: input.mode,
      commandCount: DISCORD_APPLICATION_COMMANDS.length,
      restarting: input.mode === "restart",
      startedAt,
    };
  };
  const previewSyncedChannelsDelete =
    directStateStore
      ? async (input: { mode: SyncedDeleteMode; sessionId?: string | null }) =>
          previewSyncedDiscordSessionDelete({
            stateStore: directStateStore,
            mode: input.mode,
            sessionId: input.sessionId,
          })
      : undefined;
  const deleteSyncedChannels =
    directStateStore
      ? async (input: { guild: DiscordGuildSurface; mode: SyncedDeleteMode; sessionId?: string | null }) =>
          deleteSyncedDiscordSessions({
            guild: {
              deleteChannel: async (id) => {
                if (!input.guild.deleteChannel) {
                  throw new Error("Discord guild deleteChannel surface is unavailable.");
                }

                await input.guild.deleteChannel(id);
              },
              deleteCategory: async (id) => {
                if (!input.guild.deleteCategory) {
                  throw new Error("Discord guild deleteCategory surface is unavailable.");
                }

                await input.guild.deleteCategory(id);
              },
            },
            stateStore: directStateStore,
            mode: input.mode,
            sessionId: input.sessionId,
          })
      : undefined;
  const archiveSyncedSession =
    directStateStore
      ? async (input: { guild: DiscordGuildSurface | null | undefined; discordChannelId: string; codexSessionId?: string | null }) =>
          archiveSyncedCodexSession({
            guild: input.guild,
            stateStore: directStateStore,
            discordChannelId: input.discordChannelId,
            codexSessionId: input.codexSessionId,
          })
      : undefined;
  const scheduleCommand =
    directStateStore
      ? async (input: {
          request: Parameters<typeof manageScheduledCommand>[0]["request"];
          channelId: string;
          userId: string;
          roleIds: string[];
        }) =>
          manageScheduledCommand({
            stateStore: directStateStore,
            request: input.request,
            channelId: input.channelId,
            userId: input.userId,
            roleIds: input.roleIds,
          })
      : undefined;
  const createNewCodexChat =
    connectConfig?.mode === "direct" && directStateStore
      ? async (input: {
          guild: DiscordGuildSurface;
          name: string | null;
          cwd: string | null;
          currentCwd: string;
          useCategory: boolean;
          initialPrompt: string | null;
          channelMode: "session-linked" | "claude-code";
          sessionThreadParentChannelId: string | null;
        }) =>
          createNewCodexChatChannel({
            guild: input.guild,
            controlApi: controlApiClient,
            stateStore: directStateStore,
            computerId: connectConfig.direct.computerId,
            computerDisplayName: connectConfig.direct.computerDisplayName,
            defaultWorkspaceRoot: connectConfig.direct.workspaceRoot,
            currentCwd: input.currentCwd,
            name: input.name,
            cwd: input.cwd,
            useCategory: input.useCategory,
            initialPrompt: input.initialPrompt,
            channelMode: input.channelMode,
            sessionThreadParentChannelId: input.sessionThreadParentChannelId ?? connectConfig.direct.channelId,
          })
      : undefined;
  const linkNewCodexSession =
    directStateStore
      ? async (input: { discordChannelId: string; codexSessionId: string; threadName: string }) =>
          linkPendingNewCodexChatSession({
            controlApi: controlApiClient,
            stateStore: directStateStore,
            discordChannelId: input.discordChannelId,
            codexSessionId: input.codexSessionId,
            threadName: input.threadName,
          })
      : undefined;
  const handleMessage = createDiscordMessageHandler({
    resolveChannelContext: controlApiClient.getChannelContext,
    submitCommandJob: controlApiClient.submitCommandJob,
    submitCodexPrompt: controlApiClient.submitCodexPrompt,
    submitClaudePrompt: controlApiClient.submitClaudePrompt,
    syncCodexSessions,
    createNewCodexChat,
    linkNewCodexSession,
    recordClaudeSession: directStateStore
      ? (input) =>
          directStateStore.updateSessionChannelClaudeSession(input.discordChannelId, input.claudeSessionId)
      : undefined,
    previewSelectableCodexSessions,
    getSyncStatus,
    setTranscriptSyncMode,
    syncTranscriptUpdates,
    setSessionStreaming: (sessionId, active) => {
      if (active) {
        activelyStreamedSessionIds.add(sessionId);
        return;
      }

      activelyStreamedSessionIds.delete(sessionId);
    },
    markDiscordRequestedCodexSession: directStateStore
      ? (sessionId) => directStateStore.markDiscordRequestedCodexSession(sessionId)
      : undefined,
    reloadBot,
    previewSyncedChannelsDelete,
    deleteSyncedChannels,
    archiveSyncedSession,
    scheduleCommand,
    updateChannelCwd: controlApiClient.updateChannelCwd,
    recordCommandAudit: controlApiClient.recordCommandAudit,
  });

  client.once("ready", () => {
    console.info(`Discord bot ready as ${client.user?.tag ?? "unknown"}`);
    void registerDiscordApplicationCommands(client, connectConfig?.discord.guildId).catch((error) => {
      console.error("discord-bot failed to register slash commands", error);
    });

    if (syncTranscriptUpdates) {
      let running = false;
      const pollState = createBackgroundPollState(Date.now(), TRANSCRIPT_SYNC_INTERVAL_MS);
      const timer = setInterval(() => {
        const now = Date.now();

        if (!shouldRunBackgroundPoll(pollState, now)) {
          return;
        }

        if (running) {
          return;
        }

        if (shouldSkipBackgroundPolling(currentBackgroundLoadInput())) {
          recordBackgroundPollResult(pollState, {
            now,
            baseIntervalMs: TRANSCRIPT_SYNC_INTERVAL_MS,
            maxIntervalMs: BACKGROUND_POLL_MAX_INTERVAL_MS,
            changed: false,
            skippedForLoad: true,
          });
          return;
        }

        const guild = resolveReadyGuildSurface(client, connectConfig?.discord.guildId);

        if (!guild) {
          return;
        }

        running = true;
        void (async () => {
          const result = await syncTranscriptUpdates({ guild, trigger: "realtime" });
          recordBackgroundPollResult(pollState, {
            now: Date.now(),
            baseIntervalMs: TRANSCRIPT_SYNC_INTERVAL_MS,
            maxIntervalMs: BACKGROUND_POLL_MAX_INTERVAL_MS,
            changed: result.updatedChannels > 0 || result.postedMessages > 0,
          });
        })()
          .catch((error) => {
            console.error("discord-bot failed to sync Codex transcripts", error);
            recordBackgroundPollResult(pollState, {
              now: Date.now(),
              baseIntervalMs: TRANSCRIPT_SYNC_INTERVAL_MS,
              maxIntervalMs: BACKGROUND_POLL_MAX_INTERVAL_MS,
              changed: false,
            });
          })
          .finally(() => {
            running = false;
          });
      }, TRANSCRIPT_SYNC_INTERVAL_MS);
      timer.unref();
    }

    if (notifyTaskCompletions) {
      let running = false;
      const pollState = createBackgroundPollState(Date.now(), TASK_NOTIFICATION_INTERVAL_MS);
      const timer = setInterval(() => {
        const now = Date.now();

        if (!shouldRunBackgroundPoll(pollState, now)) {
          return;
        }

        if (running) {
          return;
        }

        if (shouldSkipBackgroundPolling(currentBackgroundLoadInput())) {
          recordBackgroundPollResult(pollState, {
            now,
            baseIntervalMs: TASK_NOTIFICATION_INTERVAL_MS,
            maxIntervalMs: BACKGROUND_POLL_MAX_INTERVAL_MS,
            changed: false,
            skippedForLoad: true,
          });
          return;
        }

        const guild = resolveReadyGuildSurface(client, connectConfig?.discord.guildId);

        if (!guild?.sendTextMessage) {
          return;
        }

        running = true;
        void notifyTaskCompletions({ guild })
          .then((result) => {
            recordBackgroundPollResult(pollState, {
              now: Date.now(),
              baseIntervalMs: TASK_NOTIFICATION_INTERVAL_MS,
              maxIntervalMs: BACKGROUND_POLL_MAX_INTERVAL_MS,
              changed: result.initialized || result.notifiedSessions > 0,
            });
          })
          .catch((error) => {
            console.error("discord-bot failed to notify Codex task completions", error);
            recordBackgroundPollResult(pollState, {
              now: Date.now(),
              baseIntervalMs: TASK_NOTIFICATION_INTERVAL_MS,
              maxIntervalMs: BACKGROUND_POLL_MAX_INTERVAL_MS,
              changed: false,
            });
          })
          .finally(() => {
            running = false;
          });
      }, TASK_NOTIFICATION_INTERVAL_MS);
      timer.unref();
    }

    if (syncClaudeCodeSessions) {
      let running = false;
      const pollState = createBackgroundPollState(Date.now(), CLAUDE_SESSION_SYNC_INTERVAL_MS);
      const timer = setInterval(() => {
        const now = Date.now();

        if (!shouldRunBackgroundPoll(pollState, now)) {
          return;
        }

        if (running) {
          return;
        }

        if (shouldSkipBackgroundPolling(currentBackgroundLoadInput())) {
          recordBackgroundPollResult(pollState, {
            now,
            baseIntervalMs: CLAUDE_SESSION_SYNC_INTERVAL_MS,
            maxIntervalMs: BACKGROUND_POLL_MAX_INTERVAL_MS,
            changed: false,
            skippedForLoad: true,
          });
          return;
        }

        const guild = resolveReadyGuildSurface(client, connectConfig?.discord.guildId);

        if (!guild?.createThread) {
          return;
        }

        running = true;
        void syncClaudeCodeSessions({ guild })
          .then((result) => {
            recordBackgroundPollResult(pollState, {
              now: Date.now(),
              baseIntervalMs: CLAUDE_SESSION_SYNC_INTERVAL_MS,
              maxIntervalMs: BACKGROUND_POLL_MAX_INTERVAL_MS,
              changed: result.createdThreads > 0,
            });
          })
          .catch((error) => {
            console.error("discord-bot failed to sync Claude Code sessions", error);
            recordBackgroundPollResult(pollState, {
              now: Date.now(),
              baseIntervalMs: CLAUDE_SESSION_SYNC_INTERVAL_MS,
              maxIntervalMs: BACKGROUND_POLL_MAX_INTERVAL_MS,
              changed: false,
            });
          })
          .finally(() => {
            running = false;
          });
      }, CLAUDE_SESSION_SYNC_INTERVAL_MS);
      timer.unref();
    }

    if (directStateStore) {
      let running = false;
      const timer = setInterval(() => {
        if (running) {
          return;
        }

        const guild = resolveReadyGuildSurface(client, connectConfig?.discord.guildId);

        if (!guild?.sendTextMessage) {
          return;
        }

        running = true;
        void runDueScheduledCommands({
          stateStore: directStateStore,
          execute: async (schedule) => {
            await guild.sendTextMessage?.(
              schedule.channelId,
              `예약 실행: \`${schedule.command.replace(/`/g, "'")}\``,
            );
            await handleMessage({
              authorBot: false,
              userId: schedule.userId,
              channelId: schedule.channelId,
              content: schedule.command,
              roleIds: schedule.roleIds,
              guild,
              reply: async (replyMessage) => {
                await guild.sendTextMessage?.(schedule.channelId, outgoingMessageToText(replyMessage));
              },
            });
          },
        })
          .catch((error) => {
            console.error("discord-bot failed to run scheduled commands", error);
          })
          .finally(() => {
            running = false;
          });
      }, SCHEDULE_POLL_INTERVAL_MS);
      timer.unref();
    }
  });
  attachDiscordMessageHandler(client, handleMessage);
  attachDiscordInteractionHandler(client, handleMessage, {
    isManagedChannel: async (channelId) => Boolean(await controlApiClient.getChannelContext(channelId)),
  });

  await client.login(token);
}

export async function main(): Promise<void> {
  await startBot();
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  await main();
}
