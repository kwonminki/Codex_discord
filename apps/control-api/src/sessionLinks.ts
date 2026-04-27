import type { SessionOrigin } from "../../../packages/core/src/index.js";
import type { PrismaClient } from "@prisma/client";

export interface LinkCodexSessionInput {
  discordChannelId: string;
  id: string;
  codexSessionId: string;
  origin: SessionOrigin;
  threadNameSnapshot: string;
}

export interface LinkedCodexSession {
  id: string;
  channelId: string;
  codexSessionId: string;
  origin: string;
  threadNameSnapshot: string;
  availabilityStatus: string;
}

export interface SessionLinkService {
  linkCodexSessionToDiscordChannel(input: LinkCodexSessionInput): Promise<LinkedCodexSession | null>;
}

export function createSessionLinkService(prisma: PrismaClient): SessionLinkService {
  return {
    async linkCodexSessionToDiscordChannel(input) {
      return prisma.$transaction(async (tx) => {
        const channel = await tx.managedChannel.findUnique({
          where: { discordChannelId: input.discordChannelId },
          select: { id: true },
        });

        if (!channel) {
          return null;
        }

        const link = await tx.codexSessionLink.create({
          data: {
            id: input.id,
            channelId: channel.id,
            codexSessionId: input.codexSessionId,
            origin: input.origin,
            threadNameSnapshot: input.threadNameSnapshot,
            attachedAt: new Date(),
            availabilityStatus: "available",
          },
        });

        await tx.managedChannel.update({
          where: { id: channel.id },
          data: {
            currentSessionLinkId: link.id,
            status: "attached",
          },
        });

        return {
          id: link.id,
          channelId: link.channelId,
          codexSessionId: link.codexSessionId,
          origin: link.origin,
          threadNameSnapshot: link.threadNameSnapshot,
          availabilityStatus: link.availabilityStatus,
        };
      });
    },
  };
}
