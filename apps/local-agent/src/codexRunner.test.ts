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
});
