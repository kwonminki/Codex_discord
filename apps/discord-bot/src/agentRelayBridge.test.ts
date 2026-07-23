import { describe, expect, it } from "vitest";

import { agentRelayTurnResultSchema } from "../../../packages/core/src/index.js";
import { buildAgentRelayCallbackMessages } from "./agentRelayBridge.js";

describe("agent relay bridge", () => {
  it("builds file batches followed by a structured result callback", () => {
    const messages = buildAgentRelayCallbackMessages({
      requestMessageId: "request-1",
      sourceThreadId: "thread-a",
      agentLabel: "Codex",
      status: "completed",
      finalMessage: [
        "공개 답변",
        "```agent-relay",
        '{"status":"continue","summary":"추가 검토 필요"}',
        "```",
      ].join("\n"),
      files: Array.from({ length: 12 }, (_, index) => ({
        attachment: Buffer.from(String(index)),
        name: `file-${index}.txt`,
      })),
      createdAt: "2026-07-23T00:00:00.000Z",
    });

    expect(messages).toHaveLength(3);
    expect(messages[0]?.content).toBe("agent-relay-files:request-1:1/2");
    expect(messages[0]?.files).toHaveLength(10);
    expect(messages[1]?.files).toHaveLength(2);
    const resultFile = messages[2]?.files?.[0]?.attachment;
    expect(Buffer.isBuffer(resultFile)).toBe(true);
    expect(agentRelayTurnResultSchema.parse(JSON.parse((resultFile as Buffer).toString("utf8")))).toMatchObject({
      requestMessageId: "request-1",
      finalMessage: "공개 답변",
      decision: { status: "continue", summary: "추가 검토 필요" },
      fileCount: 12,
    });
  });

  it("removes local send instructions and pauses relay surveys for user input", () => {
    const messages = buildAgentRelayCallbackMessages({
      requestMessageId: "request-survey",
      sourceThreadId: "thread-a",
      agentLabel: "Claude Code",
      status: "completed",
      finalMessage: [
        "검토할 영상을 준비했습니다.",
        "```codex-discord-send",
        '{"message":"첨부 영상을 확인하세요.","files":["/tmp/source-only.mp4"]}',
        "```",
        "```codex-discord-survey",
        '{"question":"어느 안을 선택할까요?","options":["A","B"]}',
        "```",
        "```agent-relay",
        '{"status":"continue","summary":"계속"}',
        "```",
      ].join("\n"),
      files: [],
      createdAt: "2026-07-23T00:00:00.000Z",
    });

    const resultAttachment = messages.at(-1)?.files?.[0]?.attachment;
    expect(Buffer.isBuffer(resultAttachment)).toBe(true);
    const parsed = agentRelayTurnResultSchema.parse(
      JSON.parse((resultAttachment as Buffer).toString("utf8")),
    );
    expect(parsed.finalMessage).toBe("검토할 영상을 준비했습니다.\n첨부 영상을 확인하세요.");
    expect(parsed.finalMessage).not.toContain("/tmp/source-only.mp4");
    expect(parsed.decision).toEqual({
      status: "blocked",
      summary: "Agent가 Discord 설문으로 사용자 입력을 요청했습니다.",
    });
  });

  it("keeps a long multi-message answer and its trailing decision in one relay result", () => {
    const answer = Array.from(
      { length: 180 },
      (_, index) => `긴 공개 답변 ${index + 1}: ${"전체 내용 ".repeat(8)}`,
    ).join("\n");
    const messages = buildAgentRelayCallbackMessages({
      requestMessageId: "request-long",
      sourceThreadId: "thread-a",
      agentLabel: "Codex",
      status: "completed",
      finalMessage: [
        answer,
        "```agent-relay",
        '{"status":"continue","summary":"긴 답변 전체를 검토해야 함"}',
        "```",
      ].join("\n"),
      files: [],
      createdAt: "2026-07-23T00:00:00.000Z",
    });
    const resultAttachment = messages.at(-1)?.files?.[0]?.attachment;
    expect(Buffer.isBuffer(resultAttachment)).toBe(true);
    const parsed = agentRelayTurnResultSchema.parse(
      JSON.parse((resultAttachment as Buffer).toString("utf8")),
    );

    expect(parsed.finalMessage).toBe(answer.trim());
    expect(parsed.finalMessage).toContain("긴 공개 답변 1:");
    expect(parsed.finalMessage).toContain("긴 공개 답변 90:");
    expect(parsed.finalMessage).toContain("긴 공개 답변 180:");
    expect(parsed.decision).toEqual({
      status: "continue",
      summary: "긴 답변 전체를 검토해야 함",
    });
  });
});
