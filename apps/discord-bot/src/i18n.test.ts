import { describe, expect, it } from "vitest";

import { localizeDiscordModal, localizeDiscordPayload } from "./i18n.js";
import {
  formatAgentResultUpdate,
  formatHelp,
  type DiscordMessagePayload,
} from "./responses.js";

function payload(): DiscordMessagePayload {
  return {
    allowedMentions: { parse: [] },
    content: "Codex 작업 완료",
    embeds: [{
      title: "현재 채널 상태",
      color: 0,
      description: "이 Discord 채널이 현재 어디에 연결되어 있는지 보여줍니다. 현재 실행 중인 agent 요청은 없습니다.",
      fields: [
        { name: "위치", value: "/tmp/project" },
        { name: "요청", value: "README를 한국어로 요약해줘" },
      ],
    }],
    components: [{
      type: 1,
      components: [{ type: 2, custom_id: "cdc:test", label: "새로고침", style: 2 }],
    }],
  };
}

describe("Discord UI localization", () => {
  it("localizes connector UI while preserving user-authored prompt fields", () => {
    const translated = localizeDiscordPayload(payload(), "en");

    expect(translated.content).toBe("Codex task completed");
    expect(translated.embeds[0]?.title).toBe("Current channel status");
    expect(translated.embeds[0]?.description).toContain("connected");
    expect(translated.embeds[0]?.fields?.[0]).toEqual({ name: "Location", value: "/tmp/project" });
    expect(translated.embeds[0]?.fields?.[1]).toEqual({
      name: "Request",
      value: "README를 한국어로 요약해줘",
    });
    const component = translated.components?.[0]?.components[0];
    expect(component?.type).toBe(2);
    expect(component?.type === 2 ? component.label : null).toBe("Refresh");
  });

  it("does not translate agent-authored progress and final-answer text", () => {
    const progress = payload();
    progress.embeds[0] = {
      title: "Codex 진행",
      color: 0,
      description: "답변은 한국어로 작성하겠습니다.",
    };

    const translated = localizeDiscordPayload(progress, "en");
    expect(translated.embeds[0]?.title).toBe("Codex progress");
    expect(translated.embeds[0]?.description).toBe("답변은 한국어로 작성하겠습니다.");
  });

  it("localizes modal labels but preserves text input values", () => {
    const modal = {
      title: "답변 복사",
      components: [{
        type: 1,
        components: [{
          type: 4,
          label: "전체 선택 후 복사",
          placeholder: "예: README 요약해줘 / 테스트 실패 고쳐줘",
          value: "답변 원문",
        }],
      }],
    };

    expect(localizeDiscordModal(modal, "en")).toEqual({
      title: "Copy answer",
      components: [{
        type: 1,
        components: [{
          type: 4,
          label: "Select all and copy",
          placeholder: "Example: summarize README / fix the failing tests",
          value: "답변 원문",
        }],
      }],
    });
  });

  it("fully localizes connector-owned help screens", () => {
    for (const mode of ["shell-admin", "session-linked", "claude-code"] as const) {
      const help = localizeDiscordPayload(formatHelp(mode), "en");
      expect(JSON.stringify(help)).not.toMatch(/[가-힣]/);
    }
  });

  it("localizes completion metadata without translating the agent answer", () => {
    const result = formatAgentResultUpdate({
      computerDisplayName: "Mac",
      workspaceDisplayName: "Project",
      cwd: "/tmp/project",
      prompt: "한국어로 답해줘",
    }, {
      result: {
        status: "completed",
        sessionId: "session-1",
        finalMessage: "작업을 완료했습니다. 답변은 한국어입니다.",
      },
    });
    const translated = localizeDiscordPayload(result, "en");

    expect(translated.content).toContain("**Codex task completed**");
    expect(translated.content).toContain("Location: `/tmp/project`");
    expect(translated.content).toContain("Session ID: `session-1`");
    expect(translated.embeds[0]?.title).toBe("Answer");
    expect(translated.embeds[0]?.description).toBe("작업을 완료했습니다. 답변은 한국어입니다.");
  });
});
