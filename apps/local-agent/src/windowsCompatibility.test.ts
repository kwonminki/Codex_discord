import { describe, expect, it } from "vitest";
import { classifyCommand } from "../../../packages/core/src/index.js";
import { defaultAppServerTransportKind } from "./codexAppServerRunner.js";
import { buildWorkspaceCommandInvocation } from "./runner.js";

describe("native Windows compatibility", () => {
  it("uses a loopback TCP app-server transport", () => {
    expect(defaultAppServerTransportKind("win32")).toBe("tcp");
  });

  it("runs admin commands through a noninteractive PowerShell process", () => {
    expect(buildWorkspaceCommandInvocation("Get-Location", "win32", {})).toEqual({
      executable: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Get-Location",
      ],
    });
  });

  it("requires confirmation for destructive PowerShell commands", () => {
    expect(classifyCommand("Remove-Item -Recurse -Force .\\build")).toEqual({
      tier: "dangerous-mutate",
      requiresConfirmation: true,
    });
    expect(classifyCommand("Get-ChildItem -Force")).toEqual({
      tier: "safe-read",
      requiresConfirmation: false,
    });
  });
});
