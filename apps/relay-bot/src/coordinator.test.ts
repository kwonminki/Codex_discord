import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { AgentRelayTurnResult } from "../../../packages/core/src/index.js";
import { createRelayCoordinator, type RelayTransferFile } from "./coordinator.js";
import { createRelayConversationStore } from "./store.js";

function result(input: {
  requestMessageId: string;
  sourceThreadId: string;
  status?: "continue" | "done" | "extend" | "blocked";
  text: string;
}): AgentRelayTurnResult {
  return {
    version: 1,
    requestMessageId: input.requestMessageId,
    sourceThreadId: input.sourceThreadId,
    agentLabel: input.sourceThreadId === "thread-a" ? "Codex" : "Claude Code",
    status: "completed",
    finalMessage: input.text,
    decision: { status: input.status ?? "continue" },
    errorMessage: null,
    fileCount: 0,
    createdAt: "2026-07-23T00:00:00.000Z",
  };
}

describe("relay coordinator", () => {
  it("alternates two agent threads, transfers files, and finishes after both agree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-relay-"));
    const sent: Array<{
      threadId: string;
      prompt: string;
      publicContent: string | null;
      files: RelayTransferFile[];
    }> = [];
    const notices: string[] = [];
    const store = createRelayConversationStore(root);
    const coordinator = createRelayCoordinator({
      store,
      now: () => Date.parse("2026-07-23T00:00:00.000Z"),
      transport: {
        async sendPrompt(input) {
          sent.push(input);
          return { messageId: `message-${sent.length}` };
        },
        async sendFinalNotice(input) {
          notices.push(input.conversation.status);
        },
      },
    });

    try {
      const started = await coordinator.start({
        guildId: "guild-1",
        originThreadId: "thread-a",
        peerThreadId: "thread-b",
        operatorUserId: "user-1",
        operatorRoleIds: ["role-1"],
        goal: "설계를 합의해줘",
        maxRounds: 3,
        timeoutMs: 60_000,
      });
      expect(started.pendingRequestMessageId).toBe("message-1");
      expect(sent[0]?.threadId).toBe("thread-a");
      expect(sent[0]?.publicContent).toBeNull();
      expect(sent[0]?.prompt).toContain("```codex-discord-send");
      expect(sent[0]?.prompt).not.toContain("비공개 추론이나 도구 로그");
      expect(sent[0]?.prompt).toContain("현재 왕복: 1/3");
      expect(sent[0]?.prompt).toContain("현재 agent turn: 1/6");

      const file = { name: "result.txt", data: Buffer.from("result") };
      const afterA = await coordinator.handleTurnResult(result({
        requestMessageId: "message-1",
        sourceThreadId: "thread-a",
        text: "A의 분석",
      }), [file]);
      expect(afterA?.pendingRequestMessageId).toBe("message-2");
      expect(sent[1]).toMatchObject({ threadId: "thread-b", files: [file] });
      expect(sent[1]?.prompt).toContain("A의 분석");
      expect(sent[1]?.prompt).toContain("현재 agent turn: 2/6");
      expect(sent[1]?.publicContent).toContain("A의 분석");
      expect(sent[1]?.publicContent).not.toContain("agent-relay");

      const afterB = await coordinator.handleTurnResult(result({
        requestMessageId: "message-2",
        sourceThreadId: "thread-b",
        status: "done",
        text: "B의 합의안",
      }), []);
      expect(afterB?.pendingRequestMessageId).toBe("message-3");
      expect(sent[2]?.threadId).toBe("thread-a");
      expect(sent[2]?.prompt).toContain("종료를 제안");

      const completed = await coordinator.handleTurnResult(result({
        requestMessageId: "message-3",
        sourceThreadId: "thread-a",
        status: "done",
        text: "최종 합의",
      }), []);
      expect(completed?.status).toBe("completed");
      expect(completed?.lastResponse).toBe("최종 합의");
      expect(notices).toEqual(["completed"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("pauses for an extension request and resumes one full round from the button action", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-relay-extension-"));
    const sent: Array<{
      threadId: string;
      prompt: string;
      publicContent: string | null;
      files: RelayTransferFile[];
    }> = [];
    const notices: string[] = [];
    const coordinator = createRelayCoordinator({
      store: createRelayConversationStore(root),
      now: () => Date.parse("2026-07-23T00:00:00.000Z"),
      transport: {
        async sendPrompt(input) {
          sent.push(input);
          return { messageId: `message-${sent.length}` };
        },
        async sendFinalNotice(input) {
          notices.push(input.conversation.status);
        },
      },
    });

    try {
      const started = await coordinator.start({
        guildId: "guild-1",
        originThreadId: "thread-a",
        peerThreadId: "thread-b",
        operatorUserId: "user-1",
        operatorRoleIds: ["role-1"],
        goal: "한 번 더 검토",
        maxRounds: 1,
        timeoutMs: 60_000,
      });
      await coordinator.handleTurnResult(result({
        requestMessageId: "message-1",
        sourceThreadId: "thread-a",
        text: "A의 첫 답변",
      }), []);
      expect(sent[1]?.prompt).toContain("현재 agent turn: 2/2");
      expect(sent[1]?.prompt).toContain("마지막 turn");

      const waiting = await coordinator.handleTurnResult(result({
        requestMessageId: "message-2",
        sourceThreadId: "thread-b",
        status: "extend",
        text: "B가 추가 비교를 요청함",
      }), []);
      expect(waiting).toMatchObject({
        status: "extension-requested",
        maxRounds: 1,
        turnCount: 2,
        pendingRequestMessageId: null,
      });
      expect(notices).toEqual(["extension-requested"]);
      await expect(coordinator.start({
        guildId: "guild-1",
        originThreadId: "thread-a",
        peerThreadId: "thread-c",
        operatorUserId: "user-1",
        operatorRoleIds: ["role-1"],
        goal: "겹치면 안 됨",
        maxRounds: 1,
        timeoutMs: 60_000,
      })).rejects.toThrow("이미 실행 중");

      const extensionOutcomes = await Promise.allSettled([
        coordinator.grantExtension(started.id, 1),
        coordinator.grantExtension(started.id, 1),
      ]);
      expect(extensionOutcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(extensionOutcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      const resumed = extensionOutcomes.find(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof coordinator.grantExtension>>> =>
          outcome.status === "fulfilled",
      )?.value;
      expect(resumed).toMatchObject({
        status: "running",
        maxRounds: 2,
        turnCount: 3,
        pendingRequestMessageId: "message-3",
        currentThreadId: "thread-a",
      });
      expect(sent[2]?.prompt).toContain("사용자가 왕복 1회를 추가했습니다");
      expect(sent[2]?.prompt).toContain("현재 agent turn: 3/4");
      expect(sent[2]?.publicContent).toContain("B가 추가 비교를 요청함");

      await coordinator.handleTurnResult(result({
        requestMessageId: "message-3",
        sourceThreadId: "thread-a",
        status: "done",
        text: "A의 최종 확인",
      }), []);
      const completed = await coordinator.handleTurnResult(result({
        requestMessageId: "message-4",
        sourceThreadId: "thread-b",
        status: "done",
        text: "B의 최종 확인",
      }), []);
      expect(completed?.status).toBe("completed");
      expect(notices).toEqual(["extension-requested", "completed"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stops at the configured hard round limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-relay-limit-"));
    let messageCount = 0;
    const notices: string[] = [];
    const coordinator = createRelayCoordinator({
      store: createRelayConversationStore(root),
      now: () => Date.parse("2026-07-23T00:00:00.000Z"),
      transport: {
        async sendPrompt() {
          messageCount += 1;
          return { messageId: `message-${messageCount}` };
        },
        async sendFinalNotice(input) {
          notices.push(input.conversation.status);
        },
      },
    });

    try {
      await coordinator.start({
        guildId: "guild-1",
        originThreadId: "thread-a",
        peerThreadId: "thread-b",
        operatorUserId: "user-1",
        operatorRoleIds: ["role-1"],
        goal: "토론",
        maxRounds: 1,
        timeoutMs: 60_000,
      });
      await coordinator.handleTurnResult(result({
        requestMessageId: "message-1",
        sourceThreadId: "thread-a",
        text: "A",
      }), []);
      const finished = await coordinator.handleTurnResult(result({
        requestMessageId: "message-2",
        sourceThreadId: "thread-b",
        text: "B",
      }), []);
      expect(finished?.status).toBe("max-rounds");
      expect(notices).toEqual(["max-rounds"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("atomically prevents overlapping conversations on the same thread", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-relay-overlap-"));
    let messageCount = 0;
    const coordinator = createRelayCoordinator({
      store: createRelayConversationStore(root),
      transport: {
        async sendPrompt() {
          messageCount += 1;
          return { messageId: `message-${messageCount}` };
        },
        async sendFinalNotice() {},
      },
    });
    const start = (peerThreadId: string) => coordinator.start({
      guildId: "guild-1",
      originThreadId: "thread-a",
      peerThreadId,
      operatorUserId: "user-1",
      operatorRoleIds: ["role-1"],
      goal: "동시 시작 방지",
      maxRounds: 2,
      timeoutMs: 60_000,
    });

    try {
      const outcomes = await Promise.allSettled([start("thread-b"), start("thread-c")]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      expect(messageCount).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists and retries a final notice that initially fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-relay-notice-"));
    const store = createRelayConversationStore(root);
    let messageCount = 0;
    let failNotice = true;
    let noticeCount = 0;
    const coordinator = createRelayCoordinator({
      store,
      now: () => Date.parse("2026-07-23T00:00:00.000Z"),
      transport: {
        async sendPrompt() {
          messageCount += 1;
          return { messageId: `message-${messageCount}` };
        },
        async sendFinalNotice() {
          noticeCount += 1;
          if (failNotice) {
            throw new Error("temporary Discord outage");
          }
        },
      },
    });

    try {
      await coordinator.start({
        guildId: "guild-1",
        originThreadId: "thread-a",
        peerThreadId: "thread-b",
        operatorUserId: "user-1",
        operatorRoleIds: ["role-1"],
        goal: "알림 복구",
        maxRounds: 1,
        timeoutMs: 60_000,
      });
      await coordinator.handleTurnResult(result({
        requestMessageId: "message-1",
        sourceThreadId: "thread-a",
        text: "A",
      }), []);
      await expect(coordinator.handleTurnResult(result({
        requestMessageId: "message-2",
        sourceThreadId: "thread-b",
        text: "B",
      }), [])).rejects.toThrow("temporary Discord outage");

      const pending = await store.findLatestByThread("thread-a");
      expect(pending).toMatchObject({ status: "max-rounds", finalNoticeSentAt: null });
      failNotice = false;
      await expect(coordinator.redeliverPendingFinalNotices()).resolves.toBe(1);
      expect(noticeCount).toBe(2);
      expect((await store.findLatestByThread("thread-a"))?.finalNoticeSentAt).not.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
