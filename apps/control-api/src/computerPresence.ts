import type { PrismaClient } from "@prisma/client";

export interface AdvertisedWorkspace {
  id: string;
  absolutePath: string;
  displayName: string;
}

export interface ComputerPresenceHeartbeatInput {
  id: string;
  displayName: string;
  hostname: string;
  allowedRoleIds: string[];
  capabilities: string[];
  workspaces: AdvertisedWorkspace[];
}

export interface ComputerPresenceService {
  upsertHeartbeat(input: ComputerPresenceHeartbeatInput): Promise<void>;
  markOffline(computerId: string): Promise<void>;
}

export function createComputerPresenceService(prisma: PrismaClient): ComputerPresenceService {
  return {
    async upsertHeartbeat(input) {
      await prisma.$transaction(async (tx) => {
        await tx.computer.upsert({
          where: { id: input.id },
          update: {
            displayName: input.displayName,
            hostname: input.hostname,
            status: "online",
            allowedRoleIds: JSON.stringify(input.allowedRoleIds),
            capabilities: JSON.stringify(input.capabilities),
            lastHeartbeatAt: new Date(),
          },
          create: {
            id: input.id,
            displayName: input.displayName,
            hostname: input.hostname,
            status: "online",
            allowedRoleIds: JSON.stringify(input.allowedRoleIds),
            capabilities: JSON.stringify(input.capabilities),
            lastHeartbeatAt: new Date(),
          },
        });

        for (const workspace of input.workspaces) {
          const existingWorkspace = await tx.workspace.findUnique({
            where: { id: workspace.id },
            select: { computerId: true },
          });

          if (existingWorkspace && existingWorkspace.computerId !== input.id) {
            throw new Error(
              `Workspace ${workspace.id} is already owned by computer ${existingWorkspace.computerId}.`,
            );
          }

          await tx.workspace.upsert({
            where: { id: workspace.id },
            update: {
              absolutePath: workspace.absolutePath,
              displayName: workspace.displayName,
              status: "valid",
            },
            create: {
              id: workspace.id,
              computerId: input.id,
              absolutePath: workspace.absolutePath,
              displayName: workspace.displayName,
              status: "valid",
            },
          });
        }
      });
    },
    async markOffline(computerId) {
      await prisma.computer.updateMany({
        where: { id: computerId },
        data: { status: "offline" },
      });
    },
  };
}
