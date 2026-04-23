import { promisify } from "node:util";
import { exec as execCallback } from "node:child_process";
import path from "node:path";
import { classifyCommand } from "@codex-discord/core";
import { assertInsideWorkspace } from "./workspace.js";

const exec = promisify(execCallback);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export interface RunWorkspaceCommandInput {
  workspaceRoot: string;
  cwd: string;
  command: string;
  timeoutMs: number;
  confirmedDangerous: boolean;
}

export interface RunWorkspaceCommandResult {
  status: "completed" | "blocked" | "failed";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cwd?: string;
  signal?: string | null;
  killed?: boolean;
  timedOut?: boolean;
}

function parseCdTarget(command: string): string | null {
  const trimmedCommand = command.trim();

  if (trimmedCommand === "cd") {
    return "";
  }

  if (trimmedCommand.startsWith("cd ")) {
    return trimmedCommand.slice(3).trim();
  }

  return null;
}

export async function runWorkspaceCommand(input: RunWorkspaceCommandInput): Promise<RunWorkspaceCommandResult> {
  const cwd = assertInsideWorkspace(input.workspaceRoot, input.cwd);
  const classification = classifyCommand(input.command);

  if (classification.requiresConfirmation && !input.confirmedDangerous) {
    return {
      status: "blocked",
      stdout: "",
      stderr: "Command requires confirmation before running.",
      exitCode: null,
    };
  }

  const cdTarget = parseCdTarget(input.command);

  if (cdTarget !== null) {
    const targetPath = cdTarget.length === 0 ? input.workspaceRoot : path.resolve(cwd, cdTarget);
    const nextCwd = assertInsideWorkspace(input.workspaceRoot, targetPath);

    return {
      status: "completed",
      stdout: `${nextCwd}\n`,
      stderr: "",
      exitCode: 0,
      cwd: nextCwd,
    };
  }

  try {
    const result = await exec(input.command, {
      cwd,
      shell: "/bin/zsh",
      timeout: input.timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
    });

    return {
      status: "completed",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    const execError = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | null;
      signal?: string | null;
      killed?: boolean;
    };
    const signal = execError.signal ?? null;
    const killed = execError.killed ?? false;
    const timedOut = Boolean(killed && signal === "SIGTERM" && input.timeoutMs > 0);

    return {
      status: "failed",
      stdout: typeof execError.stdout === "string" ? execError.stdout : execError.stdout?.toString() ?? "",
      stderr: typeof execError.stderr === "string" ? execError.stderr : execError.stderr?.toString() ?? "",
      exitCode: typeof execError.code === "number" ? execError.code : null,
      signal,
      killed,
      timedOut,
    };
  }
}
