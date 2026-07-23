import { describe, expect, it } from "vitest";

import {
  extractAgentRelayDecision,
  formatAgentRelayFilesMarker,
  formatAgentRelayResultMarker,
  parseAgentRelayFilesMarker,
  parseAgentRelayResultMarker,
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

  it("round-trips result and file markers", () => {
    expect(parseAgentRelayFilesMarker(formatAgentRelayFilesMarker("message-1", 2, 3))).toEqual({
      requestMessageId: "message-1",
      batch: 2,
      total: 3,
    });
    expect(parseAgentRelayResultMarker(formatAgentRelayResultMarker("message-1"))).toBe("message-1");
  });
});
