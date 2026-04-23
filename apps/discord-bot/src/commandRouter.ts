import {
  authorizeCommand,
  parseDiscordMessageCommand,
  type ChannelMode,
} from "@codex-discord/core";

export interface RouteDiscordMessageInput {
  channelMode: ChannelMode;
  content: string;
  userRoleIds: string[];
  allowedRoleIds: string[];
}

export type RoutedDiscordMessage =
  | { type: "execute-command"; command: string; confirmedDangerous: boolean }
  | { type: "codex-chat"; content: string }
  | { type: "bot-help" }
  | { type: "denied"; reason: string };

function parseExplicitConfirmation(command: string): { command: string; confirmedDangerous: boolean } {
  const trimmedCommand = command.trim();

  if (!trimmedCommand.startsWith("confirm ")) {
    return { command: trimmedCommand, confirmedDangerous: false };
  }

  return {
    command: trimmedCommand.slice("confirm ".length).trim(),
    confirmedDangerous: true,
  };
}

export function routeDiscordMessage(input: RouteDiscordMessageInput): RoutedDiscordMessage {
  const trimmedContent = input.content.trim();

  if (trimmedContent === "help" || trimmedContent === "!help" || trimmedContent === "?") {
    return { type: "bot-help" };
  }

  if (input.channelMode === "shell-admin" && trimmedContent.startsWith("codex ")) {
    const authorization = authorizeCommand({
      userRoleIds: input.userRoleIds,
      allowedRoleIds: input.allowedRoleIds,
    });

    if (!authorization.allowed) {
      return {
        type: "denied",
        reason: authorization.reason ?? "User does not have an allowed role",
      };
    }

    return { type: "codex-chat", content: trimmedContent.slice("codex ".length).trim() };
  }

  const parsed = parseDiscordMessageCommand({
    mode: input.channelMode,
    content: trimmedContent,
  });

  const authorization = authorizeCommand({
    userRoleIds: input.userRoleIds,
    allowedRoleIds: input.allowedRoleIds,
  });

  if (!authorization.allowed) {
    return {
      type: "denied",
      reason: authorization.reason ?? "User does not have an allowed role",
    };
  }

  if (parsed.kind === "chat") {
    return { type: "codex-chat", content: parsed.content };
  }

  const confirmedCommand = parseExplicitConfirmation(parsed.command);

  return {
    type: "execute-command",
    command: confirmedCommand.command,
    confirmedDangerous: confirmedCommand.confirmedDangerous,
  };
}
