import { describe, expect, it } from "vitest";
import { extractAgentSurveyRequests } from "./agentSurvey.js";

describe("extractAgentSurveyRequests", () => {
  it("extracts a media survey and hides its control block", () => {
    const result = extractAgentSurveyRequests([
      "두 결과를 만들었습니다.",
      "```codex-discord-survey",
      JSON.stringify({
        question: "어느 쪽이 자연스러워?",
        files: ["/tmp/result.mp4"],
        options: ["A가 좋음", { label: "B가 좋음", description: "입 모양이 자연스러움" }],
        multiple: false,
      }),
      "```",
    ].join("\n"));

    expect(result.cleanedText).toBe("두 결과를 만들었습니다.");
    expect(result.surveys).toEqual([{
      question: "어느 쪽이 자연스러워?",
      message: null,
      files: ["/tmp/result.mp4"],
      options: [
        { label: "A가 좋음" },
        { label: "B가 좋음", description: "입 모양이 자연스러움" },
      ],
      multiple: false,
    }]);
  });

  it("uses request_user_input choices when the block only supplies media", () => {
    const result = extractAgentSurveyRequests(
      "영상 확인\n```discord-survey\n{\"files\":[\"/tmp/a.mp4\"],\"multiple\":true}\n```",
      {
        fallbackQuestion: "어떤 문제가 있나요?",
        fallbackOptions: [
          { label: "싱크 문제" },
          { label: "화질 문제" },
        ],
      },
    );

    expect(result.surveys[0]).toMatchObject({
      question: "어떤 문제가 있나요?",
      multiple: true,
      options: [{ label: "싱크 문제" }, { label: "화질 문제" }],
    });
  });

  it("rejects surveys without enough distinct options", () => {
    const result = extractAgentSurveyRequests(
      "```codex-discord-survey\n{\"question\":\"선택\",\"options\":[\"같음\",\"같음\"]}\n```",
    );

    expect(result.surveys).toEqual([]);
    expect(result.notices).toContain("설문에는 서로 다른 선택지가 최소 2개 필요합니다.");
  });

  it("uses a readable fallback when a block has options but no question text", () => {
    const result = extractAgentSurveyRequests(
      "```codex-discord-survey\n{\"options\":[\"A\",\"B\"]}\n```",
    );

    expect(result.surveys[0]?.question).toBe("선택해주세요.");
  });
});
