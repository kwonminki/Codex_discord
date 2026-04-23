import { classifyCommand } from "@codex-discord/core";
import type { ManagedDiscordChannelContext } from "./channelContext.js";
import type { ControlApiClient } from "./controlApiClient.js";
import { routeDiscordMessage } from "./commandRouter.js";
import { formatCommandAck, formatCommandResult, formatDenied } from "./responses.js";

export type { ManagedDiscordChannelContext } from "./channelContext.js";

export interface DiscordMessageLike {
  authorBot: boolean;
  userId: string;
  channelId: string;
  content: string;
  roleIds: string[];
  reply(message: string): Promise<void>;
}

export interface CreateDiscordMessageHandlerInput {
  resolveChannelContext(channelId: string): Promise<ManagedDiscordChannelContext | null>;
  submitCommandJob: ControlApiClient["submitCommandJob"];
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

export function createDiscordMessageHandler(input: CreateDiscordMessageHandlerInput) {
  return async function handleDiscordMessage(message: DiscordMessageLike): Promise<void> {
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

    if (routed.type === "codex-chat") {
      await message.reply("Codex chat is not connected in this MVP slice. Use `!` commands for operations.");
      return;
    }

    if (routed.type === "denied") {
      await message.reply(formatDenied(routed.reason));
      return;
    }

    await message.reply(
      formatCommandAck({
        computerDisplayName: channelContext.computerDisplayName,
        workspaceDisplayName: channelContext.workspaceDisplayName,
        cwd: channelContext.cwd,
        command: routed.command,
      }),
    );

    try {
      const response = await input.submitCommandJob({
        computerId: channelContext.computerId,
        payload: {
          workspaceRoot: channelContext.workspaceRoot,
          cwd: channelContext.cwd,
          command: routed.command,
          timeoutMs: channelContext.timeoutMs,
          confirmedDangerous: false,
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

      await message.reply(formatCommandResult(response));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Control API request failed";
      await recordCommandAudit(input, {
        discordChannelId: message.channelId,
        userId: message.userId,
        cwd: channelContext.cwd,
        rawCommand: routed.command,
        resultStatus: "failed",
      });
      await message.reply(formatCommandResult({ error: { message: messageText } }));
    }
  };
}
