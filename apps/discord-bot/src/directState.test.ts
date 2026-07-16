import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDirectSyncStateStore } from "./directState.js";

describe("direct sync state store", () => {
  it("defaults transcript sync to realtime and persists transcript markers", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "direct-state-"));

    try {
      const store = createDirectSyncStateStore(path.join(tempRoot, "state.json"));

      await expect(store.read()).resolves.toMatchObject({
        transcriptSyncMode: "realtime",
        taskCompletionNotificationsInitializedAt: null,
        taskCompletionNotifications: [],
      });

      await store.write({
        version: 1,
        transcriptSyncMode: "realtime",
        archivedCodexSessionIds: [],
        workspaces: [],
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
            lastTranscriptMessageKey: "message-key-1",
            lastTranscriptSyncedAt: "2026-04-23T00:01:00.000Z",
            lastTranscriptDiscordMessageId: "discord-message-1",
          },
        ],
      });

      await expect(store.read()).resolves.toMatchObject({
        transcriptSyncMode: "realtime",
        sessionChannels: [
          {
            lastTranscriptMessageKey: "message-key-1",
            lastTranscriptSyncedAt: "2026-04-23T00:01:00.000Z",
            lastTranscriptDiscordMessageId: "discord-message-1",
          },
        ],
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("persists synced session channels and updates per-channel cwd", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "direct-state-"));

    try {
      const store = createDirectSyncStateStore(path.join(tempRoot, "state.json"));

      await store.write({
        version: 1,
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
      });

      await expect(store.read()).resolves.toMatchObject({
        version: 1,
        sessionChannels: [
          {
            codexSessionId: "session-1",
            discordChannelId: "channel-1",
            cwd: "/repo",
          },
        ],
      });

      await store.updateChannelCwd("channel-1", "/repo/apps");

      await expect(store.findSessionChannelByDiscordId("channel-1")).resolves.toMatchObject({
        codexSessionId: "session-1",
        cwd: "/repo/apps",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("persists pending new-chat channels and links the Codex session id later", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "direct-state-"));

    try {
      const store = createDirectSyncStateStore(path.join(tempRoot, "state.json"));

      await store.write({
        version: 1,
        archivedCodexSessionIds: [],
        workspaces: [],
        sessionChannels: [
          {
            codexSessionId: null,
            threadName: "General Codex chat",
            updatedAt: "2026-04-24T00:00:00.000Z",
            cwd: "/repo",
            workspaceRoot: "/repo",
            workspaceDisplayName: "General Chat",
            discordCategoryId: null,
            discordChannelId: "channel-1",
            channelName: "general-codex-chat",
            computerId: "local-dev",
            workspaceId: "local-dev:/repo:general",
          },
        ],
      });

      await store.updateSessionChannelCodexSession("channel-1", "session-new", "General Codex chat");

      await expect(store.findSessionChannelByDiscordId("channel-1")).resolves.toMatchObject({
        codexSessionId: "session-new",
        threadName: "General Codex chat",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("persists scheduled commands", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "direct-state-"));

    try {
      const store = createDirectSyncStateStore(path.join(tempRoot, "state.json"));

      await store.write({
        version: 1,
        archivedCodexSessionIds: [],
        workspaces: [],
        sessionChannels: [],
        scheduledCommands: [
          {
            id: "sched-1",
            channelId: "channel-1",
            userId: "user-1",
            roleIds: ["role-operator"],
            command: "shell pwd",
            schedule: { type: "interval", everyMs: 60_000 },
            enabled: true,
            nextRunAt: "2026-04-24T01:00:00.000Z",
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:00:00.000Z",
            runCount: 0,
          },
        ],
      });

      await expect(store.read()).resolves.toMatchObject({
        scheduledCommands: [
          {
            id: "sched-1",
            command: "shell pwd",
            nextRunAt: "2026-04-24T01:00:00.000Z",
          },
        ],
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
