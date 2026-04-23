import { classifyCommand } from "@codex-discord/core";
import type { ManagedDiscordChannelContext } from "./channelContext.js";
import type {
  DeletePreviewResult,
  DeleteSyncedDiscordSessionsResult,
  SyncedDeleteMode,
} from "./codexSessionDelete.js";
import type { DiscordGuildSurface, SyncCodexSessionsResult } from "./codexSessionSync.js";
import type { ControlApiClient } from "./controlApiClient.js";
import { routeDiscordMessage } from "./commandRouter.js";
import type { DiscordMessagePayload } from "./responses.js";
import {
  formatCodexAck,
  formatCodexResultUpdate,
  formatCommandAck,
  formatCommandResultUpdate,
  formatDeleteAck,
  formatDeletePreview,
  formatDeleteResult,
  formatDenied,
  formatHelp,
  formatSyncAck,
  formatSyncResultUpdate,
} from "./responses.js";

export type { ManagedDiscordChannelContext } from "./channelContext.js";

export interface DiscordMessageLike {
  authorBot: boolean;
  userId: string;
  channelId: string;
  content: string;
  roleIds: string[];
  guild?: DiscordGuildSurface | null;
  reply(message: DiscordOutgoingMessage): Promise<DiscordReplyLike | void>;
}

export interface DiscordReplyLike {
  edit(message: DiscordOutgoingMessage): Promise<unknown>;
}

export type DiscordOutgoingMessage = string | DiscordMessagePayload;

export interface CreateDiscordMessageHandlerInput {
  resolveChannelContext(channelId: string): Promise<ManagedDiscordChannelContext | null>;
  submitCommandJob: ControlApiClient["submitCommandJob"];
  submitCodexPrompt?: ControlApiClient["submitCodexPrompt"];
  syncCodexSessions?: (input: { guild: DiscordGuildSurface; limit: number }) => Promise<SyncCodexSessionsResult>;
  previewSyncedChannelsDelete?: (input: { mode: SyncedDeleteMode }) => Promise<DeletePreviewResult>;
  deleteSyncedChannels?: (input: {
    guild: DiscordGuildSurface;
    mode: SyncedDeleteMode;
  }) => Promise<DeleteSyncedDiscordSessionsResult>;
  updateChannelCwd: ControlApiClient["updateChannelCwd"];
  recordCommandAudit: ControlApiClient["recordCommandAudit"];
}

function extractUpdatedCwd(response: Awaited<ReturnType<ControlApiClient["submitCommandJob"]>>): string | null {
  if (!("result" in response) || typeof response.result !== "object" || response.result === null) {
    return null;
  }

  const cwd = (response.result as { cwd?: unknown }).cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : null;
}

function extractResultStatus(response: Awaited<ReturnType<ControlApiClient["submitCommandJob"]>>): string {
  if (!("result" in response) || typeof response.result !== "object" || response.result === null) {
    return "failed";
  }

  const status = (response.result as { status?: unknown }).status;
  return typeof status === "string" && status.length > 0 ? status : "unknown";
}

async function recordCommandAudit(
  input: CreateDiscordMessageHandlerInput,
  details: {
    discordChannelId: string;
    userId: string;
    cwd: string;
    rawCommand: string;
    resultStatus: string;
  },
) {
  try {
    await input.recordCommandAudit({
      ...details,
      tier: classifyCommand(details.rawCommand).tier,
    });
  } catch (error) {
    console.error("discord-bot failed to record command audit", error);
  }
}

async function updateQueuedReply(
  queuedReply: DiscordReplyLike | void,
  fallbackReply: (message: DiscordOutgoingMessage) => Promise<DiscordReplyLike | void>,
  message: DiscordOutgoingMessage,
): Promise<void> {
  if (queuedReply && typeof queuedReply.edit === "function") {
    await queuedReply.edit(message);
    return;
  }

  await fallbackReply(message);
}

export function createDiscordMessageHandler(input: CreateDiscordMessageHandlerInput) {
  const channelQueues = new Map<string, Promise<void>>();
  const codexSessionIdsByChannel = new Map<string, string>();

  async function processDiscordMessage(message: DiscordMessageLike): Promise<void> {
    if (message.authorBot) {
      return;
    }

    const channelContext = await input.resolveChannelContext(message.channelId);

    if (!channelContext) {
      return;
    }

    const routed = routeDiscordMessage({
      channelMode: channelContext.channelMode,
      content: message.content,
      userRoleIds: message.roleIds,
      allowedRoleIds: channelContext.allowedRoleIds,
    });

    if (routed.type === "bot-help") {
      await message.reply(formatHelp(channelContext.channelMode));
      return;
    }

    if (routed.type === "admin-sync") {
      const queuedReply = await message.reply(formatSyncAck({ limit: routed.limit }));

      try {
        if (!input.syncCodexSessions) {
          throw new Error("Codex session sync is not connected for this bot mode.");
        }

        if (!message.guild) {
          throw new Error("Discord guild context is required for session sync.");
        }

        const result = await input.syncCodexSessions({
          guild: message.guild,
          limit: routed.limit,
        });
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => message.reply(replyMessage),
          formatSyncResultUpdate({ result }),
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Codex session sync failed";
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => message.reply(replyMessage),
          formatSyncResultUpdate({ error: { message: messageText } }),
        );
      }
      return;
    }

    if (routed.type === "admin-sync-delete") {
      try {
        if (!routed.confirmed) {
          if (!input.previewSyncedChannelsDelete) {
            throw new Error("Synced channel delete preview is not connected for this bot mode.");
          }

          await message.reply(formatDeletePreview(await input.previewSyncedChannelsDelete({ mode: routed.mode })));
          return;
        }

        if (!input.deleteSyncedChannels) {
          throw new Error("Synced channel deletion is not connected for this bot mode.");
        }

        if (!message.guild) {
          throw new Error("Discord guild context is required for synced channel deletion.");
        }

        const queuedReply = await message.reply(formatDeleteAck({ mode: routed.mode }));
        const result = await input.deleteSyncedChannels({
          guild: message.guild,
          mode: routed.mode,
        });
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => message.reply(replyMessage),
          formatDeleteResult({ result }),
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Synced channel deletion failed";
        await message.reply(formatDeleteResult({ error: { message: messageText } }));
      }
      return;
    }

    if (routed.type === "codex-chat") {
      const codexMessage = {
        computerDisplayName: channelContext.computerDisplayName,
        workspaceDisplayName: channelContext.workspaceDisplayName,
        cwd: channelContext.cwd,
        prompt: routed.content,
      };

      if (!input.submitCodexPrompt) {
        await message.reply(
          formatCodexResultUpdate(codexMessage, {
            error: { message: "Codex chat is not connected for this mode yet." },
          }),
        );
        return;
      }

      const queuedReply = await message.reply(formatCodexAck(codexMessage));

      try {
        const response = await input.submitCodexPrompt({
          computerId: channelContext.computerId,
          payload: {
            workspaceRoot: channelContext.workspaceRoot,
            cwd: channelContext.cwd,
            prompt: routed.content,
            timeoutMs: Math.max(channelContext.timeoutMs, 300_000),
            sessionId: codexSessionIdsByChannel.get(message.channelId) ?? channelContext.codexSessionId ?? null,
          },
        });
        const nextSessionId =
          "result" in response &&
          typeof response.result === "object" &&
          response.result !== null &&
          typeof (response.result as { sessionId?: unknown }).sessionId === "string"
            ? (response.result as { sessionId: string }).sessionId
            : null;

        if (nextSessionId) {
          codexSessionIdsByChannel.set(message.channelId, nextSessionId);
        }

        await updateQueuedReply(
          queuedReply,
          (replyMessage) => message.reply(replyMessage),
          formatCodexResultUpdate(codexMessage, response),
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Codex prompt failed";
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => message.reply(replyMessage),
          formatCodexResultUpdate(codexMessage, { error: { message: messageText } }),
        );
      }
      return;
    }

    if (routed.type === "denied") {
      await message.reply(formatDenied(routed.reason));
      return;
    }

    const commandMessage = {
      computerDisplayName: channelContext.computerDisplayName,
      workspaceDisplayName: channelContext.workspaceDisplayName,
      cwd: channelContext.cwd,
      command: routed.command,
    };
    const queuedReply = await message.reply(formatCommandAck(commandMessage));

    try {
      const response = await input.submitCommandJob({
        computerId: channelContext.computerId,
        payload: {
          workspaceRoot: channelContext.workspaceRoot,
          cwd: channelContext.cwd,
          command: routed.command,
          timeoutMs: channelContext.timeoutMs,
          confirmedDangerous: routed.confirmedDangerous,
        },
      });
      await recordCommandAudit(input, {
        discordChannelId: message.channelId,
        userId: message.userId,
        cwd: channelContext.cwd,
        rawCommand: routed.command,
        resultStatus: extractResultStatus(response),
      });

      const nextCwd = extractUpdatedCwd(response);

      if (nextCwd) {
        await input.updateChannelCwd({
          discordChannelId: message.channelId,
          cwd: nextCwd,
        });
      }

      await updateQueuedReply(
        queuedReply,
        (replyMessage) => message.reply(replyMessage),
        formatCommandResultUpdate(commandMessage, response),
      );
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Control API request failed";
      await recordCommandAudit(input, {
        discordChannelId: message.channelId,
        userId: message.userId,
        cwd: channelContext.cwd,
        rawCommand: routed.command,
        resultStatus: "failed",
      });
      await updateQueuedReply(
        queuedReply,
        (replyMessage) => message.reply(replyMessage),
        formatCommandResultUpdate(commandMessage, { error: { message: messageText } }),
      );
    }
  }

  return async function handleDiscordMessage(message: DiscordMessageLike): Promise<void> {
    const previousChannelTask = channelQueues.get(message.channelId) ?? Promise.resolve();
    const nextChannelTask = previousChannelTask
      .catch(() => undefined)
      .then(() => processDiscordMessage(message));

    channelQueues.set(message.channelId, nextChannelTask);

    try {
      await nextChannelTask;
    } finally {
      if (channelQueues.get(message.channelId) === nextChannelTask) {
        channelQueues.delete(message.channelId);
      }
    }
  };
}
