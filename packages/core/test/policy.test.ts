import { describe, expect, it } from "vitest";
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
});
