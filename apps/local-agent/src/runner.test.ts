import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertInsideWorkspace } from "./workspace.js";
import { runWorkspaceCommand } from "./runner.js";

async function makeWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-agent-"));
  return workspaceRoot;
}

afterEach(async () => {
  // No shared fixtures to clean up here; each test manages its own temp dir.
});

describe("workspace guard", () => {
  it("throws when a target escapes the workspace root", async () => {
    const workspaceRoot = await makeWorkspace();

    expect(() => assertInsideWorkspace(workspaceRoot, path.dirname(workspaceRoot))).toThrow(
      "Path escapes workspace root",
    );

    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });
});

describe("runWorkspaceCommand", () => {
  it("runs a safe read command inside the workspace", async () => {
    const workspaceRoot = await makeWorkspace();

    try {
      await fs.writeFile(path.join(workspaceRoot, "README.md"), "workspace hello\n", "utf8");

      const result = await runWorkspaceCommand({
        workspaceRoot,
        cwd: workspaceRoot,
        command: "cat README.md",
        timeoutMs: 5_000,
        confirmedDangerous: false,
      });

      expect(result).toEqual({
        status: "completed",
        stdout: expect.stringContaining("workspace hello"),
        stderr: "",
        exitCode: 0,
      });
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("blocks dangerous commands when confirmation is missing", async () => {
    const workspaceRoot = await makeWorkspace();

    try {
      await fs.writeFile(path.join(workspaceRoot, "README.md"), "workspace hello\n", "utf8");

      const result = await runWorkspaceCommand({
        workspaceRoot,
        cwd: workspaceRoot,
        command: "rm README.md",
        timeoutMs: 5_000,
        confirmedDangerous: false,
      });

      expect(result.status).toBe("blocked");
      expect(result.exitCode).toBeNull();
      expect(result.stderr).toContain("confirmation");
      expect(result.stdout).toBe("");
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
