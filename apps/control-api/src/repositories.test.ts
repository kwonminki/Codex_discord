import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAuditEvent } from "./audit.js";
import { createRepositories } from "./repositories.js";

process.env.DATABASE_URL ??= "file:./dev.sqlite";

const prisma = new PrismaClient();

describe("repositories", () => {
  beforeAll(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.codexSessionLink.deleteMany();
    await prisma.managedChannel.deleteMany();
    await prisma.categoryMapping.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.computer.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("registers a computer, workspace, and channel", async () => {
    const repos = createRepositories(prisma);

    await repos.computers.upsertHeartbeat({
      id: "computer-1",
      displayName: "macbook-pro-01",
      hostname: "macbook-pro-01.local",
      allowedRoleIds: ["role-operator"],
      capabilities: ["shell", "codex-import"],
    });

    const workspace = await repos.workspaces.create({
      id: "workspace-1",
      computerId: "computer-1",
      absolutePath: "/Users/me/project",
      displayName: "project",
    });

    const channel = await repos.channels.create({
      id: "channel-1",
      discordChannelId: "discord-channel-1",
      computerId: "computer-1",
      workspaceId: workspace.id,
      channelMode: "shell-admin",
      cwd: "/Users/me/project",
    });

    expect(channel.status).toBe("created");
    expect(channel.cwd).toBe("/Users/me/project");

    const foundChannel = await repos.channels.findByDiscordChannelId(
      "discord-channel-1",
    );
    expect(foundChannel?.id).toBe(channel.id);

    const auditEvent = await recordAuditEvent(prisma, {
      id: "audit-1",
      channelId: channel.id,
      userId: "discord-user-1",
      targetComputerId: "computer-1",
      targetWorkspaceId: workspace.id,
      cwd: "/Users/me/project",
      rawCommand: "pwd",
      tier: "safe",
      resultStatus: "success",
    });

    expect(auditEvent.resultStatus).toBe("success");
    expect(auditEvent.channelId).toBe(channel.id);
  });
});
