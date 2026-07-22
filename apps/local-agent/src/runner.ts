import { promisify } from "node:util";
import { exec as execCallback, execFile as execFileCallback } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { classifyCommand } from "../../../packages/core/src/index.js";
import { assertInsideWorkspace } from "./workspace.js";

const exec = promisify(execCallback);
const execFile = promisify(execFileCallback);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const FILE_BROWSER_PAGE_SIZE = 25;
const FILE_PREVIEW_BYTES = 12 * 1024;

export interface FileBrowserEntry {
  name: string;
  kind: "directory" | "file" | "other";
}

export type CommandUiPayload =
  | {
      kind: "file-browser";
      page: number;
      pageSize: number;
      totalEntries: number;
      entries: FileBrowserEntry[];
    }
  | {
      kind: "file-card";
      path: string;
      preview: string;
    };

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
  ui?: CommandUiPayload;
}

export interface WorkspaceCommandInvocation {
  executable: string;
  args: string[];
}

export function buildWorkspaceCommandInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceCommandInvocation | null {
  if (platform !== "win32") {
    return null;
  }

  return {
    executable: env.CONNECT_WORKSPACE_SHELL?.trim() || "powershell.exe",
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ],
  };
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

function unquoteCdTarget(target: string): string {
  const trimmedTarget = target.trim();

  if (trimmedTarget.length >= 2) {
    const quote = trimmedTarget[0];
    if ((quote === "'" || quote === '"') && trimmedTarget[trimmedTarget.length - 1] === quote) {
      return trimmedTarget.slice(1, -1);
    }
  }

  return trimmedTarget;
}

function parseInternalCommand(command: string):
  | { kind: "file-browser"; page: number }
  | { kind: "open"; target: string }
  | { kind: "view"; target: string }
  | null {
  const trimmedCommand = command.trim();
  const browserMatch = trimmedCommand.match(/^__cdc_ls(?:\s+(\d+))?$/);

  if (trimmedCommand === "ls" || browserMatch) {
    return {
      kind: "file-browser",
      page: Math.max(0, Number.parseInt(browserMatch?.[1] ?? "0", 10) || 0),
    };
  }

  const openMatch = trimmedCommand.match(/^__cdc_open\s+(.+)$/);

  if (openMatch) {
    return { kind: "open", target: openMatch[1] };
  }

  const viewMatch = trimmedCommand.match(/^__cdc_view\s+(.+)$/);

  if (viewMatch) {
    return { kind: "view", target: viewMatch[1] };
  }

  return null;
}

function fileKind(input: { isDirectory(): boolean; isFile(): boolean }): FileBrowserEntry["kind"] {
  if (input.isDirectory()) {
    return "directory";
  }

  if (input.isFile()) {
    return "file";
  }

  return "other";
}

function formatBrowserEntry(entry: FileBrowserEntry): string {
  return entry.kind === "directory" ? `${entry.name}/` : entry.name;
}

async function listFileBrowser(input: {
  workspaceRoot: string;
  cwd: string;
  page: number;
}): Promise<RunWorkspaceCommandResult> {
  const cwd = assertInsideWorkspace(input.workspaceRoot, input.cwd);
  const dirents = await readdir(cwd, { withFileTypes: true });
  const allEntries = dirents
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      kind: fileKind(entry),
    }))
    .sort((a, b) => {
      if (a.kind === "directory" && b.kind !== "directory") {
        return -1;
      }

      if (a.kind !== "directory" && b.kind === "directory") {
        return 1;
      }

      return a.name.localeCompare(b.name);
    });
  const totalPages = Math.max(1, Math.ceil(allEntries.length / FILE_BROWSER_PAGE_SIZE));
  const page = Math.min(Math.max(0, input.page), totalPages - 1);
  const entries = allEntries.slice(
    page * FILE_BROWSER_PAGE_SIZE,
    page * FILE_BROWSER_PAGE_SIZE + FILE_BROWSER_PAGE_SIZE,
  );

  return {
    status: "completed",
    stdout: `${entries.map(formatBrowserEntry).join("\n")}${entries.length > 0 ? "\n" : ""}`,
    stderr: "",
    exitCode: 0,
    cwd,
    ui: {
      kind: "file-browser",
      page,
      pageSize: FILE_BROWSER_PAGE_SIZE,
      totalEntries: allEntries.length,
      entries,
    },
  };
}

function safeRelativePath(workspaceRoot: string, targetPath: string): string {
  const relativePath = path.relative(assertInsideWorkspace(workspaceRoot, workspaceRoot), targetPath);
  return relativePath.length > 0 ? relativePath : ".";
}

function resolveInsideWorkspaceCandidate(input: {
  workspaceRoot: string;
  cwd: string;
  target: string;
}): string {
  const workspaceRoot = assertInsideWorkspace(input.workspaceRoot, input.workspaceRoot);
  const targetPath = path.resolve(input.cwd, unquoteCdTarget(input.target));
  const relativePath = path.relative(workspaceRoot, targetPath);

  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error("Path escapes workspace root");
  }

  return targetPath;
}

async function previewFile(input: {
  workspaceRoot: string;
  filePath: string;
}): Promise<RunWorkspaceCommandResult> {
  const previewBuffer = await readFile(input.filePath).then((buffer) => buffer.subarray(0, FILE_PREVIEW_BYTES));
  const preview = previewBuffer.toString("utf8");
  const relativePath = safeRelativePath(input.workspaceRoot, input.filePath);

  return {
    status: "completed",
    stdout: preview,
    stderr: "",
    exitCode: 0,
    ui: {
      kind: "file-card",
      path: relativePath,
      preview,
    },
  };
}

async function runFileBrowserTarget(input: {
  workspaceRoot: string;
  cwd: string;
  target: string;
  viewOnly: boolean;
}): Promise<RunWorkspaceCommandResult> {
  const cwd = assertInsideWorkspace(input.workspaceRoot, input.cwd);
  let targetPath: string;

  try {
    targetPath = resolveInsideWorkspaceCandidate({
      workspaceRoot: input.workspaceRoot,
      cwd,
      target: input.target,
    });
  } catch (error) {
    return {
      status: "blocked",
      stdout: "",
      stderr: error instanceof Error ? error.message : "Path escapes workspace root",
      exitCode: null,
    };
  }

  const targetStat = await stat(targetPath).catch(() => null);

  if (!targetStat) {
    return {
      status: "failed",
      stdout: "",
      stderr: "Target does not exist.",
      exitCode: 1,
    };
  }

  try {
    targetPath = assertInsideWorkspace(input.workspaceRoot, targetPath);
  } catch (error) {
    return {
      status: "blocked",
      stdout: "",
      stderr: error instanceof Error ? error.message : "Path escapes workspace root",
      exitCode: null,
    };
  }

  if (targetStat.isDirectory()) {
    if (input.viewOnly) {
      return listFileBrowser({
        workspaceRoot: input.workspaceRoot,
        cwd: targetPath,
        page: 0,
      });
    }

    return listFileBrowser({
      workspaceRoot: input.workspaceRoot,
      cwd: targetPath,
      page: 0,
    });
  }

  if (!targetStat.isFile()) {
    return {
      status: "failed",
      stdout: "",
      stderr: "Target is not a regular file.",
      exitCode: 1,
    };
  }

  return previewFile({
    workspaceRoot: input.workspaceRoot,
    filePath: targetPath,
  });
}

async function runCdCommand(input: {
  workspaceRoot: string;
  cwd: string;
  cdTarget: string;
}): Promise<RunWorkspaceCommandResult> {
  const cwd = assertInsideWorkspace(input.workspaceRoot, input.cwd);
  const target = unquoteCdTarget(input.cdTarget);
  const targetPath = target.length === 0 ? input.workspaceRoot : path.resolve(cwd, target);
  let nextCwd: string;

  try {
    nextCwd = assertInsideWorkspace(input.workspaceRoot, targetPath);
  } catch (error) {
    return {
      status: "blocked",
      stdout: "",
      stderr: error instanceof Error ? error.message : "Path escapes workspace root",
      exitCode: null,
    };
  }

  const targetStat = await stat(nextCwd).catch(() => null);

  if (!targetStat) {
    return {
      status: "failed",
      stdout: "",
      stderr: "Target directory does not exist.",
      exitCode: 1,
    };
  }

  if (!targetStat.isDirectory()) {
    return {
      status: "failed",
      stdout: "",
      stderr: "Target is not a directory.",
      exitCode: 1,
    };
  }

  return {
    status: "completed",
    stdout: `${nextCwd}\n`,
    stderr: "",
    exitCode: 0,
    cwd: nextCwd,
  };
}

export async function runWorkspaceCommand(input: RunWorkspaceCommandInput): Promise<RunWorkspaceCommandResult> {
  const cwd = assertInsideWorkspace(input.workspaceRoot, input.cwd);
  const internalCommand = parseInternalCommand(input.command);

  if (internalCommand?.kind === "file-browser") {
    return listFileBrowser({
      workspaceRoot: input.workspaceRoot,
      cwd,
      page: internalCommand.page,
    });
  }

  if (internalCommand?.kind === "open" || internalCommand?.kind === "view") {
    return runFileBrowserTarget({
      workspaceRoot: input.workspaceRoot,
      cwd,
      target: internalCommand.target,
      viewOnly: internalCommand.kind === "view",
    });
  }

  const cdTarget = parseCdTarget(input.command);

  if (cdTarget !== null) {
    return runCdCommand({
      workspaceRoot: input.workspaceRoot,
      cwd,
      cdTarget,
    });
  }

  const classification = classifyCommand(input.command);

  if (classification.requiresConfirmation && !input.confirmedDangerous) {
    return {
      status: "blocked",
      stdout: "",
      stderr: "Command requires confirmation before running.",
      exitCode: null,
    };
  }

  try {
    const invocation = buildWorkspaceCommandInvocation(input.command);
    const result = invocation
      ? await execFile(invocation.executable, invocation.args, {
          cwd,
          timeout: input.timeoutMs,
          maxBuffer: MAX_BUFFER_BYTES,
          windowsHide: true,
        })
      : await exec(input.command, {
          cwd,
          shell: process.env.CONNECT_WORKSPACE_SHELL?.trim() || "/bin/zsh",
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
    const timedOut = Boolean(killed && input.timeoutMs > 0);

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
