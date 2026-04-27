import type { ChannelMode } from "../../../packages/core/src/index.js";
import type { PrismaClient } from "@prisma/client";

export interface CategoryMappingCreateInput {
  id: string;
  discordCategoryId: string;
  computerId: string;
  workspaceId: string;
}

export interface ManagedChannelCreateInput {
  id: string;
  discordChannelId: string;
  computerId: string;
  workspaceId: string;
  channelMode: ChannelMode;
}

export interface WorkspaceMappingService {
  createCategoryMapping(input: CategoryMappingCreateInput): Promise<{
    id: string;
    discordCategoryId: string;
    computerId: string;
    workspaceId: string;
    syncStatus: string;
  }>;
  createManagedChannel(input: ManagedChannelCreateInput): Promise<{
    id: string;
    discordChannelId: string;
    computerId: string;
    workspaceId: string;
    channelMode: string;
    cwd: string;
    status: string;
  }>;
}

async function assertWorkspaceOwnedByComputer(
  prisma: PrismaClient,
  input: { workspaceId: string; computerId: string },
) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { computerId: true, absolutePath: true },
  });

  if (!workspace) {
    throw new Error(`Workspace ${input.workspaceId} does not exist.`);
  }

  if (workspace.computerId !== input.computerId) {
    throw new Error(
      `Cannot map workspace ${input.workspaceId} for computer ${input.computerId}; workspace is owned by computer ${workspace.computerId}.`,
    );
  }

  return workspace;
}

export function createWorkspaceMappingService(prisma: PrismaClient): WorkspaceMappingService {
  return {
    async createCategoryMapping(input) {
      await assertWorkspaceOwnedByComputer(prisma, input);

      return prisma.categoryMapping.create({
        data: {
          id: input.id,
          discordCategoryId: input.discordCategoryId,
          computerId: input.computerId,
          workspaceId: input.workspaceId,
          syncStatus: "created",
        },
      });
    },
    async createManagedChannel(input) {
      const workspace = await assertWorkspaceOwnedByComputer(prisma, input);

      return prisma.managedChannel.create({
        data: {
          id: input.id,
          discordChannelId: input.discordChannelId,
          computerId: input.computerId,
          workspaceId: input.workspaceId,
          channelMode: input.channelMode,
          cwd: workspace.absolutePath,
          status: "created",
        },
      });
    },
  };
}
