import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readlink, rm, stat, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import type {
  CodexApprovalChoice,
  CodexApprovalDecision,
  CodexApprovalRequest,
  CodexRunnerProgressEvent,
  RunCodexPromptInput,
  RunCodexPromptResult,
} from "./codexRunner.js";

interface RunCodexAppServerPromptInput extends RunCodexPromptInput {
  appServerSocketPath?: string;
}

interface JsonRpcResponse {
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

interface JsonRpcNotification {
  method?: unknown;
  params?: unknown;
  id?: unknown;
}

interface ThreadStartResponse {
  thread?: {
    id?: unknown;
  };
}

interface TurnCompletedParams {
  turn?: {
    status?: unknown;
    error?: {
      message?: unknown;
      additionalDetails?: unknown;
    } | null;
  };
}

interface ItemNotificationParams {
  item?: {
    id?: unknown;
    type?: unknown;
    text?: unknown;
    phase?: unknown;
  };
  delta?: unknown;
  itemId?: unknown;
}

const APP_SERVER_ERROR_CODE = "CODEX_APP_SERVER_FAILED";
const APP_SERVER_UNSUPPORTED_REVIEW_CODE = "CODEX_APP_SERVER_REVIEW_UNSUPPORTED";
const APP_SERVER_CLIENT_NAME = "codex-discord-connector";
const APP_SERVER_APPROVAL_POLICY = "never";
const APP_SERVER_APPROVALS_REVIEWER = "user";
type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

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

function appServerSocketUrl(socketPath: string): string {
  return `ws+unix://${socketPath}:/`;
}

function appServerListenUrl(socketPath: string): string {
  return `unix://${socketPath}`;
}

function compactDetail(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function itemProgressEvent(params: ItemNotificationParams): CodexRunnerProgressEvent | null {
  const item = params.item;
  const type = typeof item?.type === "string" ? item.type : "";

  if (type === "commandExecution") {
    return {
      type: "operation-progress",
      label: "명령 실행 중",
      detail: typeof item?.text === "string" ? compactDetail(item.text) : undefined,
      eventType: "item/started",
    };
  }

  if (type === "fileChange") {
    return {
      type: "operation-progress",
      label: "파일 수정 중",
      detail: typeof item?.text === "string" ? compactDetail(item.text) : undefined,
      eventType: "item/started",
    };
  }

  return null;
}

function spawnFailure(codexCommand: string, error: NodeJS.ErrnoException): RunCodexPromptResult {
  if (error.code === "ENOENT") {
    return {
      status: "failed",
      finalMessage: "",
      sessionId: null,
      stderr: "Codex CLI command was not found. Install Codex CLI or configure codexCommand.",
      exitCode: null,
      errorCode: "CODEX_CLI_NOT_FOUND",
    };
  }

  return {
    status: "failed",
    finalMessage: "",
    sessionId: null,
    stderr: error.message,
    exitCode: null,
    errorCode: error.code ? `CODEX_APP_SERVER_SPAWN_${error.code}` : "CODEX_APP_SERVER_SPAWN_FAILED",
  };
}

async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  for (;;) {
    try {
      const stats = await stat(socketPath);

      if (stats.isSocket()) {
        return;
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for Codex app-server socket: ${socketPath}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function startAppServer(input: RunCodexAppServerPromptInput, socketPath: string): Promise<{
  child: ChildProcess | null;
  spawnFailure?: RunCodexPromptResult;
  stderrChunks: Buffer[];
}> {
  if (input.appServerSocketPath) {
    return { child: null, stderrChunks: [] };
  }

  const codexCommand = input.codexCommand ?? "codex";
  const stderrChunks: Buffer[] = [];
  const child = spawn(codexCommand, ["app-server", "--listen", appServerListenUrl(socketPath)], {
    env: {
      ...process.env,
      ...(input.codexHome ? { CODEX_HOME: input.codexHome } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const spawnError = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
    child.once("error", (error) => resolve(error as NodeJS.ErrnoException));
    child.once("spawn", () => resolve(null));
  });

  if (spawnError) {
    return {
      child: null,
      stderrChunks,
      spawnFailure: spawnFailure(codexCommand, spawnError),
    };
  }

  return { child, stderrChunks };
}

function appServerFailure(input: {
  message: string;
  sessionId: string | null;
  stderr: string;
  timedOut?: boolean;
}): RunCodexPromptResult {
  return {
    status: "failed",
    finalMessage: input.message,
    sessionId: input.sessionId,
    stderr: input.stderr,
    exitCode: null,
    errorCode: APP_SERVER_ERROR_CODE,
    timedOut: input.timedOut,
  };
}

function jsonRpcErrorMessage(error: { code?: unknown; message?: unknown }): string {
  const code = typeof error.code === "number" || typeof error.code === "string" ? `${error.code}: ` : "";
  const message = typeof error.message === "string" ? error.message : "Unknown JSON-RPC error";
  return `${code}${message}`;
}

function reasoningEffort(input: RunCodexAppServerPromptInput): string | null {
  return input.reasoningEffort?.trim() || null;
}

function model(input: RunCodexAppServerPromptInput): string | null {
  return input.model?.trim() || null;
}

function sandboxMode(): CodexSandboxMode {
  const configured = process.env.CODEX_DISCORD_CODEX_SANDBOX?.trim();

  return configured === "read-only" || configured === "workspace-write" || configured === "danger-full-access"
    ? configured
    : "danger-full-access";
}

function turnSandboxPolicy(cwd: string) {
  const mode = sandboxMode();

  if (mode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }

  if (mode === "read-only") {
    return {
      type: "readOnly",
      networkAccess: true,
    };
  }

  return {
    type: "workspaceWrite",
    writableRoots: [cwd],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function approvalPolicy(): "untrusted" | "on-request" | "never" {
  const configured = process.env.CODEX_DISCORD_CODEX_APPROVAL_POLICY?.trim();

  return configured === "untrusted" || configured === "never" || configured === "on-request"
    ? configured
    : APP_SERVER_APPROVAL_POLICY;
}

function objectParam(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value.join(" ");
  }

  return null;
}

function jsonDetail(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function optionalDetail(name: string, value: unknown): { name: string; value: string } | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return { name, value: typeof value === "string" ? value : jsonDetail(value) };
}

function approvalRequestFromServerRequest(
  method: string,
  params: Record<string, unknown>,
  sessionId: string | null,
): CodexApprovalRequest | null {
  if (method === "item/commandExecution/requestApproval") {
    return {
      kind: "command",
      title: "명령 실행 권한 요청",
      message: "Codex가 추가 확인이 필요한 명령을 실행하려고 합니다.",
      sessionId,
      cwd: stringParam(params, "cwd"),
      command: stringParam(params, "command"),
      reason: stringParam(params, "reason"),
      details: [
        optionalDetail("Network", params.networkApprovalContext),
        optionalDetail("Proposed exec policy", params.proposedExecpolicyAmendment),
        optionalDetail("Proposed network policy", params.proposedNetworkPolicyAmendments),
      ].filter((detail): detail is { name: string; value: string } => Boolean(detail)),
      rawParams: params,
    };
  }

  if (method === "item/fileChange/requestApproval") {
    return {
      kind: "file-change",
      title: "파일 변경 권한 요청",
      message: "Codex가 현재 권한으로는 바로 쓸 수 없는 위치의 파일 변경을 요청했습니다.",
      sessionId,
      cwd: stringParam(params, "grantRoot"),
      reason: stringParam(params, "reason"),
      details: [optionalDetail("Grant root", params.grantRoot)].filter(
        (detail): detail is { name: string; value: string } => Boolean(detail),
      ),
      rawParams: params,
    };
  }

  if (method === "item/permissions/requestApproval") {
    return {
      kind: "permissions",
      title: "추가 권한 요청",
      message: "Codex가 이 작업을 계속하기 위해 추가 권한을 요청했습니다.",
      sessionId,
      cwd: stringParam(params, "cwd"),
      reason: stringParam(params, "reason"),
      details: [optionalDetail("Requested permissions", params.permissions)].filter(
        (detail): detail is { name: string; value: string } => Boolean(detail),
      ),
      rawParams: params,
    };
  }

  if (method === "execCommandApproval") {
    return {
      kind: "legacy-command",
      title: "명령 실행 권한 요청",
      message: "Codex가 추가 확인이 필요한 명령을 실행하려고 합니다.",
      sessionId,
      cwd: stringParam(params, "cwd"),
      command: stringParam(params, "command"),
      reason: stringParam(params, "reason"),
      details: [optionalDetail("Parsed command", params.parsedCmd)].filter(
        (detail): detail is { name: string; value: string } => Boolean(detail),
      ),
      rawParams: params,
    };
  }

  if (method === "applyPatchApproval") {
    return {
      kind: "legacy-patch",
      title: "패치 적용 권한 요청",
      message: "Codex가 파일 패치를 적용하기 전에 확인을 요청했습니다.",
      sessionId,
      cwd: null,
      details: [optionalDetail("File changes", params.fileChanges)].filter(
        (detail): detail is { name: string; value: string } => Boolean(detail),
      ),
      rawParams: params,
    };
  }

  return null;
}

function legacyApprovalDecision(choice: CodexApprovalChoice) {
  switch (choice) {
    case "accept":
      return "approved";
    case "acceptForSession":
      return "approved_for_session";
    case "cancel":
      return "abort";
    case "decline":
    default:
      return "denied";
  }
}

function permissionGrantResponse(params: Record<string, unknown>, decision: CodexApprovalDecision) {
  const requested = objectParam(params.permissions);
  const accepted = decision.decision === "accept" || decision.decision === "acceptForSession";

  if (!accepted) {
    return {
      permissions: {},
      scope: "turn",
    };
  }

  return {
    permissions: {
      ...(requested.network === null || requested.network === undefined ? {} : { network: requested.network }),
      ...(requested.fileSystem === null || requested.fileSystem === undefined ? {} : { fileSystem: requested.fileSystem }),
    },
    scope: decision.decision === "acceptForSession" ? "session" : "turn",
  };
}

function approvalResponseForServerRequest(
  method: string,
  params: Record<string, unknown>,
  decision: CodexApprovalDecision,
) {
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return { decision: legacyApprovalDecision(decision.decision) };
  }

  if (method === "item/permissions/requestApproval") {
    return permissionGrantResponse(params, decision);
  }

  return { decision: decision.decision };
}

export async function runCodexAppServerPrompt(
  input: RunCodexAppServerPromptInput,
): Promise<RunCodexPromptResult> {
  if (input.mode === "review") {
    return {
      status: "failed",
      finalMessage: "Codex app-server runner does not support review mode yet.",
      sessionId: null,
      stderr: "",
      exitCode: null,
      errorCode: APP_SERVER_UNSUPPORTED_REVIEW_CODE,
    };
  }

  const tempRoot = input.appServerSocketPath
    ? null
    : await mkdtemp(path.join(os.homedir(), ".codex-discord-appserver-"));
  const socketPath = input.appServerSocketPath ?? path.join(tempRoot ?? os.tmpdir(), "app.sock");
  const workspaceRoot = await ensureAsciiWorkspaceRoot(input.workspaceRoot);
  const originalWorkspaceRoot = path.resolve(input.workspaceRoot);
  const requestedCwd = path.resolve(input.cwd);
  const cwd =
    workspaceRoot === originalWorkspaceRoot
      ? requestedCwd
      : path.join(workspaceRoot, path.relative(originalWorkspaceRoot, requestedCwd));
  const server = await startAppServer(input, socketPath);

  if (server.spawnFailure) {
    return server.spawnFailure;
  }

  try {
    if (!input.appServerSocketPath) {
      await waitForSocket(socketPath, input.timeoutMs > 0 ? Math.min(input.timeoutMs, 10_000) : 10_000);
    }

    return await runPromptAgainstAppServer({
      input,
      socketPath,
      cwd,
      stderrChunks: server.stderrChunks,
    });
  } catch (error) {
    return appServerFailure({
      message: error instanceof Error ? error.message : "Codex app-server prompt failed",
      sessionId: input.sessionId ?? null,
      stderr: Buffer.concat(server.stderrChunks).toString("utf8"),
    });
  } finally {
    server.child?.kill("SIGTERM");

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function runPromptAgainstAppServer(input: {
  input: RunCodexAppServerPromptInput;
  socketPath: string;
  cwd: string;
  stderrChunks: Buffer[];
}): Promise<RunCodexPromptResult> {
  const socket = new WebSocket(appServerSocketUrl(input.socketPath), { perMessageDeflate: false });
  let nextRequestId = 1;
  let sessionId = input.input.sessionId ?? null;
  let completed = false;
  let finalMessage = "";
  const announcedSessionIds = new Set<string>();
  const agentMessageTextById = new Map<string, string>();
  const agentMessageOrder: string[] = [];
  const pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  function stderr(): string {
    return Buffer.concat(input.stderrChunks).toString("utf8");
  }

  function request(method: string, params: unknown): Promise<unknown> {
    const id = nextRequestId++;
    socket.send(JSON.stringify({ method, id, params }));

    return new Promise((resolve, reject) => {
      const requestTimeoutMs = input.input.timeoutMs > 0 ? Math.min(input.input.timeoutMs, 60_000) : 60_000;
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server response: ${method}`));
      }, requestTimeoutMs);

      pendingRequests.set(id, { resolve, reject, timer });
    });
  }

  function notification(method: string, params?: unknown): void {
    socket.send(JSON.stringify({ method, ...(params === undefined ? {} : { params }) }));
  }

  function handleAgentDelta(params: ItemNotificationParams): void {
    const itemId = typeof params.itemId === "string" ? params.itemId : null;
    const delta = typeof params.delta === "string" ? params.delta : "";

    if (!itemId || !delta) {
      return;
    }

    if (!agentMessageTextById.has(itemId)) {
      agentMessageOrder.push(itemId);
      agentMessageTextById.set(itemId, "");
    }

    agentMessageTextById.set(itemId, `${agentMessageTextById.get(itemId) ?? ""}${delta}`);
  }

  async function emitThreadStarted(threadId: string): Promise<void> {
    sessionId = threadId;

    if (announcedSessionIds.has(threadId)) {
      return;
    }

    announcedSessionIds.add(threadId);
    await Promise.resolve(input.input.onProgress?.({ type: "thread-started", sessionId: threadId }));
  }

  async function handleItemCompleted(params: ItemNotificationParams): Promise<void> {
    const item = params.item;

    if (item?.type !== "agentMessage" || typeof item.id !== "string") {
      return;
    }

    const text = typeof item.text === "string" ? item.text : agentMessageTextById.get(item.id) ?? "";

    if (!agentMessageTextById.has(item.id)) {
      agentMessageOrder.push(item.id);
    }

    agentMessageTextById.set(item.id, text);

    if (text.trim().length > 0) {
      await Promise.resolve(input.input.onProgress?.({ type: "agent-message", text }));
    }
  }

  function handleTurnCompleted(params: TurnCompletedParams): void {
    completed = params.turn?.status === "completed";
    finalMessage = agentMessageTextById.get(agentMessageOrder.at(-1) ?? "") ?? "";

    if (!completed && params.turn?.error) {
      const detail = typeof params.turn.error.additionalDetails === "string"
        ? `\n${params.turn.error.additionalDetails}`
        : "";
      finalMessage = `${String(params.turn.error.message ?? "Codex app-server turn failed")}${detail}`;
    }

    socket.close();
  }

  function handleNotification(message: JsonRpcNotification): void {
    const method = typeof message.method === "string" ? message.method : "";
    const params = typeof message.params === "object" && message.params !== null
      ? (message.params as Record<string, unknown>)
      : {};

    if (method === "thread/started") {
      const thread = typeof params.thread === "object" && params.thread !== null
        ? (params.thread as { id?: unknown })
        : null;
      const threadId = typeof thread?.id === "string" ? thread.id : null;

      if (threadId) {
        void emitThreadStarted(threadId);
      }
      return;
    }

    if (method === "item/started") {
      const progress = itemProgressEvent(params as ItemNotificationParams);

      if (progress) {
        void Promise.resolve(input.input.onProgress?.(progress));
      }
      return;
    }

    if (method === "item/agentMessage/delta") {
      handleAgentDelta(params as ItemNotificationParams);
      return;
    }

    if (method === "item/completed") {
      void handleItemCompleted(params as ItemNotificationParams);
      return;
    }

    if (method === "turn/completed") {
      handleTurnCompleted(params as TurnCompletedParams);
    }
  }

  async function respondServerRequest(message: JsonRpcNotification): Promise<void> {
    if (typeof message.id !== "number" && typeof message.id !== "string") {
      return;
    }

    const method = typeof message.method === "string" ? message.method : "";
    const params = objectParam(message.params);
    const approvalRequest = approvalRequestFromServerRequest(method, params, sessionId);

    if (approvalRequest) {
      const decision =
        (await Promise.resolve(input.input.onApprovalRequest?.(approvalRequest))) ?? { decision: "decline" };

      socket.send(
        JSON.stringify({
          id: message.id,
          result: approvalResponseForServerRequest(method, params, decision),
        }),
      );
      return;
    }

    socket.send(
      JSON.stringify({
        id: message.id,
        error: {
          code: -32601,
          message: "Codex Discord app-server runner does not support this server request yet.",
        },
      }),
    );
  }

  const result = await new Promise<RunCodexPromptResult>((resolve) => {
    const timeout =
      input.input.timeoutMs > 0
        ? setTimeout(() => {
            resolve(
              appServerFailure({
                message: "Codex app-server prompt timed out.",
                sessionId,
                stderr: stderr(),
                timedOut: true,
              }),
            );
            socket.close();
          }, input.input.timeoutMs)
        : null;

    socket.on("open", () => {
      void (async () => {
        try {
          await request("initialize", {
            clientInfo: {
              name: APP_SERVER_CLIENT_NAME,
              title: "Codex Discord Connector",
              version: "0.1.0",
            },
            capabilities: { experimentalApi: true, requestAttestation: false },
          });
          notification("initialized");

          const currentApprovalPolicy = approvalPolicy();
          const currentSandboxMode = sandboxMode();
          const threadResult = input.input.sessionId
            ? await request("thread/resume", {
                threadId: input.input.sessionId,
                cwd: input.cwd,
                runtimeWorkspaceRoots: [input.cwd],
                approvalPolicy: currentApprovalPolicy,
                approvalsReviewer: APP_SERVER_APPROVALS_REVIEWER,
                sandbox: currentSandboxMode,
                model: model(input.input),
              })
            : await request("thread/start", {
                cwd: input.cwd,
                runtimeWorkspaceRoots: [input.cwd],
                approvalPolicy: currentApprovalPolicy,
                approvalsReviewer: APP_SERVER_APPROVALS_REVIEWER,
                sandbox: currentSandboxMode,
                threadSource: "codex-discord",
                model: model(input.input),
              });
          const thread = (threadResult as ThreadStartResponse).thread;

          if (typeof thread?.id === "string") {
            await emitThreadStarted(thread.id);
          }

          await request("turn/start", {
            threadId: sessionId,
            input: [{ type: "text", text: input.input.prompt, text_elements: [] }],
            cwd: input.cwd,
            runtimeWorkspaceRoots: [input.cwd],
            approvalPolicy: currentApprovalPolicy,
            approvalsReviewer: APP_SERVER_APPROVALS_REVIEWER,
            sandboxPolicy: turnSandboxPolicy(input.cwd),
            model: model(input.input),
            effort: reasoningEffort(input.input),
          });
        } catch (error) {
          if (timeout) {
            clearTimeout(timeout);
          }
          socket.close();
          resolve(
            appServerFailure({
              message: error instanceof Error ? error.message : "Codex app-server prompt failed",
              sessionId,
              stderr: stderr(),
            }),
          );
        }
      })();
    });

    socket.on("message", (raw) => {
      let message: JsonRpcResponse & JsonRpcNotification;

      try {
        message = JSON.parse(raw.toString()) as JsonRpcResponse & JsonRpcNotification;
      } catch {
        return;
      }

      if (typeof message.id === "number" && pendingRequests.has(message.id)) {
        const pending = pendingRequests.get(message.id);

        if (!pending) {
          return;
        }

        pendingRequests.delete(message.id);
        clearTimeout(pending.timer);

        if (message.error) {
          pending.reject(new Error(jsonRpcErrorMessage(message.error)));
        } else {
          pending.resolve(message.result);
        }
        return;
      }

      if (typeof message.id !== "undefined") {
        void respondServerRequest(message).catch((error) => {
          console.error("failed to handle Codex app-server request", error);
        });
        return;
      }

      handleNotification(message);
    });

    socket.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(
        appServerFailure({
          message: error.message,
          sessionId,
          stderr: stderr(),
        }),
      );
    });

    socket.on("close", () => {
      if (timeout) {
        clearTimeout(timeout);
      }

      for (const pending of pendingRequests.values()) {
        clearTimeout(pending.timer);
      }
      pendingRequests.clear();

      resolve({
        status: completed && finalMessage.trim().length > 0 ? "completed" : "failed",
        finalMessage: finalMessage.trimEnd(),
        sessionId,
        stderr: stderr(),
        exitCode: completed ? 0 : null,
      });
    });
  });

  return result;
}
