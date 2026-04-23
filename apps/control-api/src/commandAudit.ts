import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export interface RecordDiscordCommandAuditInput {
  discordChannelId: string;
  userId: string;
  cwd: string | null;
  rawCommand: string;
  tier: string;
  resultStatus: string;
}

export interface CommandAuditRecord {
  id: string;
  channelId: string | null;
  userId: string;
  targetComputerId: string;
  targetWorkspaceId: string | null;
  cwd: string | null;
  rawCommand: string;
  tier: string;
  resultStatus: string;
}

export interface CommandAuditService {
  recordForDiscordChannel(input: RecordDiscordCommandAuditInput): Promise<CommandAuditRecord | null>;
}

export function createCommandAuditService(prisma: PrismaClient): CommandAuditService {
  return {
    async recordForDiscordChannel(input) {
      const channel = await prisma.managedChannel.findUnique({
        where: { discordChannelId: input.discordChannelId },
        select: {
          id: true,
          computerId: true,
          workspaceId: true,
        },
      });

      if (!channel) {
        return null;
      }

      return prisma.auditEvent.create({
        data: {
          id: randomUUID(),
          channelId: channel.id,
          userId: input.userId,
          targetComputerId: channel.computerId,
          targetWorkspaceId: channel.workspaceId,
          cwd: input.cwd,
          rawCommand: input.rawCommand,
          tier: input.tier,
          resultStatus: input.resultStatus,
        },
      });
    },
  };
}
