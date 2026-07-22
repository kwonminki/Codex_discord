import { describe, expect, it } from "vitest";

import {
  localizeConnectorText,
  resolveConnectorLocale,
  SUPPORTED_CONNECTOR_LOCALES,
} from "../src/index.js";

describe("connector locales", () => {
  it("resolves supported locale aliases and rejects unknown locales", () => {
    expect(SUPPORTED_CONNECTOR_LOCALES).toEqual(["ko", "en", "zh", "ja"]);
    expect(resolveConnectorLocale(undefined)).toBe("ko");
    expect(resolveConnectorLocale("한국어")).toBe("ko");
    expect(resolveConnectorLocale("en-US")).toBe("en");
    expect(resolveConnectorLocale("简体中文")).toBe("zh");
    expect(resolveConnectorLocale("日本語")).toBe("ja");
    expect(() => resolveConnectorLocale("fr")).toThrow("Unsupported connector locale");
  });

  it("localizes common UI and dynamic metadata in Chinese and Japanese", () => {
    expect(localizeConnectorText("답변 복사", "zh")).toBe("复制回答");
    expect(localizeConnectorText("Codex 작업 완료", "zh")).toBe("Codex 任务已完成");
    expect(localizeConnectorText("위치: /tmp/project", "zh")).toBe("位置：/tmp/project");

    expect(localizeConnectorText("답변 복사", "ja")).toBe("回答をコピー");
    expect(localizeConnectorText("Codex 작업 완료", "ja")).toBe("Codex のタスクが完了しました");
    expect(localizeConnectorText("위치: /tmp/project", "ja")).toBe("場所：/tmp/project");
  });

  it("keeps Korean unchanged and translates exact, markdown, and template lines", () => {
    expect(localizeConnectorText("**답변**", "ko")).toBe("**답변**");
    expect(localizeConnectorText("**답변**", "en")).toBe("**Answer**");
    expect(localizeConnectorText("Codex 작업 완료", "en")).toBe("Codex task completed");
    expect(localizeConnectorText("위치: /tmp/project", "en")).toBe("Location: /tmp/project");
  });

  it("translates the dynamic attachment rules without changing their limits", () => {
    const source = "규칙: files에는 이 컴퓨터의 절대경로 또는 file:// URL만 넣으세요. 이미지, 동영상, 오디오 등 존재하는 일반 파일만 첨부됩니다. 파일 개수가 많으면 봇이 파일 전용 Discord 메시지 여러 개로 자동 분할하며, 답변 글과 첨부파일은 서로 다른 메시지로 전송됩니다. 현재 파일당 최대 10MiB(Discord 표기 10MB)입니다. 이보다 큰 파일은 여러 파일로 쪼개서 올리거나, 압축/리사이즈/인코딩 옵션 조정으로 용량을 낮춘 뒤 첨부하세요. 민감한 파일은 첨부하지 마세요.";
    const translated = localizeConnectorText(source, "en");

    expect(translated).toContain("Rules: files must contain absolute paths");
    expect(translated).toContain("10MiB per file (10MB as displayed by Discord)");
  });
});
