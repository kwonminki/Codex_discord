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
  it("submits an authorized shell command to the control api and edits the queued reply with the result", async () => {
    const replies: string[] = [];
    const edits: string[] = [];
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
        return {
          edit: async (nextMessage: string) => {
            edits.push(nextMessage);
          },
        };
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
    ]);
    expect(edits).toEqual([
      [
        "Target: `macbook-pro-01` / `repo`",
        "cwd: `/repo`",
        "command: `ls`",
        "state: `completed`",
        "exit: `0`",
        "stdout: `README.md `",
        "stderr: ``",
      ].join("\n"),
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

  it("serializes command execution per Discord channel", async () => {
    const firstJob = {
      resolve: null as ((value: unknown) => void) | null,
    };
    const submitCommandJob = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            firstJob.resolve = resolve;
          }),
      )
      .mockResolvedValueOnce({
        jobId: "job-2",
        result: {
          status: "completed",
          stdout: "second\n",
          stderr: "",
          exitCode: 0,
        },
      });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });
    const first = handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "pwd",
      roleIds: ["role-operator"],
      reply: async () => {},
    });
    const second = handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "ls",
      roleIds: ["role-operator"],
      reply: async () => {},
    });

    for (let attempt = 0; attempt < 5 && submitCommandJob.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(submitCommandJob).toHaveBeenCalledTimes(1);

    if (!firstJob.resolve) {
      throw new Error("Expected first job resolver to be captured");
    }

    firstJob.resolve({
      jobId: "job-1",
      result: {
        status: "completed",
        stdout: "/repo\n",
        stderr: "",
        exitCode: 0,
      },
    });

    await first;
    await second;

    expect(submitCommandJob).toHaveBeenCalledTimes(2);
    expect(submitCommandJob.mock.calls[0][0].payload.command).toBe("pwd");
    expect(submitCommandJob.mock.calls[1][0].payload.command).toBe("ls");
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
