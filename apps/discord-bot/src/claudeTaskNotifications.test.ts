import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { notifyClaudeCodeTaskCompletions } from "./claudeTaskNotifications.js";
import type { DiscoveredClaudeCodeSession } from "./claudeSessionSync.js";
import { createDirectSyncStateStore } from "./directState.js";

function claudeSession(input: Partial<DiscoveredClaudeCodeSession> = {}): DiscoveredClaudeCodeSession {
  return {
    id: "claude-session-1",
    cwd: "/repo",
    entrypoint: "claude-vscode",
    firstUserMessage: "테스트 대화야",
    latestAssistantMessage: "완료했습니다.",
    latestAssistantMessageKey: "claude-session-1:2026-07-20T04:31:45.812Z:1",
    updatedAt: "2026-07-20T04:31:45.812Z",
    filePath: "/tmp/claude-session-1.jsonl",
    ...input,
  };
}

describe("notifyClaudeCodeTaskCompletions", () => {
  it("baselines existing Claude answers on first scan and notifies only new IDE answers", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-notify-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue({ id: "message-1" });

    try {
      await stateStore.write({
        version: 1,
        archivedCodexSessionIds: [],
        workspaces: [],
        sessionChannels: [
          {
            codexSessionId: null,
            claudeSessionId: "claude-session-1",
            threadName: "테스트 대화야",
            updatedAt: "2026-07-20T04:31:45.812Z",
            cwd: "/repo",
            workspaceRoot: "/repo",
            workspaceDisplayName: "repo",
            discordCategoryId: null,
            discordChannelId: "thread-claude",
            discordParentChannelId: "parent-claude",
            discordDeliveryMode: "thread",
            channelMode: "claude-code",
            channelName: "test",
            computerId: "mac",
            workspaceId: "mac:/repo",
          },
        ],
      });

      await expect(
        notifyClaudeCodeTaskCompletions({
          guild: { sendTextMessage },
          stateStore,
          sessions: [claudeSession()],
          mentionRoleIds: ["role-1"],
        }),
      ).resolves.toMatchObject({
        checkedSessions: 1,
        completedSessions: 1,
        notifiedSessions: 0,
        initialized: true,
      });
      expect(sendTextMessage).not.toHaveBeenCalled();

      await expect(
        notifyClaudeCodeTaskCompletions({
          guild: { sendTextMessage },
          stateStore,
          sessions: [claudeSession()],
          mentionRoleIds: ["role-1"],
        }),
      ).resolves.toMatchObject({
        notifiedSessions: 0,
        initialized: false,
      });
      expect(sendTextMessage).not.toHaveBeenCalled();

      await expect(
        notifyClaudeCodeTaskCompletions({
          guild: { sendTextMessage },
          stateStore,
          sessions: [
            claudeSession({
              latestAssistantMessage: "새 답변입니다.",
              latestAssistantMessageKey: "claude-session-1:2026-07-20T04:40:00.000Z:2",
              updatedAt: "2026-07-20T04:40:00.000Z",
            }),
          ],
          mentionRoleIds: ["role-1"],
        }),
      ).resolves.toMatchObject({
        checkedSessions: 1,
        completedSessions: 1,
        notifiedSessions: 1,
        initialized: false,
      });

      expect(sendTextMessage).toHaveBeenCalledWith(
        "thread-claude",
        expect.objectContaining({
          content: expect.stringContaining("**Claude Code 작업 완료**"),
          embeds: [
            expect.objectContaining({
              title: "답변",
              description: "새 답변입니다.",
            }),
          ],
        }),
        { mentionRoleIds: ["role-1"] },
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("skips connector-started Claude SDK sessions to avoid duplicate Discord results", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-notify-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue({ id: "message-1" });

    try {
      await expect(
        notifyClaudeCodeTaskCompletions({
          guild: { sendTextMessage },
          stateStore,
          sessions: [claudeSession({ entrypoint: "sdk-cli" })],
        }),
      ).resolves.toMatchObject({
        checkedSessions: 1,
        completedSessions: 0,
        notifiedSessions: 0,
      });
      expect(sendTextMessage).not.toHaveBeenCalled();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
