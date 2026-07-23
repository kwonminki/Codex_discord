import { spawn } from "node:child_process";

export type ClaudeRunnerProgressEvent =
  | { type: "thread-started"; sessionId: string }
  | { type: "agent-message"; text: string }
  | { type: "operation-progress"; label: string; detail?: string; eventType: string };

export interface RunClaudePromptInput {
  workspaceRoot: string;
  cwd: string;
  prompt: string;
  timeoutMs: number;
  controlKey?: string | null;
  sessionId?: string | null;
  forkSession?: boolean;
  sessionName?: string | null;
  claudeCommand?: string | null;
  permissionMode?: string | null;
  model?: string | null;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  onProgress?: (event: ClaudeRunnerProgressEvent) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface RunClaudePromptResult {
  status: "completed" | "failed";
  finalMessage: string;
  sessionId: string | null;
  stderr: string;
  exitCode: number | null;
  errorCode?: string;
}

export interface ClaudeTurnControlResult {
  status: "accepted" | "no-active-turn" | "unsupported" | "failed";
  message: string;
  threadId?: string;
}

interface ActiveClaudeTurn {
  send(content: string): Promise<ClaudeTurnControlResult>;
  interrupt(): ClaudeTurnControlResult;
}

const activeClaudeTurns = new Map<string, ActiveClaudeTurn>();

export async function steerActiveClaudeTurn(
  controlKey: string,
  content: string,
): Promise<ClaudeTurnControlResult> {
  const activeTurn = activeClaudeTurns.get(controlKey);
  if (!activeTurn) {
    return {
      status: "no-active-turn",
      message: "No active Claude Code turn is available for steering.",
    };
  }

  return activeTurn.send(content);
}

export function interruptActiveClaudeTurn(
  controlKey: string,
): ClaudeTurnControlResult {
  const activeTurn = activeClaudeTurns.get(controlKey);
  if (!activeTurn) {
    return {
      status: "no-active-turn",
      message: "No active Claude Code turn is available to interrupt.",
    };
  }

  return activeTurn.interrupt();
}

function resolveClaudeCommand(input: { claudeCommand?: string | null }): string {
  return input.claudeCommand?.trim() || process.env.CODEX_DISCORD_CLAUDE_COMMAND?.trim() || "claude";
}

function resolvePermissionMode(input: { permissionMode?: string | null }): string | null {
  return input.permissionMode?.trim() || process.env.CODEX_DISCORD_CLAUDE_PERMISSION_MODE?.trim() || "bypassPermissions";
}

function claudeArgs(input: RunClaudePromptInput): string[] {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--include-hook-events",
  ];
  const permissionMode = resolvePermissionMode(input);

  if (input.sessionId?.trim()) {
    args.push("--resume", input.sessionId.trim());
  }

  if (input.forkSession && input.sessionId?.trim()) {
    args.push("--fork-session");
  }

  if (input.sessionName?.trim()) {
    args.push("--name", input.sessionName.trim());
  }

  if (input.model?.trim()) {
    args.push("--model", input.model.trim());
  }

  if (input.effort?.trim()) {
    args.push("--effort", input.effort.trim());
  }

  if (permissionMode) {
    args.push("--permission-mode", permissionMode);
  }

  return args;
}

function claudeUserMessage(content: string): string {
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: content }],
    },
    parent_tool_use_id: null,
  })}\n`;
}

function spawnFailure(claudeCommand: string, error: NodeJS.ErrnoException): RunClaudePromptResult {
  if (error.code === "ENOENT") {
    return {
      status: "failed",
      finalMessage: "",
      sessionId: null,
      stderr: "Claude Code command was not found. Install Claude Code or set CODEX_DISCORD_CLAUDE_COMMAND.",
      exitCode: null,
      errorCode: "CLAUDE_CLI_NOT_FOUND",
    };
  }

  if (error.code === "EACCES") {
    return {
      status: "failed",
      finalMessage: "",
      sessionId: null,
      stderr: `Claude Code command is not executable: ${claudeCommand}`,
      exitCode: null,
      errorCode: "CLAUDE_CLI_NOT_EXECUTABLE",
    };
  }

  return {
    status: "failed",
    finalMessage: "",
    sessionId: null,
    stderr: error.message,
    exitCode: null,
    errorCode: error.code ? `CLAUDE_CLI_SPAWN_${error.code}` : "CLAUDE_CLI_SPAWN_FAILED",
  };
}

function compactDetail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const compact = value.replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim();
  return compact.length > 0 ? compact.slice(0, 480) : undefined;
}

function structuredDetail(value: unknown): string | undefined {
  if (typeof value === "string") {
    return compactDetail(value);
  }

  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    const serialized = JSON.stringify(value, (key, nestedValue) =>
      /token|secret|password|authorization|cookie|api.?key/i.test(key) ? "[redacted]" : nestedValue,
    );
    return serialized && serialized !== "{}" && serialized !== "[]" ? compactDetail(serialized) : undefined;
  } catch {
    return undefined;
  }
}

function textFromClaudeContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      const record = item as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function toolProgressFromClaudeContent(content: unknown): ClaudeRunnerProgressEvent | null {
  if (!Array.isArray(content)) {
    return null;
  }

  const toolUses = content.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "tool_use",
  );

  if (toolUses.length === 0) {
    return null;
  }

  const details = toolUses.map((toolUse) => {
    const name = compactDetail(toolUse.name) ?? "unknown tool";
    const toolInput = structuredDetail(toolUse.input);
    return toolInput ? `${name} · 입력: ${toolInput}` : name;
  });

  return {
    type: "operation-progress",
    label: "Claude 도구 실행 중",
    detail: compactDetail(details.join(" | ")),
    eventType: "tool_use",
  };
}

function toolResultProgressFromClaudeContent(content: unknown): ClaudeRunnerProgressEvent | null {
  if (!Array.isArray(content)) {
    return null;
  }

  const toolResults = content.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "tool_result",
  );

  if (toolResults.length === 0) {
    return null;
  }

  const failed = toolResults.some((result) => result.is_error === true);
  const details = toolResults.flatMap((result) => {
    const resultDetail = structuredDetail(result.content);
    return resultDetail ? [resultDetail] : [];
  });

  return {
    type: "operation-progress",
    label: failed ? "Claude 도구 실행 실패" : "Claude 도구 실행 완료",
    detail: details.length > 0 ? compactDetail(details.join(" | ")) : undefined,
    eventType: "tool_result",
  };
}

function parseClaudeStreamLine(line: string): {
  sessionId?: string;
  finalMessage?: string;
  progressEvents?: ClaudeRunnerProgressEvent[];
  turnEnded?: boolean;
  isResult?: boolean;
  isError?: boolean;
} | null {
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : undefined;

  if (parsed.type === "system" && sessionId) {
    return {
      sessionId,
      progressEvents: [{ type: "thread-started", sessionId }],
    };
  }

  if (parsed.type === "assistant") {
    const message = parsed.message as Record<string, unknown> | undefined;
    const content = message?.content;
    const text = textFromClaudeContent(content);
    const toolProgress = toolProgressFromClaudeContent(content);
    const stopReason = typeof message?.stop_reason === "string" ? message.stop_reason : null;

    const progressEvents: ClaudeRunnerProgressEvent[] = [
      ...(toolProgress ? [toolProgress] : []),
      ...(text ? [{ type: "agent-message" as const, text }] : []),
    ];

    return {
      sessionId,
      ...(progressEvents.length > 0 ? { progressEvents } : {}),
      ...(stopReason && stopReason !== "tool_use" && stopReason !== "pause_turn"
        ? { turnEnded: true }
        : {}),
    };
  }

  if (parsed.type === "user") {
    const message = parsed.message as Record<string, unknown> | undefined;
    const toolResult = toolResultProgressFromClaudeContent(message?.content);
    return toolResult ? { sessionId, progressEvents: [toolResult] } : { sessionId };
  }

  if (parsed.type === "result") {
    const finalMessage =
      typeof parsed.result === "string" && parsed.result.trim().length > 0
        ? parsed.result.trim()
        : undefined;
    return {
      sessionId,
      finalMessage,
      isResult: true,
      isError: parsed.is_error === true || parsed.subtype === "error",
    };
  }

  if (parsed.type === "hook") {
    return {
      sessionId,
      progressEvents: [{
        type: "operation-progress",
        label: "Claude hook 실행 중",
        detail: structuredDetail(parsed.hook_event_name) ?? structuredDetail(parsed.hook_event),
        eventType: "hook",
      }],
    };
  }

  return { sessionId };
}

export async function runClaudePrompt(input: RunClaudePromptInput): Promise<RunClaudePromptResult> {
  const claudeCommand = resolveClaudeCommand(input);
  const args = claudeArgs(input);
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const progressTasks: Promise<void>[] = [];
  let lineBuffer = "";
  let sessionId: string | null = input.sessionId ?? null;
  let lastAssistantMessage = "";
  let finalMessage = "";
  let resultWasError = false;
  let resultSeen = false;
  let turnEnded = false;

  const interruptedResult = (): RunClaudePromptResult => ({
    status: "failed",
    finalMessage: lastAssistantMessage,
    sessionId,
    stderr: "Claude Code prompt was interrupted.",
    exitCode: null,
    errorCode: "CLAUDE_PROMPT_INTERRUPTED",
  });

  if (input.signal?.aborted) {
    return interruptedResult();
  }

  function handleLine(line: string): void {
    const event = parseClaudeStreamLine(line);

    if (!event) {
      return;
    }

    if (event.sessionId) {
      sessionId = event.sessionId;
    }

    if (event.finalMessage) {
      finalMessage = event.finalMessage;
    }

    if (event.isResult) {
      resultSeen = true;
      resultWasError = event.isError === true;
    }
    if (event.turnEnded) {
      turnEnded = true;
    }

    for (const progress of event.progressEvents ?? []) {
      if (progress.type === "agent-message") {
        lastAssistantMessage = progress.text;
      }

      if (input.onProgress) {
        progressTasks.push(Promise.resolve(input.onProgress(progress)));
      }
    }
  }

  return new Promise<RunClaudePromptResult>((resolve) => {
    const child = spawn(claudeCommand, args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let interrupted = false;
    let stdinEnded = false;
    let stdinFailure = "";
    let timeout: NodeJS.Timeout | null = null;
    let forceKillTimeout: NodeJS.Timeout | null = null;

    const onAbort = () => {
      if (settled || interrupted) {
        return;
      }
      interrupted = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000);
      forceKillTimeout.unref();
    };

    function writeInput(content: string): Promise<void> {
      const normalizedContent = content.trim();
      if (!normalizedContent) {
        return Promise.reject(new Error("Claude Code steering content is empty."));
      }
      if (settled || interrupted || stdinEnded || child.stdin.destroyed || !child.stdin.writable) {
        return Promise.reject(new Error("Claude Code input stream is no longer writable."));
      }

      return new Promise<void>((writeResolve, writeReject) => {
        child.stdin.write(claudeUserMessage(normalizedContent), (error) => {
          if (error) {
            writeReject(error);
            return;
          }
          writeResolve();
        });
      });
    }

    function endInputAfterTurn(): void {
      if ((!turnEnded && !resultSeen) || stdinEnded || child.stdin.destroyed) {
        return;
      }
      stdinEnded = true;
      child.stdin.end();
    }

    const controlKey = input.controlKey?.trim() || null;
    const activeTurn: ActiveClaudeTurn = {
      async send(content) {
        try {
          await writeInput(content);
          return {
            status: "accepted",
            message: "Claude Code steering was accepted.",
            ...(sessionId ? { threadId: sessionId } : {}),
          };
        } catch (error) {
          return {
            status: "failed",
            message: error instanceof Error ? error.message : "Claude Code steering failed.",
          };
        }
      },
      interrupt() {
        onAbort();
        return {
          status: "accepted",
          message: "Claude Code interrupt requested.",
          ...(sessionId ? { threadId: sessionId } : {}),
        };
      },
    };
    if (controlKey) {
      activeClaudeTurns.set(controlKey, activeTurn);
    }

    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) {
      onAbort();
    }

    function settle(result: RunClaudePromptResult): void {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      input.signal?.removeEventListener("abort", onAbort);
      if (controlKey && activeClaudeTurns.get(controlKey) === activeTurn) {
        activeClaudeTurns.delete(controlKey);
      }

      void Promise.allSettled(progressTasks).then(() => resolve(result));
    }

    child.once("error", (error) => {
      settle(interrupted
        ? interruptedResult()
        : spawnFailure(claudeCommand, error as NodeJS.ErrnoException));
    });

    child.stdin.on("error", (error) => {
      if (!settled && !resultSeen && !interrupted) {
        stdinFailure = error.message;
      }
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      lineBuffer += chunk.toString("utf8");
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim()) {
          handleLine(line);
          endInputAfterTurn();
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    void writeInput(input.prompt).catch((error) => {
      stdinFailure = error instanceof Error ? error.message : "Claude Code input failed.";
      child.kill("SIGTERM");
    });

    if (input.timeoutMs > 0) {
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
        settle({
          status: "failed",
          finalMessage: "",
          sessionId,
          stderr: "Claude Code prompt timed out.",
          exitCode: null,
          errorCode: "CLAUDE_PROMPT_TIMEOUT",
        });
      }, input.timeoutMs);
    }

    child.once("close", (code) => {
      if (lineBuffer.trim()) {
        handleLine(lineBuffer.trim());
      }

      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      const rawStdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      if (interrupted) {
        settle(interruptedResult());
        return;
      }
      const completed = code === 0 && !resultWasError;
      const outputFinalMessage = finalMessage || lastAssistantMessage;

      settle({
        status: completed ? "completed" : "failed",
        finalMessage: outputFinalMessage,
        sessionId,
        stderr: stderr || stdinFailure || (completed ? "" : rawStdout),
        exitCode: code,
        ...(completed ? {} : { errorCode: "CLAUDE_CLI_FAILED" }),
      });
    });
  });
}
