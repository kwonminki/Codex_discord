import { describe, expect, it } from "vitest";

import {
  extractAgentRelayDecision,
  formatAgentRelayCancelMarker,
  formatAgentRelayFilesMarker,
  formatAgentRelayRequestMarker,
  formatAgentRelayResultMarker,
  formatAgentRelayStateMarker,
  parseAgentRelayCancelMarker,
  parseAgentRelayFilesMarker,
  parseAgentRelayRequestMarker,
  parseAgentRelayResultMarker,
  parseAgentRelayStateMarker,
} from "../src/agentRelay.js";

describe("agent relay protocol", () => {
  it("extracts the machine decision while preserving the public answer", () => {
    expect(extractAgentRelayDecision([
      "상대에게 보여줄 답변입니다.",
      "```agent-relay",
      '{"status":"done","summary":"합의 완료"}',
      "```",
    ].join("\n"))).toEqual({
      cleanedText: "상대에게 보여줄 답변입니다.",
      decision: { status: "done", summary: "합의 완료" },
      hadBlock: true,
    });
  });

  it("recognizes a request for another round", () => {
    expect(extractAgentRelayDecision([
      "한 번 더 검토가 필요합니다.",
      "```agent-relay",
      '{"status":"extend","summary":"성능 수치를 한 차례 더 비교해야 함"}',
      "```",
    ].join("\n"))).toMatchObject({
      cleanedText: "한 번 더 검토가 필요합니다.",
      decision: { status: "extend", summary: "성능 수치를 한 차례 더 비교해야 함" },
    });
  });

  it("round-trips result and file markers", () => {
    expect(parseAgentRelayFilesMarker(formatAgentRelayFilesMarker("message-1", 2, 3))).toEqual({
      requestMessageId: "message-1",
      batch: 2,
      total: 3,
    });
    expect(parseAgentRelayResultMarker(formatAgentRelayResultMarker("message-1"))).toBe("message-1");
  });

  it("accepts only exact control-channel request markers", () => {
    expect(parseAgentRelayRequestMarker(
      formatAgentRelayRequestMarker("1529012344129191946"),
    )).toBe("1529012344129191946");
    expect(parseAgentRelayRequestMarker("Agent relay 대화를 시작했습니다.")).toBeNull();
    expect(parseAgentRelayRequestMarker("agent-relay-request:not-a-thread")).toBeNull();
  });

  it("round-trips an exact relay cancellation marker", () => {
    expect(parseAgentRelayCancelMarker(
      formatAgentRelayCancelMarker("1529012344129191946", "request-message-1"),
    )).toEqual({
      targetThreadId: "1529012344129191946",
      requestMessageId: "request-message-1",
    });
    expect(parseAgentRelayCancelMarker("agent-relay-cancel:not-a-thread:request-1")).toBeNull();
    expect(parseAgentRelayCancelMarker("agent-relay-cancel:1529012344129191946")).toBeNull();
  });

  it("round-trips active and ended relay state markers", () => {
    const active = {
      conversationId: "d90bcf0b-e471-4f9f-a2cf-c279d14d53d0",
      status: "active" as const,
      originThreadId: "1529012344129191946",
      peerThreadId: "1529012344129191947",
      activeThreadId: "1529012344129191946",
      expiresAtMs: 1784772000000,
    };
    expect(parseAgentRelayStateMarker(formatAgentRelayStateMarker(active))).toEqual(active);
    expect(parseAgentRelayStateMarker(formatAgentRelayStateMarker({
      ...active,
      status: "ended",
      activeThreadId: null,
      expiresAtMs: 0,
    }))).toEqual({
      ...active,
      status: "ended",
      activeThreadId: null,
      expiresAtMs: 0,
    });
    expect(parseAgentRelayStateMarker(
      "agent-relay-state:d90bcf0b-e471-4f9f-a2cf-c279d14d53d0:active:1:2:-:100",
    )).toBeNull();
  });
});
