import type { PrismaClient } from "@prisma/client";

export interface RecordAuditInput {
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

export async function recordAuditEvent(
  prisma: PrismaClient,
  input: RecordAuditInput,
) {
  return prisma.auditEvent.create({
    data: {
      id: input.id,
      channelId: input.channelId,
      userId: input.userId,
      targetComputerId: input.targetComputerId,
      targetWorkspaceId: input.targetWorkspaceId,
      cwd: input.cwd,
      rawCommand: input.rawCommand,
      tier: input.tier,
      resultStatus: input.resultStatus,
    },
  });
}
