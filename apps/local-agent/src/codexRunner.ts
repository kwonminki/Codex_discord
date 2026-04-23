import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface RunCodexPromptInput {
  workspaceRoot: string;
  cwd: string;
  prompt: string;
  timeoutMs: number;
  sessionId?: string | null;
  codexHome?: string;
  codexCommand?: string;
}

export interface RunCodexPromptResult {
  status: "completed" | "failed";
  finalMessage: string;
  sessionId: string | null;
  stderr: string;
  exitCode: number | null;
  signal?: string | null;
  timedOut?: boolean;
}

function isAscii(value: string): boolean {
  return /^[\x00-\x7F]*$/.test(value);
}

function workspaceAliasName(workspaceRoot: string): string {
  return Buffer.from(workspaceRoot).toString("hex").slice(0, 48);
}

async function ensureAsciiWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

  if (isAscii(resolvedWorkspaceRoot)) {
    return resolvedWorkspaceRoot;
  }

  const aliasRoot = path.join(os.tmpdir(), "codex-discord-workspaces");
  const aliasPath = path.join(aliasRoot, workspaceAliasName(resolvedWorkspaceRoot));
  await mkdir(aliasRoot, { recursive: true });

  try {
    if ((await readlink(aliasPath)) === resolvedWorkspaceRoot) {
      return aliasPath;
    }

    await unlink(aliasPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  await symlink(resolvedWorkspaceRoot, aliasPath, "dir");
  return aliasPath;
}

function parseThreadId(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) {
      continue;
    }

    try {
      const event = JSON.parse(line) as { type?: unknown; thread_id?: unknown };

      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        return event.thread_id;
      }
    } catch {
      // Codex may emit non-JSON warnings next to JSON events; ignore those lines.
    }
  }

  return null;
}

function createCodexArgs(input: RunCodexPromptInput, outputPath: string, workspaceRoot: string): string[] {
  if (input.sessionId) {
    return [
      "exec",
      "resume",
      "--json",
      "--full-auto",
      "--output-last-message",
      outputPath,
      input.sessionId,
      input.prompt,
    ];
  }

  return [
    "exec",
    "--json",
    "--full-auto",
    "--skip-git-repo-check",
    "--cd",
    workspaceRoot,
    "--output-last-message",
    outputPath,
    input.prompt,
  ];
}

export async function runCodexPrompt(input: RunCodexPromptInput): Promise<RunCodexPromptResult> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-discord-run-"));
  const outputPath = path.join(tempRoot, `${randomBytes(8).toString("hex")}.txt`);
  const workspaceRoot = await ensureAsciiWorkspaceRoot(input.workspaceRoot);
  const args = createCodexArgs(input, outputPath, workspaceRoot);
  const codexCommand = input.codexCommand ?? "codex";
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  try {
    const child = spawn(codexCommand, args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ...(input.codexHome ? { CODEX_HOME: input.codexHome } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const result = await new Promise<{
      exitCode: number | null;
      signal: string | null;
      timedOut: boolean;
    }>((resolve, reject) => {
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, input.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (exitCode, signal) => {
        clearTimeout(timeout);
        resolve({ exitCode, signal, timedOut });
      });
    });

    const stdout = Buffer.concat(stdoutChunks).toString("utf8");
    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    const finalMessage = await readFile(outputPath, "utf8").catch(() => "");
    const sessionId = parseThreadId(stdout) ?? input.sessionId ?? null;
    const completed = result.exitCode === 0 && finalMessage.trim().length > 0 && !result.timedOut;

    return {
      status: completed ? "completed" : "failed",
      finalMessage: finalMessage.trimEnd(),
      sessionId,
      stderr,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
