import type { PrismaClient } from "@prisma/client";

export interface ComputerHeartbeatInput {
  id: string;
  displayName: string;
  hostname: string;
  allowedRoleIds: string[];
  capabilities: string[];
}

export interface WorkspaceCreateInput {
  id: string;
  computerId: string;
  absolutePath: string;
  displayName: string;
}

export interface ManagedChannelCreateInput {
  id: string;
  discordChannelId: string;
  computerId: string;
  workspaceId: string;
  channelMode: "shell-admin" | "session-linked";
  cwd: string;
}

export function createRepositories(prisma: PrismaClient) {
  return {
    computers: {
      upsertHeartbeat(input: ComputerHeartbeatInput) {
        return prisma.computer.upsert({
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
      },
    },
    workspaces: {
      create(input: WorkspaceCreateInput) {
        return prisma.workspace.create({
          data: {
            id: input.id,
            computerId: input.computerId,
            absolutePath: input.absolutePath,
            displayName: input.displayName,
            status: "valid",
          },
        });
      },
    },
    channels: {
      create(input: ManagedChannelCreateInput) {
        return prisma.managedChannel.create({
          data: {
            id: input.id,
            discordChannelId: input.discordChannelId,
            computerId: input.computerId,
            workspaceId: input.workspaceId,
            channelMode: input.channelMode,
            cwd: input.cwd,
            status: "created",
          },
        });
      },
      findByDiscordChannelId(discordChannelId: string) {
        return prisma.managedChannel.findUnique({ where: { discordChannelId } });
      },
    },
  };
}
