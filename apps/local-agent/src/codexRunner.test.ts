import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCodexPrompt } from "./codexRunner.js";

describe("runCodexPrompt", () => {
  it("runs codex exec and captures the final message plus session id", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
    const fakeCodex = path.join(tempRoot, "codex");
    const argsFile = path.join(tempRoot, "args.json");

    try {
      await writeFile(
        fakeCodex,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          `fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));`,
          "const outputIndex = args.indexOf('--output-last-message');",
          "fs.writeFileSync(args[outputIndex + 1], 'Codex answer from fake CLI');",
          "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'session-1' }));",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      await expect(
        runCodexPrompt({
          workspaceRoot: tempRoot,
          cwd: tempRoot,
          prompt: "Explain this",
          timeoutMs: 5_000,
          codexCommand: fakeCodex,
        }),
      ).resolves.toMatchObject({
        status: "completed",
        finalMessage: "Codex answer from fake CLI",
        sessionId: "session-1",
        stderr: "",
        exitCode: 0,
      });
      await expect(readFile(argsFile, "utf8")).resolves.toContain("Explain this");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes a selected model to codex exec prompt runs", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
    const fakeCodex = path.join(tempRoot, "codex");
    const argsFile = path.join(tempRoot, "args.json");

    try {
      await writeFile(
        fakeCodex,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          `fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));`,
          "const outputIndex = args.indexOf('--output-last-message');",
          "fs.writeFileSync(args[outputIndex + 1], 'Model answer');",
          "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'session-1' }));",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      await runCodexPrompt({
        workspaceRoot: tempRoot,
        cwd: tempRoot,
        prompt: "Explain this",
        timeoutMs: 5_000,
        model: "gpt-5.4",
        codexCommand: fakeCodex,
      });

      await expect(readFile(argsFile, "utf8")).resolves.toContain('"-m","gpt-5.4"');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes a selected reasoning effort to codex exec prompt runs", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
    const fakeCodex = path.join(tempRoot, "codex");
    const argsFile = path.join(tempRoot, "args.json");

    try {
      await writeFile(
        fakeCodex,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          `fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));`,
          "const outputIndex = args.indexOf('--output-last-message');",
          "fs.writeFileSync(args[outputIndex + 1], 'Fast answer');",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      await runCodexPrompt({
        workspaceRoot: tempRoot,
        cwd: tempRoot,
        prompt: "Explain this",
        timeoutMs: 5_000,
        reasoningEffort: "low",
        codexCommand: fakeCodex,
      });

      await expect(readFile(argsFile, "utf8")).resolves.toContain(
        '"-c","model_reasoning_effort=\\"low\\""',
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses codex exec review for review mode", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
    const fakeCodex = path.join(tempRoot, "codex");
    const argsFile = path.join(tempRoot, "args.json");

    try {
      await writeFile(
        fakeCodex,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          `fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));`,
          "const outputIndex = args.indexOf('--output-last-message');",
          "fs.writeFileSync(args[outputIndex + 1], 'Review answer');",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      await runCodexPrompt({
        workspaceRoot: tempRoot,
        cwd: tempRoot,
        prompt: "보안 위험 위주",
        timeoutMs: 5_000,
        mode: "review",
        codexCommand: fakeCodex,
      });

      await expect(readFile(argsFile, "utf8")).resolves.toContain('"exec","review"');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("streams parsed Codex JSON progress events while the process is running", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
    const fakeCodex = path.join(tempRoot, "codex");
    const events: unknown[] = [];

    try {
      await writeFile(
        fakeCodex,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          "const outputIndex = args.indexOf('--output-last-message');",
          "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'session-1' }));",
          "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'First streamed answer' } }));",
          "fs.writeFileSync(args[outputIndex + 1], 'Final answer');",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      await expect(
        runCodexPrompt({
          workspaceRoot: tempRoot,
          cwd: tempRoot,
          prompt: "Explain this",
          timeoutMs: 5_000,
          codexCommand: fakeCodex,
          onProgress: async (event) => {
            events.push(event);
          },
        }),
      ).resolves.toMatchObject({
        status: "completed",
        finalMessage: "Final answer",
        sessionId: "session-1",
      });

      expect(events).toEqual([
        { type: "thread-started", sessionId: "session-1" },
        { type: "agent-message", text: "First streamed answer" },
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("streams current Codex event_msg agent messages while the process is running", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
    const fakeCodex = path.join(tempRoot, "codex");
    const events: unknown[] = [];

    try {
      await writeFile(
        fakeCodex,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          "const outputIndex = args.indexOf('--output-last-message');",
          "console.log(JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '중간 출력입니다.', phase: 'commentary' } }));",
          "fs.writeFileSync(args[outputIndex + 1], 'Final answer');",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      await runCodexPrompt({
        workspaceRoot: tempRoot,
        cwd: tempRoot,
        prompt: "Explain this",
        timeoutMs: 5_000,
        codexCommand: fakeCodex,
        onProgress: async (event) => {
          events.push(event);
        },
      });

      expect(events).toEqual([{ type: "agent-message", text: "중간 출력입니다." }]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("streams assistant response_item messages while the process is running", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
    const fakeCodex = path.join(tempRoot, "codex");
    const events: unknown[] = [];

    try {
      await writeFile(
        fakeCodex,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          "const outputIndex = args.indexOf('--output-last-message');",
          "console.log(JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: '파일 확인 중입니다.' }] } }));",
          "fs.writeFileSync(args[outputIndex + 1], 'Final answer');",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      await runCodexPrompt({
        workspaceRoot: tempRoot,
        cwd: tempRoot,
        prompt: "Explain this",
        timeoutMs: 5_000,
        codexCommand: fakeCodex,
        onProgress: async (event) => {
          events.push(event);
        },
      });

      expect(events).toEqual([{ type: "agent-message", text: "파일 확인 중입니다." }]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats image-only Codex runs as completed and returns generated image markdown", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
    const codexHome = path.join(tempRoot, "codex-home");
    const fakeCodex = path.join(tempRoot, "codex");

    try {
      await writeFile(
        fakeCodex,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          "const args = process.argv.slice(2);",
          "const outputIndex = args.indexOf('--output-last-message');",
          "fs.writeFileSync(args[outputIndex + 1], '');",
          "const imageDir = path.join(process.env.CODEX_HOME, 'generated_images', 'session-1');",
          "fs.mkdirSync(imageDir, { recursive: true });",
          "fs.writeFileSync(path.join(imageDir, 'image.png'), 'fake png bytes');",
          "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'session-1' }));",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      await expect(
        runCodexPrompt({
          workspaceRoot: tempRoot,
          cwd: tempRoot,
          prompt: "이미지 생성",
          timeoutMs: 5_000,
          codexHome,
          codexCommand: fakeCodex,
        }),
      ).resolves.toMatchObject({
        status: "completed",
        finalMessage: `![generated image 1](${path.join(codexHome, "generated_images", "session-1", "image.png")})`,
        sessionId: "session-1",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("maps Codex tool activity into readable operation progress events", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
    const fakeCodex = path.join(tempRoot, "codex");
    const events: unknown[] = [];

    try {
      await writeFile(
        fakeCodex,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          "const outputIndex = args.indexOf('--output-last-message');",
          "console.log(JSON.stringify({ type: 'item.started', item: { type: 'function_call', name: 'exec_command', file_count: 42, arguments: JSON.stringify({ cmd: 'rg --files' }) } }));",
          "console.log(JSON.stringify({ type: 'item.started', item: { type: 'function_call', name: 'imagegen', arguments: '{}' } }));",
          "console.log(JSON.stringify({ type: 'context.compaction.started' }));",
          "fs.writeFileSync(args[outputIndex + 1], 'Final answer');",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      await runCodexPrompt({
        workspaceRoot: tempRoot,
        cwd: tempRoot,
        prompt: "Explain this",
        timeoutMs: 5_000,
        codexCommand: fakeCodex,
        onProgress: async (event) => {
          events.push(event);
        },
      });

      expect(events).toEqual([
        {
          type: "operation-progress",
          label: "파일 탐색 중",
          detail: "42개 파일 · rg --files",
          eventType: "item.started",
        },
        {
          type: "operation-progress",
          label: "이미지 생성 중",
          detail: "imagegen",
          eventType: "item.started",
        },
        {
          type: "operation-progress",
          label: "컨텍스트 압축 중",
          detail: "context.compaction.started",
          eventType: "context.compaction.started",
        },
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("streams file search completion and filename-only edit diff progress", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
    const fakeCodex = path.join(tempRoot, "codex");
    const events: unknown[] = [];
    const patchText = [
      "*** Begin Patch",
      "*** Update File: /Users/me/project/src/n.ts",
      "@@",
      "-old line",
      "+new line",
      "+another line",
      "*** End Patch",
    ].join("\n");

    try {
      await writeFile(
        fakeCodex,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          "const outputIndex = args.indexOf('--output-last-message');",
          "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'function_call', name: 'exec_command', file_count: 3, arguments: JSON.stringify({ cmd: 'rg --files' }) } }));",
          `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'function_call', name: 'apply_patch', arguments: JSON.stringify({ patch: ${JSON.stringify(patchText)} }) } }));`,
          "fs.writeFileSync(args[outputIndex + 1], 'Final answer');",
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      await runCodexPrompt({
        workspaceRoot: tempRoot,
        cwd: tempRoot,
        prompt: "Explain this",
        timeoutMs: 5_000,
        codexCommand: fakeCodex,
        onProgress: async (event) => {
          events.push(event);
        },
      });

      expect(events).toEqual([
        {
          type: "operation-progress",
          label: "탐색마침",
          detail: "3개 파일 · rg --files",
          eventType: "item.completed",
        },
        {
          type: "operation-progress",
          label: "파일 수정 완료",
          detail: "편집함 n.ts +2 -1",
          eventType: "item.completed",
        },
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
