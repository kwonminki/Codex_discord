import type { AgentRelayTurnResult } from "../../../packages/core/src/index.js";
import type {
  RelayConversation,
  RelayConversationStatus,
  RelayConversationStore,
} from "./store.js";

export interface RelayTransferFile {
  name: string;
  data: Buffer;
  contentType?: string | null;
}

export interface RelayCoordinatorTransport {
  sendPrompt(input: {
    threadId: string;
    content: string;
    files: RelayTransferFile[];
  }): Promise<{ messageId: string }>;
  sendFinalNotice(input: {
    threadId: string;
    conversation: RelayConversation;
  }): Promise<void>;
}

function participantLabel(conversation: RelayConversation, threadId: string): "A" | "B" {
  return threadId === conversation.originThreadId ? "A" : "B";
}

function otherThread(conversation: RelayConversation, threadId: string): string {
  return threadId === conversation.originThreadId
    ? conversation.peerThreadId
    : conversation.originThreadId;
}

function protocolInstructions(): string {
  return [
    "당신은 다른 AI agent와 Discord relay 대화를 진행 중입니다.",
    "상대의 주장과 자료를 검토하고, 반론·보완·합의안을 구체적으로 작성하세요.",
    "비공개 추론이나 도구 로그가 아니라 상대에게 전달할 최종 공개 답변만 작성하세요.",
    "파일 전달이 필요하면 기존 codex-discord-send 블록에 이 컴퓨터의 절대경로를 넣으세요.",
    "답변 마지막에는 반드시 아래 형식 중 하나를 넣으세요.",
    "```agent-relay",
    '{"status":"continue","summary":"계속 논의해야 하는 이유"}',
    "```",
    "합의가 충분하면 status를 done, 사람의 개입이 필요하면 blocked로 바꾸세요.",
    "이 제어 블록은 상대에게 보이지 않고 Coordinator가 처리합니다.",
  ].join("\n");
}

function initialPrompt(conversation: RelayConversation): string {
  return [
    `Agent relay 대화 ${conversation.id}를 시작합니다. 당신은 참가자 A입니다.`,
    "",
    "대화 목표",
    conversation.goal,
    "",
    protocolInstructions(),
    "",
    "먼저 문제를 분석하고 상대 Agent B가 검토할 수 있는 첫 입장을 제시하세요.",
  ].join("\n");
}

function peerPrompt(input: {
  conversation: RelayConversation;
  sourceThreadId: string;
  sourceAgentLabel: string;
  response: string;
  proposesCompletion: boolean;
  fileCount: number;
}): string {
  const sourceLabel = participantLabel(input.conversation, input.sourceThreadId);
  const targetLabel = participantLabel(input.conversation, otherThread(input.conversation, input.sourceThreadId));
  return [
    `Agent relay 대화 ${input.conversation.id}의 다음 turn입니다. 당신은 참가자 ${targetLabel}입니다.`,
    `참가자 ${sourceLabel} (${input.sourceAgentLabel})의 공개 답변을 전달합니다.`,
    input.fileCount > 0 ? `함께 전달된 파일 ${input.fileCount}개도 확인하세요.` : null,
    "",
    "상대 답변",
    input.response || "(상대가 텍스트 답변을 남기지 않았습니다.)",
    "",
    input.proposesCompletion
      ? "상대가 종료를 제안했습니다. 충분히 합의됐다면 done으로 확인하고, 빠진 내용이 있으면 continue로 논의를 이어가세요."
      : "상대의 내용을 검토하고 논의를 이어가세요.",
    "",
    "대화 목표",
    input.conversation.goal,
    "",
    protocolInstructions(),
  ].filter((line): line is string => line !== null).join("\n");
}

function finalStatusDetail(status: RelayConversationStatus, fallback: string): string {
  const safeFallback = fallback.trim().slice(0, 1_000);
  switch (status) {
    case "completed":
      return "두 에이전트가 종료에 동의했습니다.";
    case "max-rounds":
      return "설정된 최대 라운드에 도달했습니다.";
    case "timed-out":
      return "설정된 전체 대화 시간이 만료됐습니다.";
    case "stopped":
      return "사용자가 대화를 중지했습니다.";
    case "blocked":
      return safeFallback || "에이전트가 사람의 개입을 요청했습니다.";
    default:
      return safeFallback || "에이전트 relay 대화가 실패했습니다.";
  }
}

export function createRelayCoordinator(input: {
  store: RelayConversationStore;
  transport: RelayCoordinatorTransport;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;

  async function finish(
    conversation: RelayConversation,
    status: Exclude<RelayConversationStatus, "running">,
    detail: string,
    lastResponse = conversation.lastResponse,
  ): Promise<RelayConversation> {
    const finished = await input.store.update(conversation.id, {
      status,
      statusDetail: finalStatusDetail(status, detail),
      lastResponse,
      pendingRequestMessageId: null,
      completedAt: new Date(now()).toISOString(),
      finalNoticeSentAt: null,
    });
    await input.transport.sendFinalNotice({ threadId: finished.originThreadId, conversation: finished });
    return input.store.update(finished.id, {
      finalNoticeSentAt: new Date(now()).toISOString(),
    });
  }

  async function dispatch(
    conversation: RelayConversation,
    threadId: string,
    content: string,
    files: RelayTransferFile[],
  ): Promise<RelayConversation> {
    const sent = await input.transport.sendPrompt({ threadId, content, files });
    return input.store.update(conversation.id, {
      currentThreadId: threadId,
      turnCount: conversation.turnCount + 1,
      pendingRequestMessageId: sent.messageId,
    });
  }

  return {
    async start(startInput: {
      guildId: string;
      originThreadId: string;
      peerThreadId: string;
      operatorUserId: string;
      operatorRoleIds: string[];
      goal: string;
      maxRounds: number;
      timeoutMs: number;
    }): Promise<RelayConversation> {
      if (startInput.originThreadId === startInput.peerThreadId) {
        throw new Error("서로 다른 두 agent thread를 선택해야 합니다.");
      }
      if (await input.store.findActiveByThread(startInput.originThreadId)) {
        throw new Error("현재 thread에는 이미 실행 중인 agent relay 대화가 있습니다.");
      }
      if (await input.store.findActiveByThread(startInput.peerThreadId)) {
        throw new Error("상대 thread에는 이미 실행 중인 agent relay 대화가 있습니다.");
      }

      const conversation = await input.store.create({
        guildId: startInput.guildId,
        originThreadId: startInput.originThreadId,
        peerThreadId: startInput.peerThreadId,
        operatorUserId: startInput.operatorUserId,
        operatorRoleIds: [...startInput.operatorRoleIds],
        goal: startInput.goal.trim(),
        maxRounds: startInput.maxRounds,
        timeoutAt: new Date(now() + startInput.timeoutMs).toISOString(),
        status: "running",
        currentThreadId: startInput.originThreadId,
        turnCount: 0,
        pendingRequestMessageId: null,
        lastDoneThreadId: null,
        lastResponse: "",
        lastAgentLabel: null,
        statusDetail: null,
        completedAt: null,
        finalNoticeSentAt: null,
      });

      try {
        return await dispatch(conversation, conversation.originThreadId, initialPrompt(conversation), []);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return finish(conversation, "failed", `첫 turn을 전달하지 못했습니다: ${detail}`);
      }
    },

    async handleTurnResult(result: AgentRelayTurnResult, files: RelayTransferFile[]): Promise<RelayConversation | null> {
      const conversation = await input.store.findPendingByRequest(result.requestMessageId);
      if (!conversation || conversation.currentThreadId !== result.sourceThreadId) {
        return null;
      }
      if (now() >= Date.parse(conversation.timeoutAt)) {
        return finish(conversation, "timed-out", "", result.finalMessage);
      }
      if (result.status === "failed") {
        return finish(conversation, "failed", result.errorMessage ?? "Agent turn failed.", result.finalMessage);
      }
      if (result.decision?.status === "blocked") {
        return finish(
          conversation,
          "blocked",
          result.decision.summary ?? "에이전트가 사람의 개입을 요청했습니다.",
          result.finalMessage,
        );
      }

      const currentDone = result.decision?.status === "done";
      const bothDone = currentDone && Boolean(
        conversation.lastDoneThreadId && conversation.lastDoneThreadId !== result.sourceThreadId,
      );
      const updated = await input.store.update(conversation.id, {
        pendingRequestMessageId: null,
        lastDoneThreadId: currentDone ? result.sourceThreadId : null,
        lastResponse: result.finalMessage,
        lastAgentLabel: result.agentLabel,
      });

      if (bothDone) {
        return finish(updated, "completed", "", result.finalMessage);
      }
      if (updated.turnCount >= updated.maxRounds * 2) {
        return finish(updated, "max-rounds", "", result.finalMessage);
      }

      const nextThreadId = otherThread(updated, result.sourceThreadId);
      const nextPrompt = peerPrompt({
        conversation: updated,
        sourceThreadId: result.sourceThreadId,
        sourceAgentLabel: result.agentLabel,
        response: result.finalMessage,
        proposesCompletion: currentDone,
        fileCount: files.length,
      });

      try {
        return await dispatch(updated, nextThreadId, nextPrompt, files);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return finish(updated, "failed", `다음 turn을 전달하지 못했습니다: ${detail}`, result.finalMessage);
      }
    },

    async stop(threadId: string): Promise<RelayConversation | null> {
      const conversation = await input.store.findActiveByThread(threadId);
      return conversation ? finish(conversation, "stopped", "") : null;
    },

    async status(threadId: string): Promise<RelayConversation | null> {
      return input.store.findLatestByThread(threadId);
    },

    async expireTimedOut(): Promise<number> {
      const active = (await input.store.list()).filter((conversation) =>
        conversation.status === "running" && now() >= Date.parse(conversation.timeoutAt));
      for (const conversation of active) {
        await finish(conversation, "timed-out", "");
      }
      return active.length;
    },

    async redeliverPendingFinalNotices(): Promise<number> {
      const pending = await input.store.listPendingFinalNotices();
      for (const conversation of pending) {
        await input.transport.sendFinalNotice({
          threadId: conversation.originThreadId,
          conversation,
        });
        await input.store.update(conversation.id, {
          finalNoticeSentAt: new Date(now()).toISOString(),
        });
      }
      return pending.length;
    },
  };
}

export type RelayCoordinator = ReturnType<typeof createRelayCoordinator>;
