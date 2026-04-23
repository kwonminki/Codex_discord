import { describe, expect, it, vi } from "vitest";
import { createDiscordMessageHandler, type ManagedDiscordChannelContext } from "./messageHandler.js";

const channelContext: ManagedDiscordChannelContext = {
  channelMode: "shell-admin",
  allowedRoleIds: ["role-operator"],
  computerId: "computer-1",
  computerDisplayName: "macbook-pro-01",
  workspaceDisplayName: "repo",
  workspaceRoot: "/repo",
  cwd: "/repo",
  timeoutMs: 3_000,
};

describe("createDiscordMessageHandler", () => {
  it("submits an authorized shell command to the control api and replies with the result", async () => {
    const replies: string[] = [];
    const submitCommandJob = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        stdout: "README.md\n",
        stderr: "",
        exitCode: 0,
        cwd: "/repo/src",
      },
    });
    const updateChannelCwd = vi.fn().mockResolvedValue({ cwd: "/repo/src" });
    const recordCommandAudit = vi.fn().mockResolvedValue({ id: "audit-1" });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob,
      updateChannelCwd,
      recordCommandAudit,
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "ls",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(submitCommandJob).toHaveBeenCalledWith({
      computerId: "computer-1",
      payload: {
        workspaceRoot: "/repo",
        cwd: "/repo",
        command: "ls",
        timeoutMs: 3_000,
        confirmedDangerous: false,
      },
    });
    expect(updateChannelCwd).toHaveBeenCalledWith({
      discordChannelId: "discord-channel-1",
      cwd: "/repo/src",
    });
    expect(recordCommandAudit).toHaveBeenCalledWith({
      discordChannelId: "discord-channel-1",
      userId: "discord-user-1",
      cwd: "/repo",
      rawCommand: "ls",
      tier: "safe-read",
      resultStatus: "completed",
    });
    expect(replies).toEqual([
      [
        "Target: `macbook-pro-01` / `repo`",
        "cwd: `/repo`",
        "command: `ls`",
        "state: queued",
      ].join("\n"),
      ["state: `completed`", "exit: `0`", "stdout: `README.md `", "stderr: ``"].join("\n"),
    ]);
  });

  it("denies unauthorized command execution without submitting a job", async () => {
    const replies: string[] = [];
    const submitCommandJob = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "ls",
      roleIds: ["role-viewer"],
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(submitCommandJob).not.toHaveBeenCalled();
    expect(replies).toEqual(["Permission denied: `User does not have an allowed role`"]);
  });

  it("passes explicit dangerous command confirmation to the control api", async () => {
    const submitCommandJob = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        stdout: "",
        stderr: "",
        exitCode: 0,
      },
    });
    const recordCommandAudit = vi.fn().mockResolvedValue({ id: "audit-1" });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob,
      updateChannelCwd: vi.fn(),
      recordCommandAudit,
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "confirm rm README.md",
      roleIds: ["role-operator"],
      reply: async () => {},
    });

    expect(submitCommandJob).toHaveBeenCalledWith({
      computerId: "computer-1",
      payload: {
        workspaceRoot: "/repo",
        cwd: "/repo",
        command: "rm README.md",
        timeoutMs: 3_000,
        confirmedDangerous: true,
      },
    });
    expect(recordCommandAudit).toHaveBeenCalledWith({
      discordChannelId: "discord-channel-1",
      userId: "discord-user-1",
      cwd: "/repo",
      rawCommand: "rm README.md",
      tier: "dangerous-mutate",
      resultStatus: "completed",
    });
  });

  it("ignores bot and unmanaged channel messages", async () => {
    const submitCommandJob = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => null,
      submitCommandJob,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });
    const reply = vi.fn();

    await handleMessage({
      authorBot: true,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "ls",
      roleIds: ["role-operator"],
      reply,
    });
    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "unmanaged-channel",
      content: "ls",
      roleIds: ["role-operator"],
      reply,
    });

    expect(reply).not.toHaveBeenCalled();
    expect(submitCommandJob).not.toHaveBeenCalled();
  });
});
