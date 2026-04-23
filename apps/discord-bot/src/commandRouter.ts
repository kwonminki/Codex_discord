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
  const parsed = parseDiscordMessageCommand({
    mode: input.channelMode,
    content: input.content,
  });

  if (parsed.kind === "chat") {
    return { type: "codex-chat", content: parsed.content };
  }

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

  const confirmedCommand = parseExplicitConfirmation(parsed.command);

  return {
    type: "execute-command",
    command: confirmedCommand.command,
    confirmedDangerous: confirmedCommand.confirmedDangerous,
  };
}
