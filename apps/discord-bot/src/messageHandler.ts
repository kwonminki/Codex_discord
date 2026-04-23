import type { ChannelMode } from "@codex-discord/core";
import type { ControlApiClient } from "./controlApiClient.js";
import { routeDiscordMessage } from "./commandRouter.js";
import { formatCommandAck, formatCommandResult, formatDenied } from "./responses.js";

export interface ManagedDiscordChannelContext {
  channelMode: ChannelMode;
  allowedRoleIds: string[];
  computerId: string;
  computerDisplayName: string;
  workspaceDisplayName: string;
  workspaceRoot: string;
  cwd: string;
  timeoutMs: number;
}

export interface DiscordMessageLike {
  authorBot: boolean;
  channelId: string;
  content: string;
  roleIds: string[];
  reply(message: string): Promise<void>;
}

export interface CreateDiscordMessageHandlerInput {
  resolveChannelContext(channelId: string): ManagedDiscordChannelContext | null;
  submitCommandJob: ControlApiClient["submitCommandJob"];
}

export function createDiscordMessageHandler(input: CreateDiscordMessageHandlerInput) {
  return async function handleDiscordMessage(message: DiscordMessageLike): Promise<void> {
    if (message.authorBot) {
      return;
    }

    const channelContext = input.resolveChannelContext(message.channelId);

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
      await message.reply(formatCommandResult(response));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Control API request failed";
      await message.reply(formatCommandResult({ error: { message: messageText } }));
    }
  };
}
