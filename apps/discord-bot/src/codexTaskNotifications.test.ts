import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DiscoveredCodexSession } from "../../../packages/codex-adapter/src/index.js";
import { notifyCodexTaskCompletions } from "./codexTaskNotifications.js";
import { createDirectSyncStateStore } from "./directState.js";

function session(input: {
  id?: string;
  threadName?: string;
  completionKey?: string;
  cwdHint?: string | null;
  assistantAnswer?: string;
  realtimeAssistantAnswer?: string;
}): DiscoveredCodexSession {
  const realtimeEvents = [
    ...(input.realtimeAssistantAnswer
      ? [{ key: "assistant-1", kind: "assistant" as const, text: input.realtimeAssistantAnswer }]
      : []),
    ...(input.completionKey
      ? [{ key: input.completionKey, kind: "status" as const, text: "작업 완료" }]
      : []),
  ];

  return {
    id: input.id ?? "session-1",
    threadName: input.threadName ?? "Build feature",
    updatedAt: "2026-04-24T01:00:00.000Z",
    cwdHint: input.cwdHint ?? "/repo",
    contextPreview: input.assistantAnswer
      ? [{ role: "assistant" as const, text: input.assistantAnswer }]
      : [],
    realtimeEvents,
  };
}

describe("notifyCodexTaskCompletions", () => {
  it("baselines existing completed sessions without posting old notifications", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-task-notifications-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);

    try {
      await expect(
        notifyCodexTaskCompletions({
          guild: { sendTextMessage },
          stateStore,
          adminChannelId: "admin-channel",
          sessions: [session({ completionKey: "complete-1" })],
        }),
      ).resolves.toMatchObject({
        checkedSessions: 1,
        completedSessions: 1,
        notifiedSessions: 0,
        initialized: true,
      });

      expect(sendTextMessage).not.toHaveBeenCalled();
      await expect(stateStore.read()).resolves.toMatchObject({
        taskCompletionNotificationsInitializedAt: expect.any(String),
        taskCompletionNotifications: [
          {
            sessionId: "session-1",
            lastTaskCompleteEventKey: "complete-1",
          },
        ],
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("posts when a later task completion appears", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-task-notifications-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);

    try {
      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [session({ completionKey: "complete-1" })],
      });

      await expect(
        notifyCodexTaskCompletions({
          guild: { sendTextMessage },
          stateStore,
          adminChannelId: "admin-channel",
          sessions: [
            session({
              completionKey: "complete-2",
              threadName: "새 기능 구현",
              assistantAnswer: "구현이 끝났고 테스트도 통과했습니다.",
            }),
          ],
        }),
      ).resolves.toMatchObject({
        checkedSessions: 1,
        completedSessions: 1,
        notifiedSessions: 1,
        initialized: false,
      });

      expect(sendTextMessage).toHaveBeenCalledTimes(1);
      expect(sendTextMessage).toHaveBeenCalledWith(
        "admin-channel",
        expect.objectContaining({
          content: expect.stringContaining("Codex 작업 완료"),
          embeds: [
            {
              title: "답변",
              color: expect.any(Number),
              description: expect.stringContaining("구현이 끝났고 테스트도 통과했습니다."),
            },
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  custom_id: "cdc:codex:continue:session-1",
                  label: "이어 작업 요청",
                  style: 1,
                },
              ],
            },
          ],
        }),
      );
      expect(JSON.stringify(sendTextMessage.mock.calls[0]?.[1])).toContain("새 기능 구현");
      await expect(stateStore.read()).resolves.toMatchObject({
        taskCompletionNotifications: [
          {
            sessionId: "session-1",
            lastTaskCompleteEventKey: "complete-2",
            notifiedAt: expect.any(String),
          },
        ],
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("posts completion notifications into a synced session thread with role mention options", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-task-notifications-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);

    try {
      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [],
      });
      const state = await stateStore.read();
      await stateStore.write({
        ...state,
        sessionChannels: [
          {
            codexSessionId: "session-1",
            threadName: "Build feature",
            updatedAt: "2026-04-24T01:00:00.000Z",
            cwd: "/repo",
            workspaceRoot: "/repo",
            workspaceDisplayName: "repo",
            discordCategoryId: null,
            discordChannelId: "thread-1",
            discordParentChannelId: "admin-channel",
            discordDeliveryMode: "thread",
            channelName: "build-feature",
            computerId: "local-dev",
            workspaceId: "local-dev:/repo",
          },
        ],
      });

      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [session({ completionKey: "complete-2" })],
        mentionRoleIds: ["operator-role"],
      });

      expect(sendTextMessage).toHaveBeenCalledTimes(1);
      expect(sendTextMessage).toHaveBeenCalledWith(
        "thread-1",
        expect.objectContaining({
          content: expect.stringContaining("Codex 작업 완료"),
        }),
        { mentionRoleIds: ["operator-role"] },
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates a missing session thread before sending a migrated completion notification", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-task-notifications-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);
    const createThread = vi.fn().mockResolvedValue({ id: "thread-1" });
    const controlApi = {
      createManagedChannel: vi.fn().mockResolvedValue({}),
      linkCodexSession: vi.fn().mockResolvedValue({}),
    };

    try {
      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [session({ completionKey: "complete-1" })],
      });

      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [
          session({
            completionKey: "complete-2",
            threadName: "Codex Discord connector 확인",
          }),
        ],
      });
      sendTextMessage.mockClear();

      await notifyCodexTaskCompletions({
        guild: { sendTextMessage, createThread },
        controlApi,
        stateStore,
        adminChannelId: "admin-channel",
        computerId: "local-dev",
        defaultWorkspaceRoot: "/fallback",
        sessions: [
          session({
            completionKey: "complete-2",
            threadName: "Codex Discord connector 확인",
          }),
        ],
        mentionRoleIds: ["operator-role"],
      });

      expect(createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Codex Discord connector 확인",
          parentChannelId: "admin-channel",
          autoArchiveDuration: 10_080,
          reason: expect.stringContaining("session-1"),
        }),
      );
      expect(controlApi.createManagedChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          discordChannelId: "thread-1",
          channelMode: "session-linked",
        }),
      );
      expect(controlApi.linkCodexSession).toHaveBeenCalledWith(
        expect.objectContaining({
          discordChannelId: "thread-1",
          codexSessionId: "session-1",
          threadNameSnapshot: "Codex Discord connector 확인",
        }),
      );
      expect(sendTextMessage).toHaveBeenCalledWith(
        "thread-1",
        expect.objectContaining({
          content: expect.stringContaining("Codex Discord connector 확인"),
        }),
        { mentionRoleIds: ["operator-role"] },
      );
      await expect(stateStore.findSessionChannelByDiscordId("thread-1")).resolves.toMatchObject({
        codexSessionId: "session-1",
        threadName: "Codex Discord connector 확인",
        discordDeliveryMode: "thread",
        workspaceRoot: "/repo",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("attaches long answers to completion notifications", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-task-notifications-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);
    const longAnswer = `요약\n${"긴 답변입니다. ".repeat(700)}`;

    try {
      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [session({ completionKey: "complete-1" })],
      });

      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [session({ completionKey: "complete-2", assistantAnswer: longAnswer })],
      });

      expect(sendTextMessage).toHaveBeenCalledTimes(1);
      const payload = sendTextMessage.mock.calls[0]?.[1];
      expect(payload).toMatchObject({
        embeds: [
          {
            title: "답변",
            description: expect.stringContaining("전체 답변은 첨부 파일"),
          },
        ],
        files: [
          {
            name: "codex-answer.txt",
          },
        ],
      });
      expect(payload.embeds[0].description.length).toBeLessThanOrEqual(3_800);
      expect(Buffer.isBuffer(payload.files[0].attachment)).toBe(true);
      expect(payload.files[0].attachment.toString("utf8")).toBe(longAnswer.trim());
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("omits answer embeds for sessions requested from Discord", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-task-notifications-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);

    try {
      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [session({ completionKey: "complete-1" })],
      });
      await stateStore.markDiscordRequestedCodexSession("session-1");

      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [
          session({
            completionKey: "complete-2",
            assistantAnswer: "이 답변은 이미 Discord 요청 결과 메시지로 전송되었습니다.",
          }),
        ],
      });

      expect(sendTextMessage).toHaveBeenCalledTimes(1);
      expect(sendTextMessage).toHaveBeenCalledWith(
        "admin-channel",
        expect.objectContaining({
          content: expect.stringContaining("Codex 작업 완료"),
          embeds: [],
        }),
      );
      expect(JSON.stringify(sendTextMessage.mock.calls[0]?.[1])).not.toContain("이미 Discord 요청 결과");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("posts the first completion for a new session after the baseline is initialized", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-task-notifications-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);

    try {
      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [],
      });

      await notifyCodexTaskCompletions({
        guild: { sendTextMessage },
        stateStore,
        adminChannelId: "admin-channel",
        sessions: [session({ id: "session-2", completionKey: "complete-new" })],
      });

      expect(sendTextMessage).toHaveBeenCalledTimes(1);
      expect(sendTextMessage.mock.calls[0]?.[0]).toBe("admin-channel");
      expect(JSON.stringify(sendTextMessage.mock.calls[0]?.[1])).toContain("session-2");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
