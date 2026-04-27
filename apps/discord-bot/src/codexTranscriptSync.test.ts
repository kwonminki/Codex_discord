import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { syncCodexSessionTranscriptUpdates } from "./codexTranscriptSync.js";
import { createDirectSyncStateStore } from "./directState.js";

function syncedSessionState() {
  return {
    version: 1 as const,
    transcriptSyncMode: "realtime" as const,
    archivedCodexSessionIds: [],
    workspaces: [
      {
        workspaceRoot: "/repo",
        workspaceDisplayName: "repo",
        discordCategoryId: "category-1",
        computerId: "local-dev",
        workspaceId: "local-dev:/repo",
      },
    ],
    sessionChannels: [
      {
        codexSessionId: "session-1",
        threadName: "Build bridge",
        updatedAt: "2026-04-23T00:00:00.000Z",
        cwd: "/repo",
        workspaceRoot: "/repo",
        workspaceDisplayName: "repo",
        discordCategoryId: "category-1",
        discordChannelId: "channel-1",
        channelName: "build-bridge",
        computerId: "local-dev",
        workspaceId: "local-dev:/repo",
      },
    ],
  };
}

describe("syncCodexSessionTranscriptUpdates", () => {
  it("baselines an already synced channel without posting old transcript messages", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-transcript-sync-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);

    try {
      await stateStore.write(syncedSessionState());

      await expect(
        syncCodexSessionTranscriptUpdates({
          guild: { sendTextMessage },
          stateStore,
          trigger: "realtime",
          sessions: [
            {
              id: "session-1",
              threadName: "Build bridge",
              updatedAt: "2026-04-23T00:02:00.000Z",
              cwdHint: "/repo",
              contextPreview: [
                { role: "user", text: "첫 질문" },
                { role: "assistant", text: "첫 답변" },
              ],
            },
          ],
        }),
      ).resolves.toMatchObject({
        checkedChannels: 1,
        updatedChannels: 1,
        postedMessages: 0,
        skippedByMode: false,
      });

      expect(sendTextMessage).not.toHaveBeenCalled();
      await expect(stateStore.findSessionChannelByDiscordId("channel-1")).resolves.toMatchObject({
        lastTranscriptMessageKey: expect.any(String),
        lastTranscriptSyncedAt: expect.any(String),
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("posts only transcript messages that appear after the stored marker", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-transcript-sync-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);

    try {
      await stateStore.write(syncedSessionState());
      await syncCodexSessionTranscriptUpdates({
        guild: { sendTextMessage },
        stateStore,
        trigger: "realtime",
        sessions: [
          {
            id: "session-1",
            threadName: "Build bridge",
            updatedAt: "2026-04-23T00:02:00.000Z",
            cwdHint: "/repo",
            contextPreview: [{ role: "user", text: "첫 질문" }],
          },
        ],
      });

      await expect(
        syncCodexSessionTranscriptUpdates({
          guild: { sendTextMessage },
          stateStore,
          trigger: "realtime",
          sessions: [
            {
              id: "session-1",
              threadName: "Build bridge",
              updatedAt: "2026-04-23T00:03:00.000Z",
              cwdHint: "/repo",
              contextPreview: [
                { role: "user", text: "첫 질문" },
                { role: "assistant", text: "새 답변" },
              ],
            },
          ],
        }),
      ).resolves.toMatchObject({
        postedMessages: 1,
        updatedChannels: 1,
      });

      expect(sendTextMessage).toHaveBeenCalledTimes(1);
      expect(sendTextMessage).toHaveBeenCalledWith(
        "channel-1",
        expect.stringContaining("새 답변"),
      );
      expect(sendTextMessage.mock.calls[0]?.[1]).toContain("새 답변");
      expect(sendTextMessage.mock.calls[0]?.[1]).not.toContain("**Codex 답변**");
      expect(sendTextMessage.mock.calls[0]?.[1]).not.toContain("Codex 데스크탑 변경사항 동기화");
      expect(sendTextMessage.mock.calls[0]?.[1]).not.toContain("세션:");
      expect(sendTextMessage.mock.calls[0]?.[1]).not.toContain("최근 업데이트:");
      expect(sendTextMessage.mock.calls[0]?.[1]).not.toContain("사용자: 첫 질문");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps desktop transcript sync in one rolling Discord message per channel", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-transcript-sync-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue({ id: "sync-message-1" });
    const editTextMessage = vi.fn().mockResolvedValue({ id: "sync-message-1" });

    try {
      await stateStore.write(syncedSessionState());
      await syncCodexSessionTranscriptUpdates({
        guild: { sendTextMessage, editTextMessage },
        stateStore,
        trigger: "realtime",
        sessions: [
          {
            id: "session-1",
            threadName: "Build bridge",
            updatedAt: "2026-04-23T00:02:00.000Z",
            cwdHint: "/repo",
            realtimeEvents: [{ key: "event-1", kind: "user", text: "첫 질문" }],
          },
        ],
      });

      sendTextMessage.mockClear();

      await syncCodexSessionTranscriptUpdates({
        guild: { sendTextMessage, editTextMessage },
        stateStore,
        trigger: "realtime",
        sessions: [
          {
            id: "session-1",
            threadName: "Build bridge",
            updatedAt: "2026-04-23T00:03:00.000Z",
            cwdHint: "/repo",
            realtimeEvents: [
              { key: "event-1", kind: "user", text: "첫 질문" },
              { key: "event-2", kind: "status", text: "파일 탐색 중 · rg --files" },
              { key: "event-3", kind: "assistant", text: "파일을 보는 중입니다." },
              { key: "event-4", kind: "user", text: "추가 요청\n두 번째 줄" },
            ],
          },
        ],
      });

      expect(sendTextMessage).toHaveBeenCalledTimes(1);
      expect(editTextMessage).not.toHaveBeenCalled();
      expect(sendTextMessage).toHaveBeenCalledWith(
        "channel-1",
        expect.objectContaining({
          content: expect.stringContaining("### 추가 요청"),
          components: [
            {
              type: 1,
              components: [{ type: 2, custom_id: "cdc:codex:thoughts:open", label: "생각 열기", style: 2 }],
            },
          ],
        }),
      );
      expect(JSON.stringify(sendTextMessage.mock.calls[0]?.[1])).not.toContain("파일 탐색 중 · rg --files");
      await expect(stateStore.findSessionChannelByDiscordId("channel-1")).resolves.toMatchObject({
        lastTranscriptDiscordMessageId: "sync-message-1",
      });

      sendTextMessage.mockClear();

      await syncCodexSessionTranscriptUpdates({
        guild: { sendTextMessage, editTextMessage },
        stateStore,
        trigger: "realtime",
        sessions: [
          {
            id: "session-1",
            threadName: "Build bridge",
            updatedAt: "2026-04-23T00:04:00.000Z",
            cwdHint: "/repo",
            realtimeEvents: [
              { key: "event-1", kind: "user", text: "첫 질문" },
              { key: "event-2", kind: "status", text: "파일 탐색 중 · rg --files" },
              { key: "event-3", kind: "assistant", text: "파일을 보는 중입니다." },
              { key: "event-4", kind: "user", text: "추가 요청\n두 번째 줄" },
              { key: "event-5", kind: "assistant", text: "추가 답변입니다." },
            ],
          },
        ],
      });

      expect(sendTextMessage).not.toHaveBeenCalled();
      expect(editTextMessage).toHaveBeenCalledTimes(1);
      expect(editTextMessage).toHaveBeenCalledWith(
        "channel-1",
        "sync-message-1",
        expect.objectContaining({
          content: expect.stringContaining("추가 답변입니다."),
        }),
      );
      const postedMessages = JSON.stringify(editTextMessage.mock.calls[0]?.[2]);
      expect(postedMessages).not.toContain("---");
      expect(postedMessages).not.toContain("진행 상황");
      expect(postedMessages).not.toContain("사용자 요청");
      expect(postedMessages).not.toContain("Codex 답변");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("skips realtime polling while the user selected on-chat mode", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-transcript-sync-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);

    try {
      await stateStore.write({
        ...syncedSessionState(),
        transcriptSyncMode: "on-chat",
      });

      await expect(
        syncCodexSessionTranscriptUpdates({
          guild: { sendTextMessage },
          stateStore,
          trigger: "realtime",
          sessions: [
            {
              id: "session-1",
              threadName: "Build bridge",
              updatedAt: "2026-04-23T00:02:00.000Z",
              cwdHint: "/repo",
              contextPreview: [{ role: "assistant", text: "새 답변" }],
            },
          ],
        }),
      ).resolves.toMatchObject({
        checkedChannels: 0,
        postedMessages: 0,
        skippedByMode: true,
      });

      expect(sendTextMessage).not.toHaveBeenCalled();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("mirrors desktop-side status events but suppresses duplicates for actively streamed Discord sessions", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-transcript-sync-"));
    const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
    const sendTextMessage = vi.fn().mockResolvedValue(undefined);

    try {
      await stateStore.write(syncedSessionState());

      await syncCodexSessionTranscriptUpdates({
        guild: { sendTextMessage },
        stateStore,
        trigger: "realtime",
        sessions: [
          {
            id: "session-1",
            threadName: "Build bridge",
            updatedAt: "2026-04-23T00:02:00.000Z",
            cwdHint: "/repo",
            realtimeEvents: [
              { key: "event-1", kind: "user", text: "첫 질문" },
            ],
          },
        ],
      });

      await expect(
        syncCodexSessionTranscriptUpdates({
          guild: { sendTextMessage },
          stateStore,
          trigger: "realtime",
          ignoredSessionIds: ["session-1"],
          sessions: [
            {
              id: "session-1",
              threadName: "Build bridge",
              updatedAt: "2026-04-23T00:03:00.000Z",
              cwdHint: "/repo",
              realtimeEvents: [
                { key: "event-1", kind: "user", text: "첫 질문" },
                { key: "event-2", kind: "status", text: "파일 탐색 중 · rg --files" },
                { key: "event-3", kind: "assistant", text: "파일을 보는 중입니다." },
              ],
            },
          ],
        }),
      ).resolves.toMatchObject({
        postedMessages: 0,
        updatedChannels: 1,
      });

      expect(sendTextMessage).not.toHaveBeenCalled();

      await expect(
        syncCodexSessionTranscriptUpdates({
          guild: { sendTextMessage },
          stateStore,
          trigger: "realtime",
          sessions: [
            {
              id: "session-1",
              threadName: "Build bridge",
              updatedAt: "2026-04-23T00:03:00.000Z",
              cwdHint: "/repo",
              realtimeEvents: [
                { key: "event-1", kind: "user", text: "첫 질문" },
                { key: "event-2", kind: "status", text: "파일 탐색 중 · rg --files" },
                { key: "event-3", kind: "assistant", text: "파일을 보는 중입니다." },
              ],
            },
          ],
        }),
      ).resolves.toMatchObject({
        postedMessages: 0,
        updatedChannels: 0,
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
