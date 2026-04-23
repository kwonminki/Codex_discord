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
  | { type: "execute-command"; command: string }
  | { type: "codex-chat"; content: string }
  | { type: "denied"; reason: string };

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

  return { type: "execute-command", command: parsed.command };
}
