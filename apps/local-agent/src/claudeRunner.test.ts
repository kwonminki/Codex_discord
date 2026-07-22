import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
          "console.log(JSON.stringify({ type: 'assistant', session_id: 'claude-session-1', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/README.md' } }] } }));",
          "console.log(JSON.stringify({ type: 'user', session_id: 'claude-session-1', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'README title and setup steps' }] } }));",
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
          detail: "Read · 입력: {\"file_path\":\"/repo/README.md\"}",
          eventType: "tool_use",
        },
        {
          type: "operation-progress",
          label: "Claude 도구 실행 완료",
          detail: "README title and setup steps",
          eventType: "tool_result",
        },
        { type: "agent-message", text: "중간 설명입니다." },
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes --fork-session when resuming a Claude Code session fork", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-runner-"));
    const fakeClaude = path.join(tempRoot, "claude");
    const argsPath = path.join(tempRoot, "args.json");

    try {
      await writeFile(
        fakeClaude,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          `fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));`,
          "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-fork-session-1' }));",
          "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'claude-fork-session-1', result: 'fork ready' }));",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeClaude, 0o755);

      await expect(
        runClaudePrompt({
          workspaceRoot: tempRoot,
          cwd: tempRoot,
          prompt: "Fork this session",
          timeoutMs: 5_000,
          claudeCommand: fakeClaude,
          sessionId: "claude-source-session-1",
          forkSession: true,
          sessionName: "GPU experiment",
        }),
      ).resolves.toMatchObject({
        status: "completed",
        sessionId: "claude-fork-session-1",
      });

      const args = JSON.parse(await readFile(argsPath, "utf8")) as string[];
      expect(args).toEqual(
        expect.arrayContaining([
          "--resume",
          "claude-source-session-1",
          "--fork-session",
          "--name",
          "GPU experiment",
        ]),
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes selected model and effort to Claude Code", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-runner-"));
    const fakeClaude = path.join(tempRoot, "claude");
    const argsPath = path.join(tempRoot, "args.json");

    try {
      await writeFile(
        fakeClaude,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          `fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));`,
          "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'claude-session-1', result: 'done' }));",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeClaude, 0o755);

      await runClaudePrompt({
        workspaceRoot: tempRoot,
        cwd: tempRoot,
        prompt: "Use the configured model",
        timeoutMs: 5_000,
        claudeCommand: fakeClaude,
        model: "claude-fable-5[1m]",
        effort: "max",
      });

      const args = JSON.parse(await readFile(argsPath, "utf8")) as string[];
      expect(args).toEqual(expect.arrayContaining([
        "--model",
        "claude-fable-5[1m]",
        "--effort",
        "max",
      ]));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
