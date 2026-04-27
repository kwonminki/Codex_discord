import type { ChannelMode } from "../../../packages/core/src/index.js";
import type { PrismaClient } from "@prisma/client";
import path from "node:path";

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

export interface ChannelContextService {
  findByDiscordChannelId(discordChannelId: string): Promise<ManagedDiscordChannelContext | null>;
  updateCwdByDiscordChannelId(
    discordChannelId: string,
    cwd: string,
  ): Promise<{ cwd: string } | null>;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    return [];
  }

  return [];
}

function isChannelMode(value: string): value is ChannelMode {
  return value === "shell-admin" || value === "session-linked";
}

function assertCwdInsideWorkspace(workspaceRoot: string, cwd: string): string {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedCwd = path.resolve(cwd);
  const relativePath = path.relative(resolvedWorkspaceRoot, resolvedCwd);

  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("Path escapes workspace root");
  }

  return resolvedCwd;
}

export function createChannelContextService(
  prisma: PrismaClient,
  options: { defaultTimeoutMs?: number } = {},
): ChannelContextService {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 3_000;

  return {
    async findByDiscordChannelId(discordChannelId) {
      const channel = await prisma.managedChannel.findUnique({
        where: { discordChannelId },
        include: {
          workspace: {
            include: {
              computer: true,
            },
          },
        },
      });

      if (!channel || !isChannelMode(channel.channelMode)) {
        return null;
      }

      return {
        channelMode: channel.channelMode,
        allowedRoleIds: parseStringArray(channel.workspace.computer.allowedRoleIds),
        computerId: channel.computerId,
        computerDisplayName: channel.workspace.computer.displayName,
        workspaceDisplayName: channel.workspace.displayName,
        workspaceRoot: channel.workspace.absolutePath,
        cwd: channel.cwd,
        timeoutMs: defaultTimeoutMs,
      };
    },
    async updateCwdByDiscordChannelId(discordChannelId, cwd) {
      const channel = await prisma.managedChannel.findUnique({
        where: { discordChannelId },
        include: { workspace: true },
      });

      if (!channel) {
        return null;
      }

      const nextCwd = assertCwdInsideWorkspace(channel.workspace.absolutePath, cwd);
      const updatedChannel = await prisma.managedChannel.update({
        where: { discordChannelId },
        data: { cwd: nextCwd },
      });

      return { cwd: updatedChannel.cwd };
    },
  };
}
