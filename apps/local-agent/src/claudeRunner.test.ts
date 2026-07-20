import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runClaudePrompt } from "./claudeRunner.js";

describe("runClaudePrompt", () => {
  it("returns a coded failure when Claude Code is missing", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-runner-"));

    try {
      await expect(
        runClaudePrompt({
          workspaceRoot: tempRoot,
          cwd: tempRoot,
          prompt: "Explain this",
          timeoutMs: 5_000,
          claudeCommand: path.join(tempRoot, "missing-claude"),
        }),
      ).resolves.toMatchObject({
        status: "failed",
        finalMessage: "",
        sessionId: null,
        stderr: "Claude Code command was not found. Install Claude Code or set CODEX_DISCORD_CLAUDE_COMMAND.",
        exitCode: null,
        errorCode: "CLAUDE_CLI_NOT_FOUND",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs Claude Code headless and captures stream-json progress and result", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-runner-"));
    const fakeClaude = path.join(tempRoot, "claude");
    const events: unknown[] = [];

    try {
      await writeFile(
        fakeClaude,
        [
          "#!/usr/bin/env node",
          "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session-1' }));",
          "console.log(JSON.stringify({ type: 'assistant', session_id: 'claude-session-1', message: { content: [{ type: 'tool_use', name: 'Read' }] } }));",
          "console.log(JSON.stringify({ type: 'assistant', session_id: 'claude-session-1', message: { content: [{ type: 'text', text: '중간 설명입니다.' }] } }));",
          "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'claude-session-1', result: '최종 답변입니다.' }));",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeClaude, 0o755);

      await expect(
        runClaudePrompt({
          workspaceRoot: tempRoot,
          cwd: tempRoot,
          prompt: "Explain this",
          timeoutMs: 5_000,
          claudeCommand: fakeClaude,
          onProgress: (event) => {
            events.push(event);
          },
        }),
      ).resolves.toMatchObject({
        status: "completed",
        finalMessage: "최종 답변입니다.",
        sessionId: "claude-session-1",
        stderr: "",
        exitCode: 0,
      });
      expect(events).toEqual([
        { type: "thread-started", sessionId: "claude-session-1" },
        {
          type: "operation-progress",
          label: "Claude 도구 실행 중",
          detail: "Read",
          eventType: "tool_use",
        },
        { type: "agent-message", text: "중간 설명입니다." },
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
