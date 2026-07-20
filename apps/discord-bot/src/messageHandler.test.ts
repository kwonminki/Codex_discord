import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CODEX_PROMPT_TIMEOUT_MS,
  createDiscordMessageHandler,
  resolveCodexPromptTimeoutMs,
  type ManagedDiscordChannelContext,
} from "./messageHandler.js";

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

const sessionChannelContext: ManagedDiscordChannelContext = {
  ...channelContext,
  channelMode: "session-linked",
  codexSessionId: null,
};

const claudeChannelContext: ManagedDiscordChannelContext = {
  ...channelContext,
  channelMode: "claude-code",
  codexSessionId: null,
};

describe("createDiscordMessageHandler", () => {
  it("uses a long Codex prompt timeout by default while allowing explicit override", () => {
    expect(resolveCodexPromptTimeoutMs(3_000, undefined)).toBe(DEFAULT_CODEX_PROMPT_TIMEOUT_MS);
    expect(resolveCodexPromptTimeoutMs(3_000, "7200000")).toBe(7_200_000);
    expect(resolveCodexPromptTimeoutMs(3_000, "0")).toBe(0);
    expect(resolveCodexPromptTimeoutMs(10_000, "1000")).toBe(10_000);
  });

  it("submits an authorized shell command to the control api and edits the queued reply with the result", async () => {
    const replies: unknown[] = [];
    const edits: unknown[] = [];
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
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
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
          edit: async (nextMessage: unknown) => {
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
      expect.objectContaining({
        allowedMentions: { parse: [] },
        embeds: [
          expect.objectContaining({
            title: "Command queued",
            color: 0xf1c40f,
          }),
        ],
      }),
    ]);
    expect(edits).toEqual([
      expect.objectContaining({
        allowedMentions: { parse: [] },
        embeds: [
          expect.objectContaining({
            title: "Command completed",
            color: 0x2ecc71,
            fields: expect.arrayContaining([
              { name: "Target", value: "`macbook-pro-01` / `repo`", inline: false },
              { name: "Working directory", value: "`/repo/src`", inline: false },
              { name: "Command", value: "```bash\nls\n```", inline: false },
              { name: "Output", value: "```text\nREADME.md\n```", inline: false },
            ]),
          }),
        ],
      }),
    ]);
  });

  it("denies unauthorized command execution without submitting a job", async () => {
    const replies: unknown[] = [];
    const submitCommandJob = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob,
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
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
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: "Permission denied",
            color: 0xe74c3c,
          }),
        ],
      }),
    ]);
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
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
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

  it("clears admin channel messages without submitting a shell command", async () => {
    const replies: unknown[] = [];
    const clearMessages = vi.fn().mockResolvedValue({
      deletedCount: 25,
      requestedCount: 25,
    });
    const submitCommandJob = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob,
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "clear 25",
      roleIds: ["role-operator"],
      clearMessages,
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(submitCommandJob).not.toHaveBeenCalled();
    expect(clearMessages).toHaveBeenCalledWith({ mode: "count", count: 25 });
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: "Messages cleared",
            color: 0x2ecc71,
          }),
        ],
      }),
    ]);
  });

  it("requires confirmation before clearing all admin channel messages", async () => {
    const replies: unknown[] = [];
    const clearMessages = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "clear",
      roleIds: ["role-operator"],
      clearMessages,
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(clearMessages).not.toHaveBeenCalled();
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: "Clear confirmation required",
            color: 0xf1c40f,
          }),
        ],
      }),
    ]);
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
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
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
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
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

  it("submits a Codex prompt and edits the queued reply with the answer", async () => {
    const replies: unknown[] = [];
    const edits: unknown[] = [];
    const submitCommandJob = vi.fn();
    const submitCodexPrompt = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "이 프로젝트는 Discord에서 Codex를 제어하는 브리지입니다.",
        sessionId: "codex-session-1",
      },
    });
    const markDiscordRequestedCodexSession = vi.fn().mockResolvedValue(undefined);
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob,
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      markDiscordRequestedCodexSession,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "codex 이 프로젝트 설명해줘",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
        return {
          edit: async (nextMessage: unknown) => {
            edits.push(nextMessage);
          },
        };
      },
    });

    expect(submitCommandJob).not.toHaveBeenCalled();
    expect(submitCodexPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        computerId: "computer-1",
        payload: expect.objectContaining({
          workspaceRoot: "/repo",
          cwd: "/repo",
          prompt: "이 프로젝트 설명해줘",
          timeoutMs: DEFAULT_CODEX_PROMPT_TIMEOUT_MS,
          sessionId: null,
        }),
        onProgress: expect.any(Function),
      }),
    );
    expect(markDiscordRequestedCodexSession).toHaveBeenCalledWith("codex-session-1");
    expect(replies).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("**Codex 작업 시작**"),
        embeds: [],
      }),
    ]);
    expect(edits).toEqual([
      expect.objectContaining({
        content: "이 프로젝트는 Discord에서 Codex를 제어하는 브리지입니다.",
        embeds: [],
      }),
    ]);
  });

  it("resolves Codex approval requests from Discord buttons while a prompt is running", async () => {
    const replies: unknown[] = [];
    const edits: unknown[] = [];
    let approvalDecision: unknown = null;
    const submitCodexPrompt = vi.fn(async (input) => {
      approvalDecision = await input.onApprovalRequest?.({
        kind: "command",
        title: "명령 실행 권한 요청",
        message: "Codex가 추가 확인이 필요한 명령을 실행하려고 합니다.",
        sessionId: "codex-session-1",
        cwd: "/repo",
        command: "pnpm test",
      });

      return {
        jobId: "job-1",
        result: {
          status: "completed",
          finalMessage: "승인 후 계속 진행했습니다.",
          sessionId: "codex-session-1",
        },
      };
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });
    const reply = async (message: unknown) => {
      replies.push(message);
      return {
        edit: async (nextMessage: unknown) => {
          edits.push(nextMessage);
        },
      };
    };

    const promptTask = handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "codex 테스트 실행해줘",
      roleIds: ["role-operator"],
      reply,
    });

    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(replies[1]).toEqual(
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "명령 실행 권한 요청" })],
        components: expect.any(Array),
      }),
    );

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "__cdc_codex_approval 1 acceptForSession",
      roleIds: ["role-operator"],
      reply,
    });
    await promptTask;

    expect(approvalDecision).toEqual({ decision: "acceptForSession" });
    expect(replies[2]).toEqual(
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "권한 응답 전달됨" })],
      }),
    );
    expect(edits.at(-1)).toEqual(
      expect.objectContaining({
        content: "승인 후 계속 진행했습니다.",
        embeds: [],
      }),
    );
  });

  it("blocks Codex prompts in the admin channel without submitting a Codex job", async () => {
    const replies: unknown[] = [];
    const submitCodexPrompt = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "codex 이 프로젝트 설명해줘",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(submitCodexPrompt).not.toHaveBeenCalled();
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: "이 채널에서는 실행할 수 없습니다",
            description: "main 채널은 운영 전용입니다.",
          }),
        ],
      }),
    ]);
  });

  it("stores a channel model preference and passes it to later Codex prompts", async () => {
    const replies: unknown[] = [];
    const submitCodexPrompt = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "모델 설정이 반영된 응답입니다.",
        sessionId: "codex-session-1",
      },
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "model gpt-5.4",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
      },
    });
    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "codex 이 모델로 답해줘",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Codex model updated" })],
      }),
    ]);
    expect(submitCodexPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          model: "gpt-5.4",
        }),
      }),
    );
  });

  it("uses extra high reasoning by default for Codex prompts", async () => {
    const submitCodexPrompt = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "기본 reasoning 응답입니다.",
        sessionId: "codex-session-1",
      },
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "codex 기본 reasoning 확인해줘",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(submitCodexPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          reasoningEffort: "xhigh",
        }),
      }),
    );
  });

  it("submits explicit Claude Code prompts and resumes the channel Claude session", async () => {
    const replies: unknown[] = [];
    const edits: unknown[] = [];
    const submitClaudePrompt = vi.fn(async (input) => {
      await input.onProgress?.({ type: "thread-started", sessionId: "claude-session-1" });
      await input.onProgress?.({ type: "agent-message", text: "Claude가 작업 중입니다." });
      return {
        jobId: "job-1",
        result: {
          status: "completed",
          finalMessage: "Claude 답변입니다.",
          sessionId: "claude-session-1",
        },
      };
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      submitClaudePrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "claude README 요약해줘",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
        return {
          edit: async (nextMessage: unknown) => {
            edits.push(nextMessage);
          },
        };
      },
    });
    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "claude 이어서 테스트 계획도 잡아줘",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(replies[0]).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("Claude Code 작업 시작"),
      }),
    );
    expect(edits.at(-1)).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("Claude 답변입니다."),
      }),
    );
    expect(submitClaudePrompt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({
          prompt: "README 요약해줘",
          sessionId: null,
        }),
      }),
    );
    expect(submitClaudePrompt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: expect.objectContaining({
          prompt: "이어서 테스트 계획도 잡아줘",
          sessionId: "claude-session-1",
        }),
      }),
    );
  });

  it("submits bare Claude Code channel messages to Claude Code", async () => {
    const submitClaudePrompt = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "Claude 답변입니다.",
        sessionId: "claude-session-1",
      },
    });
    const submitCodexPrompt = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => claudeChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      submitClaudePrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "현재 GPU 사용량 봐봐",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(submitClaudePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          prompt: "현재 GPU 사용량 봐봐",
          sessionId: null,
        }),
      }),
    );
    expect(submitCodexPrompt).not.toHaveBeenCalled();
  });

  it("stores a channel Codex run mode and passes reasoning effort to later prompts", async () => {
    const replies: unknown[] = [];
    const submitCodexPrompt = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "빠른 모드 응답입니다.",
        sessionId: "codex-session-1",
      },
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "fast",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
      },
    });
    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "codex 빠르게 답해줘",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Codex mode updated" })],
      }),
    ]);
    expect(submitCodexPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          reasoningEffort: "low",
        }),
      }),
    );
  });

  it("runs Codex review requests through review mode instead of a slash-command prompt", async () => {
    const submitCodexPrompt = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "리뷰 완료",
        sessionId: "review-session-1",
      },
    });
    const markDiscordRequestedCodexSession = vi.fn().mockResolvedValue(undefined);
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      markDiscordRequestedCodexSession,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "__cdc_codex_review 보안 위험 위주",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(submitCodexPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          mode: "review",
          prompt: "보안 위험 위주",
        }),
      }),
    );
    expect(markDiscordRequestedCodexSession).toHaveBeenCalledWith("review-session-1");
  });

  it("creates a new pending Codex chat channel from the admin channel", async () => {
    const replies: unknown[] = [];
    const edits: unknown[] = [];
    const createNewCodexChat = vi.fn().mockResolvedValue({
      discordChannelId: "new-channel-1",
      discordCategoryId: null,
      channelName: "general-codex-chat",
      threadName: "General Codex chat",
      cwd: "/repo",
      workspaceRoot: "/repo",
      workspaceDisplayName: "General Chat",
      pendingSession: true,
      initialPrompt: null,
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      createNewCodexChat,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "chat new",
      roleIds: ["role-operator"],
      guild: {
        createCategory: vi.fn(),
        createTextChannel: vi.fn(),
      },
      reply: async (message) => {
        replies.push(message);
        return {
          edit: async (nextMessage: unknown) => {
            edits.push(nextMessage);
          },
        };
      },
    });

    expect(createNewCodexChat).toHaveBeenCalledWith({
      guild: expect.any(Object),
      name: null,
      cwd: null,
      currentCwd: channelContext.cwd,
      useCategory: false,
      initialPrompt: null,
    });
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Creating Codex chat" })],
      }),
    ]);
    expect(edits).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Codex chat channel ready" })],
      }),
    ]);
  });

  it("creates scheduled commands through the message handler", async () => {
    const replies: unknown[] = [];
    const scheduleCommand = vi.fn().mockResolvedValue({
      status: "created",
      schedule: {
        id: "sched-1",
        channelId: "discord-channel-1",
        userId: "discord-user-1",
        roleIds: ["role-operator"],
        command: "shell pwd",
        schedule: { type: "interval", everyMs: 600_000 },
        enabled: true,
        nextRunAt: "2026-04-24T01:10:00.000Z",
        createdAt: "2026-04-24T01:00:00.000Z",
        updatedAt: "2026-04-24T01:00:00.000Z",
        runCount: 0,
      },
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      scheduleCommand,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "schedule every 10m command:shell pwd",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(scheduleCommand).toHaveBeenCalledWith({
      request: {
        action: "create",
        mode: "every",
        every: "10m",
        command: "shell pwd",
      },
      channelId: "discord-channel-1",
      userId: "discord-user-1",
      roleIds: ["role-operator"],
    });
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Schedule created" })],
      }),
    ]);
  });

  it("links a pending new-chat channel to the Codex session opened by the first prompt", async () => {
    const pendingSessionChannelContext: ManagedDiscordChannelContext = {
      ...channelContext,
      channelMode: "session-linked",
      workspaceDisplayName: "General Chat",
      codexSessionId: null,
    };
    const linkNewCodexSession = vi.fn().mockResolvedValue(undefined);
    const submitCodexPrompt = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "새 채팅을 시작했습니다.",
        sessionId: "session-new",
      },
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => pendingSessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      linkNewCodexSession,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "new-channel-1",
      content: "첫 작업 시작해줘",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(submitCodexPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          sessionId: null,
        }),
      }),
    );
    expect(linkNewCodexSession).toHaveBeenCalledWith({
      discordChannelId: "new-channel-1",
      codexSessionId: "session-new",
      threadName: "첫 작업 시작해줘",
    });
  });

  it("uses a synced channel's Codex session id when submitting a session-linked prompt", async () => {
    const sessionChannelContext: ManagedDiscordChannelContext = {
      ...channelContext,
      channelMode: "session-linked",
      codexSessionId: "session-1",
    };
    const submitCodexPrompt = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "이어받았습니다.",
        sessionId: "session-1",
      },
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "session-channel-1",
      content: "이전 작업 이어서 요약해줘",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(submitCodexPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          prompt: "이전 작업 이어서 요약해줘",
          sessionId: "session-1",
        }),
      }),
    );
  });

  it("continues a completed Codex session from an admin notification reply", async () => {
    const sessionId = "019db2be-b2b3-7e82-9e61-8c84b28ad287";
    const submitCodexPrompt = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "요청한 후속 작업을 완료했습니다.",
        sessionId,
      },
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });
    const content = `__cdc_codex_continue ${encodeURIComponent(JSON.stringify({
      sessionId,
      prompt: "마저 테스트해줘",
    }))}`;

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "admin-channel-1",
      content,
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(submitCodexPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          prompt: "마저 테스트해줘",
          sessionId,
        }),
      }),
    );
  });

  it("refreshes a synced channel transcript before resuming chat in on-chat mode", async () => {
    const sessionChannelContext: ManagedDiscordChannelContext = {
      ...channelContext,
      channelMode: "session-linked",
      codexSessionId: "session-1",
    };
    const guild = {
      createCategory: vi.fn(),
      createTextChannel: vi.fn(),
      deleteChannel: vi.fn(),
      deleteCategory: vi.fn(),
    };
    const syncTranscriptUpdates = vi.fn().mockResolvedValue({
      checkedChannels: 1,
      updatedChannels: 1,
      postedMessages: 1,
      skippedByMode: false,
      mode: "on-chat",
    });
    const submitCodexPrompt = vi.fn().mockResolvedValue({
      jobId: "job-1",
      result: {
        status: "completed",
        finalMessage: "이어받았습니다.",
        sessionId: "session-1",
      },
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      syncTranscriptUpdates,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "session-channel-1",
      content: "이전 작업 이어서 요약해줘",
      roleIds: ["role-operator"],
      guild,
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(syncTranscriptUpdates).toHaveBeenCalledWith({
      guild,
      discordChannelId: "session-channel-1",
      trigger: "on-chat",
    });
    expect(syncTranscriptUpdates.mock.invocationCallOrder[0]).toBeLessThan(
      submitCodexPrompt.mock.invocationCallOrder[0],
    );
  });

  it("edits the queued Codex reply with streaming progress before the final answer", async () => {
    const edits: unknown[] = [];
    const submitCodexPrompt = vi
      .fn()
      .mockImplementation(
        async (input: { onProgress?: (event: { type: string; sessionId?: string; text?: string }) => Promise<void> | void }) => {
          await input.onProgress?.({ type: "thread-started", sessionId: "session-1" });
          await input.onProgress?.({ type: "agent-message", text: "중간 답변을 작성 중입니다." });

          return {
            jobId: "job-1",
            result: {
              status: "completed",
              finalMessage: "최종 답변입니다.",
              sessionId: "session-1",
            },
          };
        },
    );
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "codex 진행상황 보여줘",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async (nextMessage: unknown) => {
          edits.push(nextMessage);
        },
      }),
    });

    expect(edits).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("진행: 세션 연결됨"),
        embeds: [],
      }),
      expect.objectContaining({
        content: expect.stringContaining("생각과 중간 출력은 버튼으로 열 수 있습니다."),
        embeds: [],
      }),
      expect.objectContaining({
        content: expect.stringContaining("최종 답변입니다."),
        embeds: [],
        components: [
          {
            type: 1,
            components: [
              { type: 2, custom_id: "cdc:codex:thoughts:open", label: "생각 열기", style: 2 },
              { type: 2, custom_id: "cdc:codex:thoughts:send-process", label: "과정 보내기", style: 2 },
            ],
          },
        ],
      }),
    ]);
  });

  it("shows readable operation progress from Codex tool activity", async () => {
    const edits: unknown[] = [];
    const submitCodexPrompt = vi
      .fn()
      .mockImplementation(
        async (input: {
          onProgress?: (event: {
            type: string;
            label?: string;
            detail?: string;
            sessionId?: string;
          }) => Promise<void> | void;
        }) => {
          await input.onProgress?.({
            type: "operation-progress",
            label: "파일 탐색 중",
            detail: "42개 파일 · rg --files",
          });

          return {
            jobId: "job-1",
            result: {
              status: "completed",
              finalMessage: "최종 답변입니다.",
              sessionId: "session-1",
            },
          };
        },
    );
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "codex 진행상황 보여줘",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async (nextMessage: unknown) => {
          edits.push(nextMessage);
        },
      }),
    });

    expect(edits[0]).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("진행: 파일 탐색 중"),
        embeds: [],
      }),
    );
    expect((edits[0] as { content: string }).content).toContain("42개의 파일 탐색중...");
  });

  it("runs immediate admin sync only when an admin channel receives sync all", async () => {
    const replies: unknown[] = [];
    const edits: unknown[] = [];
    const guild = {
      createCategory: vi.fn(),
      createTextChannel: vi.fn(),
      deleteChannel: vi.fn(),
      deleteCategory: vi.fn(),
    };
    const syncCodexSessions = vi.fn().mockResolvedValue({
      createdCategories: 1,
      existingCategories: 0,
      createdChannels: 2,
      existingChannels: 0,
      skippedSessions: 0,
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "sync all",
      roleIds: ["role-operator"],
      guild,
      reply: async (message) => {
        replies.push(message);
        return {
          edit: async (nextMessage: unknown) => {
            edits.push(nextMessage);
          },
        };
      },
    });

    expect(syncCodexSessions).toHaveBeenCalledWith(
      expect.objectContaining({ guild, limit: 25, onProgress: expect.any(Function) }),
    );
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Codex session sync started" })],
      }),
    ]);
    expect(edits).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Codex session sync complete" })],
      }),
    ]);
  });

  it("shows the current channel target without running shell commands", async () => {
    const replies: unknown[] = [];
    const submitCommandJob = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob,
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "where",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(submitCommandJob).not.toHaveBeenCalled();
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Current channel target" })],
      }),
    ]);
  });

  it("shows the maintenance panel from a button-only route", async () => {
    const replies: unknown[] = [];
    const submitCommandJob = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob,
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "maintenance",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(submitCommandJob).not.toHaveBeenCalled();
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "유지보수 패널" })],
      }),
    ]);
  });

  it("shows direct sync status from the state store summary", async () => {
    const replies: unknown[] = [];
    const getSyncStatus = vi.fn().mockResolvedValue({
      workspaceCount: 2,
      sessionChannelCount: 5,
      archivedSessionCount: 3,
      contextPostedCount: 4,
      transcriptSyncMode: "on-chat",
      transcriptSyncedChannelCount: 2,
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      getSyncStatus,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "sync status",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(getSyncStatus).toHaveBeenCalled();
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Codex sync status" })],
      }),
    ]);
  });

  it("updates the transcript sync mode from an admin channel", async () => {
    const replies: unknown[] = [];
    const setTranscriptSyncMode = vi.fn().mockResolvedValue({
      mode: "realtime",
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      setTranscriptSyncMode,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "sync mode realtime",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(setTranscriptSyncMode).toHaveBeenCalledWith("realtime");
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Transcript sync mode updated" })],
      }),
    ]);
  });

  it("reloads Discord bot commands from an admin channel", async () => {
    const replies: unknown[] = [];
    const edits: unknown[] = [];
    const reloadBot = vi.fn().mockResolvedValue({
      mode: "commands",
      commandCount: 18,
      restarting: false,
      startedAt: "2026-04-23T12:00:00.000Z",
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      reloadBot,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "reload",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
        return {
          edit: async (nextMessage: unknown) => {
            edits.push(nextMessage);
          },
        };
      },
    });

    expect(reloadBot).toHaveBeenCalledWith({ mode: "commands" });
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Bot reload started" })],
      }),
    ]);
    expect(edits).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Bot reload complete" })],
      }),
    ]);
  });

  it("requires confirmation before restarting the Discord bot", async () => {
    const replies: unknown[] = [];
    const reloadBot = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      reloadBot,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "reload restart",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(reloadBot).not.toHaveBeenCalled();
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Bot restart confirmation" })],
        components: expect.any(Array),
      }),
    ]);
  });

  it("shows a selectable Codex session sync picker", async () => {
    const replies: unknown[] = [];
    const edits: unknown[] = [];
    const previewSelectableCodexSessions = vi.fn().mockResolvedValue({
      sessions: [
        {
          id: "019db2be-b2b3-7e82-9e61-8c84b28ad287",
          threadName: "Codex Discord sync design",
          updatedAt: "2026-04-23T10:00:00.000Z",
          workspaceDisplayName: "repo",
        },
      ],
      totalAvailable: 1,
      limit: 25,
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      previewSelectableCodexSessions,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "sync",
      roleIds: ["role-operator"],
      reply: async (message) => {
        replies.push(message);
        return {
          edit: async (nextMessage: unknown) => {
            edits.push(nextMessage);
          },
        };
      },
    });

    expect(previewSelectableCodexSessions).toHaveBeenCalledWith({ limit: 25 });
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Loading Codex session picker" })],
      }),
    ]);
    expect(edits).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Select Codex sessions to sync" })],
        components: expect.any(Array),
      }),
    ]);
  });

  it("runs selected session sync when session ids are selected", async () => {
    const guild = {
      createCategory: vi.fn(),
      createTextChannel: vi.fn(),
      deleteChannel: vi.fn(),
      deleteCategory: vi.fn(),
    };
    const syncCodexSessions = vi.fn().mockResolvedValue({
      createdCategories: 0,
      existingCategories: 1,
      createdChannels: 2,
      existingChannels: 0,
      skippedSessions: 0,
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content:
        "sync selected 019db2be-b2b3-7e82-9e61-8c84b28ad287 019db2be-b2b3-7e82-9e61-8c84b28ad288",
      roleIds: ["role-operator"],
      guild,
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(syncCodexSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        guild,
        limit: 2,
        sessionIds: [
          "019db2be-b2b3-7e82-9e61-8c84b28ad287",
          "019db2be-b2b3-7e82-9e61-8c84b28ad288",
        ],
        onProgress: expect.any(Function),
      }),
    );
  });

  it("edits the sync reply with live progress events", async () => {
    const edits: unknown[] = [];
    const guild = {
      createCategory: vi.fn(),
      createTextChannel: vi.fn(),
      deleteChannel: vi.fn(),
      deleteCategory: vi.fn(),
    };
    const syncCodexSessions = vi
      .fn()
      .mockImplementation(async (input: { onProgress?: (event: unknown) => Promise<void> | void }) => {
        await input.onProgress?.({
          phase: "syncing",
          processedSessions: 1,
          totalSessions: 3,
          filteredSessions: 2,
          currentSessionName: "Codex Discord planning",
          createdChannels: 1,
          existingChannels: 0,
          skippedSessions: 2,
        });

        return {
          createdCategories: 1,
          existingCategories: 0,
          createdChannels: 1,
          existingChannels: 0,
          skippedSessions: 2,
        };
      });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "sync all",
      roleIds: ["role-operator"],
      guild,
      reply: async () => ({
        edit: async (nextMessage: unknown) => {
          edits.push(nextMessage);
        },
      }),
    });

    expect(edits).toEqual([
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: "Codex session sync in progress",
            fields: expect.arrayContaining([
              { name: "Progress", value: "`1 / 3`", inline: true },
              { name: "Filtered out", value: "`2`", inline: true },
              { name: "Current session", value: "`Codex Discord planning`", inline: false },
            ]),
          }),
        ],
      }),
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Codex session sync complete" })],
      }),
    ]);
  });

  it("archives the current session-linked channel without sending the command to Codex", async () => {
    const sessionChannelContext: ManagedDiscordChannelContext = {
      ...channelContext,
      channelMode: "session-linked",
      codexSessionId: "session-1",
    };
    const archiveSyncedSession = vi.fn().mockResolvedValue({
      codexSessionId: "session-1",
      deletedChannel: true,
      removedChannelMapping: true,
      wasAlreadyArchived: false,
    });
    const submitCodexPrompt = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => sessionChannelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt,
      syncCodexSessions: vi.fn(),
      archiveSyncedSession,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "session-channel-1",
      content: "archive confirm",
      roleIds: ["role-operator"],
      reply: async () => ({
        edit: async () => undefined,
      }),
    });

    expect(submitCodexPrompt).not.toHaveBeenCalled();
    expect(archiveSyncedSession).toHaveBeenCalledWith({
      guild: null,
      discordChannelId: "session-channel-1",
      codexSessionId: "session-1",
    });
  });

  it("previews synced channel deletion without deleting Discord resources", async () => {
    const replies: unknown[] = [];
    const guild = {
      createCategory: vi.fn(),
      createTextChannel: vi.fn(),
      deleteChannel: vi.fn(),
      deleteCategory: vi.fn(),
    };
    const previewSyncedChannelsDelete = vi.fn().mockResolvedValue({
      mode: "all",
      channelCount: 2,
      categoryCount: 1,
      channelNames: ["build-bridge", "fix-sync"],
      categoryNames: ["repo"],
    });
    const deleteSyncedChannels = vi.fn();
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      previewSyncedChannelsDelete,
      deleteSyncedChannels,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "sync delete preview",
      roleIds: ["role-operator"],
      guild,
      reply: async (message) => {
        replies.push(message);
      },
    });

    expect(previewSyncedChannelsDelete).toHaveBeenCalledWith({ mode: "all" });
    expect(deleteSyncedChannels).not.toHaveBeenCalled();
    expect(guild.deleteChannel).not.toHaveBeenCalled();
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Synced channel delete preview" })],
      }),
    ]);
  });

  it("deletes synced channels only when the request is confirmed", async () => {
    const replies: unknown[] = [];
    const edits: unknown[] = [];
    const guild = {
      createCategory: vi.fn(),
      createTextChannel: vi.fn(),
      deleteChannel: vi.fn(),
      deleteCategory: vi.fn(),
    };
    const deleteSyncedChannels = vi.fn().mockResolvedValue({
      mode: "all",
      deletedChannels: 2,
      deletedCategories: 1,
      missingChannels: 0,
      missingCategories: 0,
    });
    const handleMessage = createDiscordMessageHandler({
      resolveChannelContext: async () => channelContext,
      submitCommandJob: vi.fn(),
      submitCodexPrompt: vi.fn(),
      syncCodexSessions: vi.fn(),
      previewSyncedChannelsDelete: vi.fn(),
      deleteSyncedChannels,
      updateChannelCwd: vi.fn(),
      recordCommandAudit: vi.fn(),
    });

    await handleMessage({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "sync delete all confirm",
      roleIds: ["role-operator"],
      guild,
      reply: async (message) => {
        replies.push(message);
        return {
          edit: async (nextMessage: unknown) => {
            edits.push(nextMessage);
          },
        };
      },
    });

    expect(deleteSyncedChannels).toHaveBeenCalledWith({ guild, mode: "all" });
    expect(replies).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Deleting synced channels" })],
      }),
    ]);
    expect(edits).toEqual([
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Synced channels deleted" })],
      }),
    ]);
  });
});
