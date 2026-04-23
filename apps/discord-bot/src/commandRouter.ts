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
  | { type: "admin-sync"; limit: number }
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

function parseSyncLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25;
  }

  return Math.min(parsed, 100);
}

function parseAdminSync(content: string): { limit: number } | null {
  const match = content.match(/^(?:codex\s+)?(?:sync|resync)(?:\s+(\d+))?$/i);

  if (!match) {
    return null;
  }

  return { limit: parseSyncLimit(match[1]) };
}

export function routeDiscordMessage(input: RouteDiscordMessageInput): RoutedDiscordMessage {
  const trimmedContent = input.content.trim();

  if (trimmedContent === "help" || trimmedContent === "!help" || trimmedContent === "?") {
    return { type: "bot-help" };
  }

  if (input.channelMode === "shell-admin") {
    const sync = parseAdminSync(trimmedContent);

    if (sync) {
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

      return { type: "admin-sync", limit: sync.limit };
    }
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
