import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareAgentCompletionAnswer } from "./agentCompletionAnswer.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("prepareAgentCompletionAnswer", () => {
  it("sanitizes mentions and attaches a complete copy when the preview is long", () => {
    const result = prepareAgentCompletionAnswer({
      answer: `@operator ${"long answer ".repeat(30)}`,
      attachmentName: "answer.txt",
      maxPreviewChars: 80,
    });

    expect(result.description).toContain("[at]operator");
    expect(result.clipped).toBe(true);
    expect(result.files[0]).toMatchObject({ name: "answer.txt" });
    expect(Buffer.isBuffer(result.files[0]?.attachment)).toBe(true);
  });

  it("extracts connector file blocks for either agent notification", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-completion-answer-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "result.txt");
    await writeFile(filePath, "result", "utf8");

    const result = prepareAgentCompletionAnswer({
      answer: [
        "완료했습니다.",
        "```codex-discord-send",
        JSON.stringify({ message: "파일입니다.", files: [filePath] }),
        "```",
      ].join("\n"),
      attachmentName: "answer.txt",
    });

    expect(result.answer).toContain("완료했습니다.");
    expect(result.answer).toContain("파일입니다.");
    expect(result.answer).not.toContain("codex-discord-send");
    expect(result.files).toEqual([expect.objectContaining({ attachment: filePath })]);
  });
});
