import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  authorizeCommand,
  classifyCommand,
  parseDiscordMessageCommand,
  updateCwd,
} from "../src/policy.js";

describe("command policy", () => {
  it("classifies safe read, normal mutate, and dangerous mutate commands", () => {
    expect(classifyCommand("ls -la").tier).toBe("safe-read");
    expect(classifyCommand("mkdir reports").tier).toBe("normal-mutate");
    expect(classifyCommand("rm -rf reports").tier).toBe("dangerous-mutate");
  });

  it("treats shell wrappers and control operators as dangerous mutate commands", () => {
    expect(classifyCommand("sudo rm -rf /").tier).toBe("dangerous-mutate");
    expect(classifyCommand("command rm -rf /").tier).toBe("dangerous-mutate");
    expect(classifyCommand("exec rm -rf /").tier).toBe("dangerous-mutate");
    expect(classifyCommand('bash -lc "rm -rf /"').tier).toBe("dangerous-mutate");
    expect(classifyCommand("ls && rm -rf /").tier).toBe("dangerous-mutate");
    expect(classifyCommand("git reset --hard HEAD").tier).toBe("dangerous-mutate");
    expect(classifyCommand("git\treset --hard HEAD").tier).toBe("dangerous-mutate");
    expect(classifyCommand("git\nreset --hard HEAD").tier).toBe("dangerous-mutate");
  });

  it("keeps simple pipelines readable when every segment is safe read", () => {
    expect(classifyCommand("ls | grep foo").tier).toBe("safe-read");
    expect(classifyCommand('grep "foo|bar" file').tier).toBe("safe-read");
    expect(classifyCommand("grep foo\\|bar file").tier).toBe("safe-read");
  });

  it("allows bare commands only in shell-admin channels", () => {
    expect(parseDiscordMessageCommand({ mode: "shell-admin", content: "ls" })).toEqual({
      kind: "command",
      command: "ls",
    });
    expect(parseDiscordMessageCommand({ mode: "session-linked", content: "ls" })).toEqual({
      kind: "chat",
      content: "ls",
    });
    expect(parseDiscordMessageCommand({ mode: "session-linked", content: "!ls" })).toEqual({
      kind: "command",
      command: "ls",
    });
  });

  it("requires an allowed role", () => {
    expect(
      authorizeCommand({
        userRoleIds: ["role-operator"],
        allowedRoleIds: ["role-operator"],
      }).allowed,
    ).toBe(true);

    expect(
      authorizeCommand({
        userRoleIds: ["role-viewer"],
        allowedRoleIds: ["role-operator"],
      }).allowed,
    ).toBe(false);
  });

  it("updates cwd only when the next path remains inside workspace root", () => {
    expect(updateCwd("/repo", "/repo/src", "..")).toBe("/repo");
    expect(() => updateCwd("/repo", "/repo", "..")).toThrow("Path escapes workspace root");
  });

  it("blocks symlink escapes from the workspace root", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-policy-"));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-policy-outside-"));
    const symlinkPath = path.join(workspaceRoot, "outside-link");

    fs.symlinkSync(outsideRoot, symlinkPath);

    expect(() => updateCwd(workspaceRoot, workspaceRoot, "outside-link")).toThrow(
      "Path escapes workspace root",
    );
  });
});
