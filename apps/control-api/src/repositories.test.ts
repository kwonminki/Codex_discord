import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { recordAuditEvent } from "./audit.js";
import { createRepositories } from "./repositories.js";

const tempDatabaseDirectory = mkdtempSync(
  join(tmpdir(), "codex-discord-repositories-"),
);
const databaseUrl = `file:${join(tempDatabaseDirectory, "test.sqlite")}`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

process.env.DATABASE_URL = databaseUrl;
closeSync(openSync(join(tempDatabaseDirectory, "test.sqlite"), "w"));

execFileSync("pnpm", ["prisma", "db", "push", "--skip-generate"], {
  cwd: repoRoot,
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: "pipe",
});

const prisma = new PrismaClient();

describe("repositories", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.managedChannel.updateMany({
      data: { currentSessionLinkId: null },
    });
    await prisma.codexSessionLink.deleteMany();
    await prisma.managedChannel.deleteMany();
    await prisma.categoryMapping.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.computer.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(tempDatabaseDirectory, { force: true, recursive: true });
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

  it("rejects channel creation when workspace belongs to another computer", async () => {
    const repos = createRepositories(prisma);

    await repos.computers.upsertHeartbeat({
      id: "computer-1",
      displayName: "macbook-pro-01",
      hostname: "macbook-pro-01.local",
      allowedRoleIds: ["role-operator"],
      capabilities: ["shell", "codex-import"],
    });
    await repos.computers.upsertHeartbeat({
      id: "computer-2",
      displayName: "macbook-pro-02",
      hostname: "macbook-pro-02.local",
      allowedRoleIds: ["role-operator"],
      capabilities: ["shell", "codex-import"],
    });

    const workspace = await repos.workspaces.create({
      id: "workspace-1",
      computerId: "computer-1",
      absolutePath: "/Users/me/project",
      displayName: "project",
    });

    await expect(
      repos.channels.create({
        id: "channel-1",
        discordChannelId: "discord-channel-1",
        computerId: "computer-2",
        workspaceId: workspace.id,
        channelMode: "shell-admin",
        cwd: "/Users/me/project",
      }),
    ).rejects.toThrow(
      "Cannot create channel for computer computer-2 in workspace workspace-1 owned by computer computer-1.",
    );
  });

  it("rejects direct channel writes when workspace belongs to another computer", async () => {
    await prisma.computer.createMany({
      data: [
        {
          id: "computer-1",
          displayName: "macbook-pro-01",
          hostname: "macbook-pro-01.local",
          status: "online",
          allowedRoleIds: "[]",
          capabilities: "[]",
        },
        {
          id: "computer-2",
          displayName: "macbook-pro-02",
          hostname: "macbook-pro-02.local",
          status: "online",
          allowedRoleIds: "[]",
          capabilities: "[]",
        },
      ],
    });
    await prisma.workspace.create({
      data: {
        id: "workspace-1",
        computerId: "computer-1",
        absolutePath: "/Users/me/project",
        displayName: "project",
        status: "valid",
      },
    });

    await expect(
      prisma.managedChannel.create({
        data: {
          id: "channel-1",
          discordChannelId: "discord-channel-1",
          computerId: "computer-2",
          workspaceId: "workspace-1",
          channelMode: "shell-admin",
          cwd: "/Users/me/project",
          status: "created",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects direct category mapping writes when workspace belongs to another computer", async () => {
    await prisma.computer.createMany({
      data: [
        {
          id: "computer-1",
          displayName: "macbook-pro-01",
          hostname: "macbook-pro-01.local",
          status: "online",
          allowedRoleIds: "[]",
          capabilities: "[]",
        },
        {
          id: "computer-2",
          displayName: "macbook-pro-02",
          hostname: "macbook-pro-02.local",
          status: "online",
          allowedRoleIds: "[]",
          capabilities: "[]",
        },
      ],
    });
    await prisma.workspace.create({
      data: {
        id: "workspace-1",
        computerId: "computer-1",
        absolutePath: "/Users/me/project",
        displayName: "project",
        status: "valid",
      },
    });

    await expect(
      prisma.categoryMapping.create({
        data: {
          id: "category-1",
          discordCategoryId: "discord-category-1",
          computerId: "computer-2",
          workspaceId: "workspace-1",
          syncStatus: "created",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects setting a current session link from another channel", async () => {
    await prisma.computer.create({
      data: {
        id: "computer-1",
        displayName: "macbook-pro-01",
        hostname: "macbook-pro-01.local",
        status: "online",
        allowedRoleIds: "[]",
        capabilities: "[]",
      },
    });
    await prisma.workspace.create({
      data: {
        id: "workspace-1",
        computerId: "computer-1",
        absolutePath: "/Users/me/project",
        displayName: "project",
        status: "valid",
      },
    });
    await prisma.managedChannel.createMany({
      data: [
        {
          id: "channel-a",
          discordChannelId: "discord-channel-a",
          computerId: "computer-1",
          workspaceId: "workspace-1",
          channelMode: "session-linked",
          cwd: "/Users/me/project",
          status: "created",
        },
        {
          id: "channel-b",
          discordChannelId: "discord-channel-b",
          computerId: "computer-1",
          workspaceId: "workspace-1",
          channelMode: "session-linked",
          cwd: "/Users/me/project",
          status: "created",
        },
      ],
    });
    await prisma.codexSessionLink.create({
      data: {
        id: "session-link-a",
        channelId: "channel-a",
        codexSessionId: "codex-session-a",
        origin: "created",
        threadNameSnapshot: "thread-a",
        attachedAt: new Date(),
        availabilityStatus: "available",
      },
    });

    await expect(
      prisma.managedChannel.update({
        where: { id: "channel-b" },
        data: { currentSessionLinkId: "session-link-a" },
      }),
    ).rejects.toThrow();
  });
});
