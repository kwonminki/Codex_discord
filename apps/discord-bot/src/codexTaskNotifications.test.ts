import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { notifyCodexTaskCompletions } from "./codexTaskNotifications.js";
import { createDirectSyncStateStore } from "./directState.js";

function session(input: {
  id?: string;
  threadName?: string;
  completionKey?: string;
  cwdHint?: string | null;
}) {
  return {
    id: input.id ?? "session-1",
    threadName: input.threadName ?? "Build feature",
    updatedAt: "2026-04-24T01:00:00.000Z",
    cwdHint: input.cwdHint ?? "/repo",
    realtimeEvents: input.completionKey
      ? [{ key: input.completionKey, kind: "status" as const, text: "작업 완료" }]
      : [],
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
          sessions: [session({ completionKey: "complete-2", threadName: "새 기능 구현" })],
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
        expect.stringContaining("Codex 작업 완료"),
      );
      expect(sendTextMessage.mock.calls[0]?.[1]).toContain("새 기능 구현");
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
      expect(sendTextMessage.mock.calls[0]?.[1]).toContain("session-2");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
