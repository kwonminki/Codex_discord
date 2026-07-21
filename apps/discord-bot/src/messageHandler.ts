import { classifyCommand } from "../../../packages/core/src/index.js";
import type { ManagedDiscordChannelContext } from "./channelContext.js";
import type {
  DeletePreviewResult,
  DeleteSyncedDiscordSessionsResult,
  SyncedDeleteMode,
} from "./codexSessionDelete.js";
import type { ArchiveSyncedCodexSessionResult } from "./codexSessionArchive.js";
import type { NewCodexChatResult } from "./codexNewChat.js";
import type {
  DiscordGuildSurface,
  SyncCodexSessionsProgress,
  SyncCodexSessionsResult,
} from "./codexSessionSync.js";
import type { SyncCodexSessionTranscriptUpdatesResult } from "./codexTranscriptSync.js";
import type { CodexPromptApprovalDecision, CodexPromptApprovalRequest, ControlApiClient } from "./controlApiClient.js";
import type { TranscriptSyncMode } from "./directState.js";
import type { ScheduleCommandRequest, ScheduleCommandResult } from "./scheduler.js";
import { routeDiscordMessage } from "./commandRouter.js";
import type { DiscordMessagePayload } from "./responses.js";
import { CODEX_PROGRESS_EVENT_LIMIT, withRoleMentions } from "./responses.js";
import {
  formatCodexAck,
  formatCodexApprovalDecision,
  formatCodexApprovalRequest,
  formatCodexModelResult,
  formatCodexProgressUpdate,
  formatCodexResultUpdate,
  formatBlockedCommand,
  formatCommandAck,
  formatCommandResultUpdate,
  formatArchiveAck,
  formatArchiveResult,
  formatChannelStatus,
  formatClearConfirmation,
  formatClearResult,
  formatDeleteAck,
  formatDeletePreview,
  formatDeleteResult,
  formatDenied,
  formatHelp,
  formatForkedSessionThreadNotice,
  formatForkSessionAck,
  formatForkSessionResult,
  formatAgentResultPosted,
  formatLiveAgentProgress,
  formatMaintenancePanel,
  formatNewChatAck,
  formatNewChatResult,
  formatReloadAck,
  formatReloadConfirmation,
  formatReloadResult,
  formatRestartDrainPending,
  formatSyncSelection,
  formatSyncSelectionAck,
  formatSyncAck,
  formatSyncModeResult,
  formatSyncStatus,
  formatSyncProgressUpdate,
  formatSyncResultUpdate,
  formatScheduleResult,
  formatCodexRunModeResult,
  formatCodexTurnControlResult,
  formatQueueClearResult,
  formatQueueStatus,
  getCodexResultContinuationMessages,
} from "./responses.js";
import type { CodexPermissionSettings, SelectableCodexSession } from "./responses.js";

export const DEFAULT_CODEX_PROMPT_TIMEOUT_MS = 5 * 60 * 60 * 1_000;

export interface BotReloadExecutionState {
  activeCount: number;
  pendingCount: number;
}

export interface BotReloadResult extends BotReloadExecutionState {
  mode: "commands" | "restart";
  commandCount: number;
  restarting: boolean;
  deferred?: boolean;
  forced?: boolean;
  startedAt: string;
}

export function resolveCodexPromptTimeoutMs(
  channelTimeoutMs: number,
  configuredValue = process.env.CONNECT_CODEX_PROMPT_TIMEOUT_MS,
): number {
  const trimmedValue = configuredValue?.trim();

  if (trimmedValue === "0") {
    return 0;
  }

  const configuredTimeoutMs = Number.parseInt(trimmedValue ?? "", 10);
  const codexTimeoutMs =
    Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
      ? configuredTimeoutMs
      : DEFAULT_CODEX_PROMPT_TIMEOUT_MS;

  return Math.max(channelTimeoutMs, codexTimeoutMs);
}

export type { ManagedDiscordChannelContext } from "./channelContext.js";

export interface DiscordMessageLike {
  authorBot: boolean;
  userId: string;
  channelId: string;
  content: string;
  roleIds: string[];
  requestId?: string;
  durableQueuedAt?: string;
  restoreOnly?: boolean;
  guild?: DiscordGuildSurface | null;
  clearMessages?(input: { mode: "all" | "count"; count?: number }): Promise<{ deletedCount: number; requestedCount?: number | null }>;
  reply(message: DiscordOutgoingMessage): Promise<DiscordReplyLike | void>;
}

export interface DiscordReplyLike {
  edit(message: DiscordOutgoingMessage): Promise<unknown>;
}

export type DiscordOutgoingMessage = string | DiscordMessagePayload;

export interface CreateDiscordMessageHandlerInput {
  resolveChannelContext(channelId: string): Promise<ManagedDiscordChannelContext | null>;
  submitCommandJob: ControlApiClient["submitCommandJob"];
  submitCodexPrompt?: ControlApiClient["submitCodexPrompt"];
  controlCodexTurn?: ControlApiClient["controlCodexTurn"];
  submitClaudePrompt?: ControlApiClient["submitClaudePrompt"];
  syncCodexSessions?: (input: {
    guild: DiscordGuildSurface;
    limit: number;
    sessionIds?: string[];
    onProgress?: (progress: SyncCodexSessionsProgress) => Promise<void> | void;
  }) => Promise<SyncCodexSessionsResult>;
  createNewCodexChat?: (input: {
    guild: DiscordGuildSurface;
    name: string | null;
    cwd: string | null;
    currentCwd: string;
    useCategory: boolean;
    initialPrompt: string | null;
    channelMode: "session-linked" | "claude-code";
    sessionThreadParentChannelId: string | null;
  }) => Promise<NewCodexChatResult>;
  createForkedSessionThread?: (input: {
    guild: DiscordGuildSurface;
    sourceDiscordChannelId: string;
    sourceSessionId: string;
    name: string;
  }) => Promise<NewCodexChatResult>;
  discardForkedSessionThread?: (input: {
    guild: DiscordGuildSurface;
    discordChannelId: string;
  }) => Promise<boolean>;
  linkNewCodexSession?: (input: {
    discordChannelId: string;
    codexSessionId: string;
    threadName: string;
  }) => Promise<void>;
  recordClaudeSession?: (input: {
    discordChannelId: string;
    claudeSessionId: string;
  }) => Promise<void> | void;
  previewSelectableCodexSessions?: (input: { limit: number }) => Promise<{
    sessions: SelectableCodexSession[];
    totalAvailable: number;
    limit: number;
  }>;
  getSyncStatus?: () => Promise<{
    workspaceCount: number;
    sessionChannelCount: number;
    archivedSessionCount: number;
    contextPostedCount: number;
    transcriptSyncMode: TranscriptSyncMode;
    transcriptSyncedChannelCount: number;
  }>;
  setTranscriptSyncMode?: (mode: TranscriptSyncMode) => Promise<{ mode: TranscriptSyncMode }>;
  syncTranscriptUpdates?: (input: {
    guild: DiscordGuildSurface;
    discordChannelId?: string;
    trigger: "on-chat" | "realtime";
    postUpdates?: boolean;
  }) => Promise<SyncCodexSessionTranscriptUpdatesResult>;
  setSessionStreaming?: (sessionId: string, active: boolean) => void;
  markDiscordRequestedCodexSession?: (
    sessionId: string,
    options?: { discordChannelId?: string | null; completionMentionSent?: boolean },
  ) => Promise<void> | void;
  reloadBot?: (input: {
    mode: "commands" | "restart";
    execution: BotReloadExecutionState;
    force: boolean;
  }) => Promise<BotReloadResult>;
  previewSyncedChannelsDelete?: (input: {
    mode: SyncedDeleteMode;
    sessionId?: string | null;
  }) => Promise<DeletePreviewResult>;
  deleteSyncedChannels?: (input: {
    guild: DiscordGuildSurface;
    mode: SyncedDeleteMode;
    sessionId?: string | null;
  }) => Promise<DeleteSyncedDiscordSessionsResult>;
  archiveSyncedSession?: (input: {
    guild: DiscordGuildSurface | null | undefined;
    discordChannelId: string;
    codexSessionId?: string | null;
  }) => Promise<ArchiveSyncedCodexSessionResult>;
  scheduleCommand?: (input: {
    request: ScheduleCommandRequest;
    channelId: string;
    userId: string;
    roleIds: string[];
  }) => Promise<ScheduleCommandResult>;
  updateChannelCwd: ControlApiClient["updateChannelCwd"];
  recordCommandAudit: ControlApiClient["recordCommandAudit"];
  persistDurableRequest?: (input: {
    requestId?: string;
    channelId: string;
    userId: string;
    content: string;
    roleIds: string[];
    createdAt?: string;
  }) => Promise<{ requestId: string; createdAt: string }>;
  completeDurableRequest?: (requestId: string) => Promise<void>;
}

export interface DiscordMessageHandler {
  (message: DiscordMessageLike): Promise<void>;
  drainRestoredMessages(): void;
}

function extractUpdatedCwd(response: Awaited<ReturnType<ControlApiClient["submitCommandJob"]>>): string | null {
  if (!("result" in response) || typeof response.result !== "object" || response.result === null) {
    return null;
  }

  const cwd = (response.result as { cwd?: unknown }).cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : null;
}

function extractResultStatus(response: Awaited<ReturnType<ControlApiClient["submitCommandJob"]>>): string {
  if (!("result" in response) || typeof response.result !== "object" || response.result === null) {
    return "failed";
  }

  const status = (response.result as { status?: unknown }).status;
  return typeof status === "string" && status.length > 0 ? status : "unknown";
}

function promptResponseFailed(response: { result?: unknown; error?: unknown }): boolean {
  if ("error" in response && response.error) {
    return true;
  }

  if (!("result" in response) || typeof response.result !== "object" || response.result === null) {
    return true;
  }

  return (response.result as { status?: unknown }).status === "failed";
}

async function recordCommandAudit(
  input: CreateDiscordMessageHandlerInput,
  details: {
    discordChannelId: string;
    userId: string;
    cwd: string;
    rawCommand: string;
    resultStatus: string;
  },
) {
  try {
    await input.recordCommandAudit({
      ...details,
      tier: classifyCommand(details.rawCommand).tier,
    });
  } catch (error) {
    console.error("discord-bot failed to record command audit", error);
  }
}

async function updateQueuedReply(
  queuedReply: DiscordReplyLike | void,
  fallbackReply: (message: DiscordOutgoingMessage) => Promise<DiscordReplyLike | void>,
  message: DiscordOutgoingMessage,
): Promise<void> {
  if (queuedReply && typeof queuedReply.edit === "function") {
    await queuedReply.edit(message);
    return;
  }

  await fallbackReply(message);
}

async function updateQueuedResultReply(input: {
  message: DiscordMessageLike;
  queuedReply: DiscordReplyLike | void;
  fallbackReply: (message: DiscordOutgoingMessage) => Promise<DiscordReplyLike | void>;
  payload: DiscordMessagePayload;
  postAsNewMessage?: boolean;
  terminalPayload?: DiscordMessagePayload;
}): Promise<void> {
  if (input.postAsNewMessage && input.message.guild?.sendTextMessage) {
    if (input.terminalPayload) {
      try {
        await updateQueuedReply(input.queuedReply, input.fallbackReply, input.terminalPayload);
      } catch (error) {
        console.warn("discord-bot failed to close the progress message before posting the final answer", error);
      }
    }

    let postedFinalAnswer = false;

    try {
      await input.message.guild.sendTextMessage(input.message.channelId, input.payload);
      postedFinalAnswer = true;
    } catch (error) {
      console.warn("discord-bot failed to post the final answer as a new message; falling back to the progress message", error);
    }

    if (postedFinalAnswer) {
      await sendResultContinuations(input);
      return;
    }
  }

  await updateQueuedReply(input.queuedReply, input.fallbackReply, input.payload);
  await sendResultContinuations(input);
}

async function sendResultContinuations(input: {
  message: DiscordMessageLike;
  fallbackReply: (message: DiscordOutgoingMessage) => Promise<DiscordReplyLike | void>;
  payload: DiscordMessagePayload;
}): Promise<void> {
  for (const continuation of getCodexResultContinuationMessages(input.payload)) {
    if (input.message.guild?.sendTextMessage) {
      try {
        await input.message.guild.sendTextMessage(input.message.channelId, continuation);
        continue;
      } catch (error) {
        console.warn("discord-bot failed to send a final-answer continuation directly", error);
      }
    }

    try {
      await input.fallbackReply(continuation);
    } catch (error) {
      console.warn("discord-bot failed to send a final-answer continuation", error);
    }
  }
}

function createReplyWithOptionalRoleMentions(
  reply: DiscordMessageLike["reply"],
  roleIds: string[],
): DiscordMessageLike["reply"] {
  const mentionRoleIds = roleIds.filter((roleId) => roleId.trim().length > 0);

  if (mentionRoleIds.length === 0) {
    return reply;
  }

  return async (replyMessage) => {
    const queuedReply = await reply(withRoleMentions(replyMessage, mentionRoleIds));

    if (!queuedReply) {
      return queuedReply;
    }

    return {
      edit: (nextMessage) => queuedReply.edit(withRoleMentions(nextMessage, mentionRoleIds)),
    };
  };
}

async function sendThreadCompletionMention(input: {
  message: DiscordMessageLike;
  channelContext: ManagedDiscordChannelContext;
  agentLabel: "Codex" | "Claude Code";
  failed: boolean;
  deferForPendingRequest?: boolean;
}): Promise<"sent" | "deferred" | "unavailable"> {
  if (input.deferForPendingRequest) {
    return "deferred";
  }

  const mentionRoleIds = input.channelContext.allowedRoleIds.filter(
    (roleId) => roleId.trim().length > 0,
  );

  if (
    input.channelContext.discordDeliveryMode !== "thread" ||
    mentionRoleIds.length === 0 ||
    !input.message.guild?.sendTextMessage
  ) {
    return "unavailable";
  }

  try {
    await input.message.guild.sendTextMessage(
      input.message.channelId,
      `**${input.agentLabel} 작업 ${input.failed ? "실패" : "완료"}**`,
      { mentionRoleIds },
    );
    return "sent";
  } catch (error) {
    console.error("discord-bot failed to send thread completion mention", error);
    return "unavailable";
  }
}

function appendProgressEvent(events: string[], event: string): string[] {
  const normalizedEvent = event.trim();

  if (!normalizedEvent || events.at(-1) === normalizedEvent) {
    return events;
  }

  return [...events, normalizedEvent].slice(-CODEX_PROGRESS_EVENT_LIMIT);
}

function extractCodexResponseSessionId(response: { result?: unknown; error?: unknown }): string | null {
  return "result" in response &&
    typeof response.result === "object" &&
    response.result !== null &&
    typeof (response.result as { sessionId?: unknown }).sessionId === "string"
    ? (response.result as { sessionId: string }).sessionId
    : null;
}

function extractCodexResponseFinalMessage(response: { result?: unknown; error?: unknown }): string | null {
  return "result" in response &&
    typeof response.result === "object" &&
    response.result !== null &&
    typeof (response.result as { finalMessage?: unknown }).finalMessage === "string"
    ? (response.result as { finalMessage: string }).finalMessage
    : null;
}

function forkResponseErrorMessage(
  response: { result?: unknown; error?: unknown },
  agentLabel: "Codex" | "Claude Code",
): string | null {
  if (!promptResponseFailed(response)) {
    return null;
  }

  if (typeof response.error === "object" && response.error !== null) {
    const message = (response.error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  if (typeof response.result === "object" && response.result !== null) {
    const result = response.result as { finalMessage?: unknown; stderr?: unknown };
    const message = [result.finalMessage, result.stderr].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (message) {
      return message.trim();
    }
  }

  return `${agentLabel} fork 실행이 실패했습니다.`;
}

function withAgentMessageFallback<T extends { result?: unknown; error?: unknown }>(
  response: T,
  latestAgentMessage: string | null,
): T {
  const fallback = latestAgentMessage?.trim();

  if (!fallback || response.error || typeof response.result !== "object" || response.result === null) {
    return response;
  }

  const finalMessage = (response.result as { finalMessage?: unknown }).finalMessage;

  if (typeof finalMessage === "string" && finalMessage.trim().length > 0) {
    return response;
  }

  return {
    ...response,
    result: {
      ...response.result,
      finalMessage: fallback,
    },
  };
}

function claudeForkPrompt(name: string): string {
  return [
    `이 세션은 Discord /fork 명령으로 "${name}" 이름의 새 스레드에 분기되었습니다.`,
    "기존 대화 맥락은 유지하되 아직 새 작업은 시작하지 마세요.",
    "새 fork 세션이 준비되었다고 한 문장으로만 답하세요.",
  ].join("\n");
}

function codexForkPrompt(name: string): string {
  return [
    `이 세션은 Discord /fork 명령으로 "${name}" 이름의 새 스레드에 분기되었습니다.`,
    "기존 대화 맥락은 유지하되 아직 새 작업은 시작하지 마세요.",
    "새 fork 세션이 준비되었다고 한 문장으로만 답하세요.",
  ].join("\n");
}

function readableProgressEvent(event: {
  type: string;
  label?: string;
  detail?: string;
  text?: string;
  eventType?: string;
}): string {
  if (event.type === "agent-message" && event.text) {
    return event.text;
  }

  if (event.type !== "operation-progress") {
    return event.eventType ?? event.type;
  }

  if (event.detail?.startsWith("편집함 ")) {
    return event.detail;
  }

  const fileCount = event.detail?.match(/(\d+)개 파일/)?.[1];

  if (event.label === "파일 탐색 중" && fileCount) {
    return `${fileCount}개의 파일 탐색중...`;
  }

  if (event.label === "탐색마침") {
    return "탐색마침";
  }

  if (event.label === "파일 수정 중") {
    return event.detail ? `편집중 · ${event.detail}` : "편집중...";
  }

  if (event.label === "파일 수정 완료") {
    return event.detail ?? "편집함";
  }

  return event.detail ? `${event.label ?? "작업 중"} · ${event.detail}` : (event.label ?? "작업 중");
}

const MAX_LIVE_PROGRESS_MESSAGES_PER_TASK = 40;

function isConcreteProgressBoundary(event: {
  type: string;
  label?: string;
  detail?: string;
  text?: string;
  eventType?: string;
}): boolean {
  if (event.type !== "operation-progress") {
    return false;
  }

  const label = event.label?.trim() ?? "";
  return /^(?:명령 실행|파일 수정|파일 탐색|탐색마침|웹 검색|이미지 생성|도구 |도구 실행|계획 업데이트)/.test(label);
}

function parseCodexApprovalResponse(content: string): {
  token: string;
  decision: CodexPromptApprovalDecision["decision"];
} | null {
  const match = content.trim().match(/^__cdc_codex_approval\s+([A-Za-z0-9_-]{1,48})\s+(accept|acceptForSession|decline|cancel)$/);

  if (!match) {
    return null;
  }

  return {
    token: match[1] ?? "",
    decision: (match[2] ?? "decline") as CodexPromptApprovalDecision["decision"],
  };
}

function hasAllowedRole(userRoleIds: string[], allowedRoleIds: string[]): boolean {
  if (allowedRoleIds.length === 0) {
    return true;
  }

  const userRoles = new Set(userRoleIds);
  return allowedRoleIds.some((roleId) => userRoles.has(roleId));
}

function codexPermissionSettings(): CodexPermissionSettings {
  const approvalPolicy = process.env.CODEX_DISCORD_CODEX_APPROVAL_POLICY?.trim() || "never";
  const configuredSandbox = process.env.CODEX_DISCORD_CODEX_SANDBOX?.trim();
  const sandbox =
    configuredSandbox === "read-only" ||
    configuredSandbox === "workspace-write" ||
    configuredSandbox === "danger-full-access"
      ? configuredSandbox
      : "danger-full-access";

  return {
    approvalPolicy,
    approvalsReviewer: "user",
    sandbox,
    networkAccess: "enabled",
  };
}

export function createDiscordMessageHandler(input: CreateDiscordMessageHandlerInput): DiscordMessageHandler {
  interface QueuedMessage {
    message: DiscordMessageLike;
    resolve(): void;
    reject(error: unknown): void;
  }

  interface ChannelQueue {
    running: boolean;
    activeMessage: DiscordMessageLike | null;
    activeStartedAt: number | null;
    activeLastActivityAt: number | null;
    pending: QueuedMessage[];
  }

  const channelQueues = new Map<string, ChannelQueue>();
  const codexSessionIdsByChannel = new Map<string, string>();
  const claudeSessionIdsByChannel = new Map<string, string>();
  const codexModelsByChannel = new Map<string, string>();
  const codexRunModesByChannel = new Map<string, "fast" | "task">();
  let deferredRestartRequested = false;
  let restartScheduled = false;
  let deferredRestartCheckRunning = false;
  let deferredRestartNotice: {
    channelId: string;
    guild?: DiscordGuildSurface | null;
    reply: DiscordMessageLike["reply"];
  } | null = null;
  const pendingCodexApprovals = new Map<
    string,
    {
      channelId: string;
      resolve: (decision: CodexPromptApprovalDecision) => void;
    }
  >();
  let nextCodexApprovalToken = 1;

  function executionState(excludeActiveMessage?: DiscordMessageLike): BotReloadExecutionState {
    let activeCount = 0;
    let pendingCount = 0;

    for (const queue of channelQueues.values()) {
      if (queue.activeMessage && queue.activeMessage !== excludeActiveMessage) {
        activeCount += 1;
      }

      pendingCount += queue.pending.length;
    }

    return { activeCount, pendingCount };
  }

  async function sendDeferredRestartNotice(payload: DiscordMessagePayload): Promise<void> {
    const notice = deferredRestartNotice;

    if (!notice) {
      return;
    }

    if (notice.guild?.sendTextMessage) {
      await notice.guild.sendTextMessage(notice.channelId, payload);
      return;
    }

    await notice.reply(payload);
  }

  async function restartAfterQueueDrain(): Promise<void> {
    if (
      !deferredRestartRequested ||
      restartScheduled ||
      deferredRestartCheckRunning ||
      !input.reloadBot
    ) {
      return;
    }

    const execution = executionState();

    if (execution.activeCount > 0 || execution.pendingCount > 0) {
      return;
    }

    deferredRestartCheckRunning = true;
    restartScheduled = true;

    try {
      const result = await input.reloadBot({ mode: "restart", execution, force: false });
      await sendDeferredRestartNotice(formatReloadResult({ result }));
    } catch (error) {
      restartScheduled = false;
      deferredRestartRequested = false;
      await sendDeferredRestartNotice(formatReloadResult({
        error: { message: error instanceof Error ? error.message : "Deferred bot restart failed" },
      }));
    } finally {
      deferredRestartCheckRunning = false;
    }
  }

  function touchChannelActivity(channelId: string): void {
    const queue = channelQueues.get(channelId);

    if (queue?.activeMessage) {
      queue.activeLastActivityAt = Date.now();
    }
  }

  async function completeDurableMessage(message: DiscordMessageLike): Promise<void> {
    if (!message.requestId || !input.completeDurableRequest) {
      return;
    }

    try {
      await input.completeDurableRequest(message.requestId);
    } catch (error) {
      console.error(`discord-bot failed to complete durable request ${message.requestId}`, error);
    }
  }

  function channelWaitingForApproval(channelId: string): boolean {
    return [...pendingCodexApprovals.values()].some((approval) => approval.channelId === channelId);
  }

  function channelHasPendingAgentRequests(
    channelId: string,
    channelContext: ManagedDiscordChannelContext,
  ): boolean {
    return channelQueues.get(channelId)?.pending.some((entry) => {
      const routed = routeDiscordMessage({
        channelMode: channelContext.channelMode,
        content: entry.message.content,
        userRoleIds: entry.message.roleIds,
        allowedRoleIds: channelContext.allowedRoleIds,
      });

      return routed.type === "codex-chat" ||
        routed.type === "codex-continue-session" ||
        routed.type === "claude-chat" ||
        routed.type === "codex-review" ||
        routed.type === "fork-session";
    }) ?? false;
  }

  function routeMessage(
    message: DiscordMessageLike,
    channelContext: ManagedDiscordChannelContext,
  ) {
    return routeDiscordMessage({
      channelMode: channelContext.channelMode,
      content: message.content,
      userRoleIds: message.roleIds,
      allowedRoleIds: channelContext.allowedRoleIds,
    });
  }

  async function tryAutoSteerCodexTurn(
    message: DiscordMessageLike,
    channelContext: ManagedDiscordChannelContext,
    queue: ChannelQueue,
  ): Promise<boolean> {
    if (
      channelContext.channelMode !== "session-linked" ||
      !queue.activeMessage ||
      !input.controlCodexTurn
    ) {
      return false;
    }

    const routed = routeMessage(message, channelContext);
    const activeRouted = routeMessage(queue.activeMessage, channelContext);
    const activeCodexTurn = activeRouted.type === "codex-chat" ||
      activeRouted.type === "codex-continue-session" ||
      activeRouted.type === "codex-review";

    if (routed.type !== "codex-chat" || !activeCodexTurn) {
      return false;
    }

    let result: Awaited<ReturnType<NonNullable<CreateDiscordMessageHandlerInput["controlCodexTurn"]>>>;

    try {
      result = await input.controlCodexTurn({
        computerId: channelContext.computerId,
        controlKey: message.channelId,
        action: "steer",
        content: routed.content,
      });
    } catch (error) {
      console.warn("discord-bot failed to auto-steer the active Codex turn; queueing the message", error);
      return false;
    }

    if (result.status !== "accepted") {
      return false;
    }

    touchChannelActivity(message.channelId);

    try {
      await message.reply(formatCodexTurnControlResult({ action: "steer", ...result }));
    } catch (error) {
      console.warn("discord-bot failed to acknowledge an accepted automatic steering message", error);
    }

    return true;
  }

  function reasoningEffortForChannel(channelId: string): "low" | "xhigh" {
    const mode = codexRunModesByChannel.get(channelId);

    if (mode === "fast") {
      return "low";
    }

    return "xhigh";
  }

  async function requestCodexApproval(
    reply: DiscordMessageLike["reply"],
    channelId: string,
    request: CodexPromptApprovalRequest,
  ): Promise<CodexPromptApprovalDecision> {
    touchChannelActivity(channelId);
    const token = String(nextCodexApprovalToken++);

    const decisionPromise = new Promise<CodexPromptApprovalDecision>((resolve) => {
      pendingCodexApprovals.set(token, { channelId, resolve });
    });

    await reply(formatCodexApprovalRequest({ token, request }));

    return decisionPromise;
  }

  function createLiveProgressReporter(input: {
    message: DiscordMessageLike;
    channelContext: ManagedDiscordChannelContext;
    agentLabel: "Codex" | "Claude Code";
  }): {
    publish(event: {
      type: string;
      label?: string;
      detail?: string;
      text?: string;
      eventType?: string;
    }): Promise<void>;
    finish(): void;
  } {
    let lastText: string | null = null;
    let pendingAgentText: string | null = null;
    let sentCount = 0;

    const send = async (text: string) => {
      if (
        input.channelContext.discordDeliveryMode !== "thread" ||
        !input.message.guild?.sendTextMessage ||
        sentCount >= MAX_LIVE_PROGRESS_MESSAGES_PER_TASK ||
        text === lastText
      ) {
        return;
      }

      lastText = text;
      sentCount += 1;

      try {
        await input.message.guild.sendTextMessage(
          input.message.channelId,
          formatLiveAgentProgress({ agentLabel: input.agentLabel, text }),
        );
      } catch (error) {
        console.warn("discord-bot failed to send an unmentioned progress message", error);
      }
    };

    return {
      async publish(event) {
        if (event.type === "agent-message") {
          const text = event.text?.trim() ?? "";

          if (!text || text === pendingAgentText) {
            return;
          }

          if (pendingAgentText) {
            await send(pendingAgentText);
          }

          pendingAgentText = text;
          return;
        }

        if (!isConcreteProgressBoundary(event)) {
          return;
        }

        if (pendingAgentText) {
          await send(pendingAgentText);
          pendingAgentText = null;
        }
      },
      finish() {
        pendingAgentText = null;
      },
    };
  }

  async function processDiscordMessage(message: DiscordMessageLike): Promise<void> {
    const channelContext = await input.resolveChannelContext(message.channelId);

    if (!channelContext) {
      return;
    }

    const reply = (replyMessage: DiscordOutgoingMessage) => message.reply(replyMessage);
    const replyWithRoleMentions = createReplyWithOptionalRoleMentions(
      reply,
      channelContext.channelMode !== "shell-admin" && channelContext.discordDeliveryMode === "thread"
        ? channelContext.allowedRoleIds
        : [],
    );

    const approvalResponse = parseCodexApprovalResponse(message.content);

    if (approvalResponse) {
      if (!hasAllowedRole(message.roleIds, channelContext.allowedRoleIds)) {
        await reply(formatDenied("User does not have an allowed role"));
        return;
      }

      const pending = pendingCodexApprovals.get(approvalResponse.token);

      if (!pending || pending.channelId !== message.channelId) {
        await reply(formatCodexApprovalDecision({
          decision: approvalResponse.decision,
          accepted: false,
          found: false,
        }));
        return;
      }

      pendingCodexApprovals.delete(approvalResponse.token);
      touchChannelActivity(message.channelId);
      pending.resolve({ decision: approvalResponse.decision });
      await reply(formatCodexApprovalDecision({
        decision: approvalResponse.decision,
        accepted: approvalResponse.decision === "accept" || approvalResponse.decision === "acceptForSession",
        found: true,
      }));
      return;
    }

    const routed = routeMessage(message, channelContext);

    if (routed.type === "queue-prompt") {
      await processDiscordMessage({ ...message, content: routed.content });
      return;
    }

    if (routed.type === "queue-status") {
      const queue = channelQueues.get(message.channelId);
      await reply(formatQueueStatus({
        active: queue?.activeMessage ? queueMessageSummary(queue.activeMessage.content) : null,
        pending: queue?.pending.map((entry) => queueMessageSummary(entry.message.content)) ?? [],
      }));
      return;
    }

    if (routed.type === "queue-clear") {
      const queue = channelQueues.get(message.channelId);
      const removed = queue?.pending.splice(0) ?? [];

      for (const entry of removed) {
        try {
          await entry.message.reply("이 요청은 /queue-clear로 대기열에서 삭제되었습니다.");
        } catch (error) {
          console.warn("discord-bot failed to acknowledge a cleared queue entry", error);
        } finally {
          await completeDurableMessage(entry.message);
          entry.resolve();
        }
      }

      await reply(formatQueueClearResult({
        clearedCount: removed.length,
        active: Boolean(queue?.activeMessage),
      }));
      return;
    }

    if (routed.type === "codex-steer" || routed.type === "codex-interrupt") {
      const action = routed.type === "codex-steer" ? "steer" : "interrupt";

      if (channelContext.channelMode === "claude-code") {
        await reply(formatCodexTurnControlResult({
          action,
          status: "unsupported",
          message: "Claude Code의 현재 headless 실행 방식은 실행 중 steering/interrupt를 지원하지 않습니다. /queue prompt:<요청>으로 다음 요청을 예약할 수 있습니다.",
        }));
        return;
      }

      if (!input.controlCodexTurn) {
        await reply(formatCodexTurnControlResult({
          action,
          status: "unsupported",
          message: "이 봇 실행 모드에는 Codex app-server turn 제어가 연결되어 있지 않습니다.",
        }));
        return;
      }

      const result = await input.controlCodexTurn({
        computerId: channelContext.computerId,
        controlKey: message.channelId,
        action,
        ...(routed.type === "codex-steer" ? { content: routed.content } : {}),
      });
      await reply(formatCodexTurnControlResult({ action, ...result }));
      return;
    }

    if (routed.type === "bot-help") {
      await reply(formatHelp(channelContext.channelMode));
      return;
    }

    if (routed.type === "channel-status") {
      const queue = channelQueues.get(message.channelId);
      const claudeSessionId =
        channelContext.channelMode === "claude-code"
          ? claudeSessionIdsByChannel.get(message.channelId) ?? channelContext.claudeSessionId ?? null
          : null;

      await reply(
        formatChannelStatus({
          ...channelContext,
          claudeSessionId,
          codexModel: codexModelsByChannel.get(message.channelId) ?? null,
          execution: {
            active: Boolean(queue?.activeMessage),
            activeRequest: queue?.activeMessage ? queueMessageSummary(queue.activeMessage.content) : null,
            startedAt: queue?.activeStartedAt ?? null,
            lastActivityAt: queue?.activeLastActivityAt ?? null,
            pendingCount: queue?.pending.length ?? 0,
            waitingForApproval: channelWaitingForApproval(message.channelId),
          },
        }),
      );
      return;
    }

    if (routed.type === "maintenance-panel") {
      await reply(formatMaintenancePanel(channelContext.channelMode));
      return;
    }

    if (routed.type === "admin-sync") {
      const queuedReply = await reply(formatSyncAck({ limit: routed.limit }));

      try {
        if (!input.syncCodexSessions) {
          throw new Error("Codex session sync is not connected for this bot mode.");
        }

        if (!message.guild) {
          throw new Error("Discord guild context is required for session sync.");
        }

        const result = await input.syncCodexSessions({
          guild: message.guild,
          limit: routed.limit,
          onProgress: async (progress) => {
            touchChannelActivity(message.channelId);
            await updateQueuedReply(
              queuedReply,
              (replyMessage) => reply(replyMessage),
              formatSyncProgressUpdate(progress),
            );
          },
        });
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatSyncResultUpdate({ result }),
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Codex session sync failed";
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatSyncResultUpdate({ error: { message: messageText } }),
        );
      }
      return;
    }

    if (routed.type === "admin-new-chat") {
      const newChatChannelMode = channelContext.channelMode === "claude-code" ? "claude-code" : "session-linked";
      const queuedReply = await reply(formatNewChatAck({
        ...routed,
        channelMode: newChatChannelMode,
      }));

      try {
        if (!input.createNewCodexChat) {
          throw new Error("New Codex chat creation is not connected for this bot mode.");
        }

        if (!message.guild) {
          throw new Error("Discord guild context is required for new Codex chat creation.");
        }

        const result = await input.createNewCodexChat({
          guild: message.guild,
          name: routed.name,
          cwd: routed.cwd,
          currentCwd: channelContext.cwd,
          useCategory: routed.useCategory,
          initialPrompt: routed.initialPrompt,
          channelMode: newChatChannelMode,
          sessionThreadParentChannelId:
            (channelContext.discordDeliveryMode ?? "channel") === "channel" ? message.channelId : null,
        });
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatNewChatResult({ result }),
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "New Codex chat creation failed";
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatNewChatResult({ error: { message: messageText } }),
        );
      }
      return;
    }

    if (routed.type === "admin-sync-status") {
      try {
        if (!input.getSyncStatus) {
          throw new Error("Codex sync status is not connected for this bot mode.");
        }

        await reply(formatSyncStatus(await input.getSyncStatus()));
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Codex sync status failed";
        await reply(formatSyncResultUpdate({ error: { message: messageText } }));
      }
      return;
    }

    if (routed.type === "admin-sync-mode") {
      try {
        if (!input.setTranscriptSyncMode) {
          throw new Error("Transcript sync mode is not connected for this bot mode.");
        }

        const result = await input.setTranscriptSyncMode(routed.mode);
        await reply(formatSyncModeResult(result));
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Transcript sync mode update failed";
        await reply(formatSyncResultUpdate({ error: { message: messageText } }));
      }
      return;
    }

    if (routed.type === "bot-reload") {
      if (routed.mode === "restart" && !routed.confirmed) {
        await reply(formatReloadConfirmation());
        return;
      }

      const queuedReply = await reply(formatReloadAck({ mode: routed.mode, force: routed.force }));

      try {
        if (!input.reloadBot) {
          throw new Error("Bot reload is not connected for this bot mode.");
        }

        const result = await input.reloadBot({
          mode: routed.mode,
          execution: executionState(message),
          force: routed.force,
        });

        if (result.deferred) {
          deferredRestartRequested = true;
          deferredRestartNotice = {
            channelId: message.channelId,
            guild: message.guild,
            reply: message.reply,
          };
        } else if (result.restarting) {
          deferredRestartRequested = false;
          restartScheduled = true;
        }

        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatReloadResult({ result }),
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Bot reload failed";
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatReloadResult({ error: { message: messageText } }),
        );
      }
      return;
    }

    if (routed.type === "admin-clear-messages") {
      if (routed.mode === "all" && !routed.confirmed) {
        await reply(formatClearConfirmation());
        return;
      }

      try {
        if (!message.clearMessages) {
          throw new Error("Discord message deletion is not connected for this bot mode.");
        }

        const result = await message.clearMessages({
          mode: routed.mode,
          ...(routed.mode === "count" ? { count: routed.count } : {}),
        });
        await reply(formatClearResult({ result }));
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Discord message deletion failed";
        await reply(formatClearResult({ error: { message: messageText } }));
      }
      return;
    }

    if (routed.type === "admin-sync-select") {
      const queuedReply = await reply(formatSyncSelectionAck({ limit: routed.limit }));

      try {
        if (!input.previewSelectableCodexSessions) {
          throw new Error("Selectable Codex session sync is not connected for this bot mode.");
        }

        const result = await input.previewSelectableCodexSessions({ limit: routed.limit });
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatSyncSelection(result),
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Codex session selection failed";
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatSyncResultUpdate({ error: { message: messageText } }),
        );
      }
      return;
    }

    if (routed.type === "admin-sync-selected") {
      const queuedReply = await reply(formatSyncAck({ limit: routed.sessionIds.length }));

      try {
        if (!input.syncCodexSessions) {
          throw new Error("Codex session sync is not connected for this bot mode.");
        }

        if (!message.guild) {
          throw new Error("Discord guild context is required for session sync.");
        }

        const result = await input.syncCodexSessions({
          guild: message.guild,
          limit: routed.sessionIds.length,
          sessionIds: routed.sessionIds,
          onProgress: async (progress) => {
            touchChannelActivity(message.channelId);
            await updateQueuedReply(
              queuedReply,
              (replyMessage) => reply(replyMessage),
              formatSyncProgressUpdate(progress),
            );
          },
        });
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatSyncResultUpdate({ result }),
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Codex session sync failed";
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatSyncResultUpdate({ error: { message: messageText } }),
        );
      }
      return;
    }

    if (routed.type === "admin-sync-delete") {
      try {
        if (!routed.confirmed) {
          if (!input.previewSyncedChannelsDelete) {
            throw new Error("Synced channel delete preview is not connected for this bot mode.");
          }

          await reply(
            formatDeletePreview(
              await input.previewSyncedChannelsDelete({
                mode: routed.mode,
                ...(routed.mode === "session" ? { sessionId: routed.sessionId ?? null } : {}),
              }),
            ),
          );
          return;
        }

        if (!input.deleteSyncedChannels) {
          throw new Error("Synced channel deletion is not connected for this bot mode.");
        }

        if (!message.guild) {
          throw new Error("Discord guild context is required for synced channel deletion.");
        }

        const queuedReply = await reply(formatDeleteAck({ mode: routed.mode }));
        const result = await input.deleteSyncedChannels({
          guild: message.guild,
          mode: routed.mode,
          ...(routed.mode === "session" ? { sessionId: routed.sessionId ?? null } : {}),
        });
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatDeleteResult({ result }),
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Synced channel deletion failed";
        await reply(formatDeleteResult({ error: { message: messageText } }));
      }
      return;
    }

    if (routed.type === "archive-session") {
      if (!routed.confirmed) {
        await reply(formatArchiveAck({ confirmed: false, sessionId: routed.sessionId }));
        return;
      }

      const queuedReply = await reply(formatArchiveAck({ confirmed: true, sessionId: routed.sessionId }));

      try {
        if (!input.archiveSyncedSession) {
          throw new Error("Codex session archive is not connected for this bot mode.");
        }

        const result = await input.archiveSyncedSession({
          guild: message.guild ?? null,
          discordChannelId: message.channelId,
          codexSessionId: routed.sessionId ?? channelContext.codexSessionId ?? null,
        });

        try {
          await updateQueuedReply(
            queuedReply,
            (replyMessage) => reply(replyMessage),
            formatArchiveResult({ result }),
          );
        } catch (error) {
          console.warn("discord-bot could not edit archive result, possibly because the channel was deleted", error);
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Codex session archive failed";
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatArchiveResult({ error: { message: messageText } }),
        );
      }
      return;
    }

    if (routed.type === "schedule-command") {
      try {
        if (!input.scheduleCommand) {
          throw new Error("Scheduled commands are not connected for this bot mode.");
        }

        const result = await input.scheduleCommand({
          request: routed.request,
          channelId: message.channelId,
          userId: message.userId,
          roleIds: message.roleIds,
        });
        await reply(formatScheduleResult(result));
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Schedule command failed";
        await reply(formatScheduleResult({ error: { message: messageText } }));
      }
      return;
    }

    if (routed.type === "codex-model") {
      codexModelsByChannel.set(message.channelId, routed.model);
      await reply(formatCodexModelResult({ model: routed.model }));
      return;
    }

    if (routed.type === "codex-run-mode") {
      if (routed.mode === "default") {
        codexRunModesByChannel.delete(message.channelId);
      } else {
        codexRunModesByChannel.set(message.channelId, routed.mode);
      }

      await reply(
        formatCodexRunModeResult({
          mode: routed.mode,
          reasoningEffort: reasoningEffortForChannel(message.channelId),
        }),
      );
      return;
    }

    if (routed.type === "codex-review") {
      const codexMessage = {
        computerDisplayName: channelContext.computerDisplayName,
        workspaceDisplayName: channelContext.workspaceDisplayName,
        cwd: channelContext.cwd,
        prompt: routed.prompt,
        permissionSettings: codexPermissionSettings(),
      };

      if (!input.submitCodexPrompt) {
        await reply(
          formatCodexResultUpdate(codexMessage, {
            error: { message: "Codex review is not connected for this mode yet." },
          }),
        );
        return;
      }

      const queuedReply = await reply(formatCodexAck(codexMessage));
      let recentEvents: string[] = [];
      const progressReporter = createLiveProgressReporter({ message, channelContext, agentLabel: "Codex" });

      try {
        const response = await input.submitCodexPrompt({
          computerId: channelContext.computerId,
          ...(message.requestId ? { requestId: message.requestId, queueKey: message.channelId } : {}),
          payload: {
            workspaceRoot: channelContext.workspaceRoot,
            cwd: channelContext.cwd,
            prompt: routed.prompt,
            timeoutMs: resolveCodexPromptTimeoutMs(channelContext.timeoutMs),
            sessionId: null,
            mode: "review",
            model: codexModelsByChannel.get(message.channelId) ?? null,
            reasoningEffort: reasoningEffortForChannel(message.channelId),
            controlKey: message.channelId,
          },
          onProgress: async (event) => {
            touchChannelActivity(message.channelId);
            const status = event.type === "operation-progress" ? event.label : event.type;
            recentEvents = appendProgressEvent(recentEvents, readableProgressEvent(event));
            await progressReporter.publish(event);
            await updateQueuedReply(
              queuedReply,
              (replyMessage) => reply(replyMessage),
              formatCodexProgressUpdate(codexMessage, {
                status,
                latestMessage:
                  event.type === "operation-progress"
                    ? event.detail
                    : event.type === "agent-message"
                      ? event.text
                      : undefined,
                recentEvents,
              }),
            );
          },
          onApprovalRequest: (request) => requestCodexApproval(replyWithRoleMentions, message.channelId, request),
        });
        progressReporter.finish();

        const reviewSessionId = extractCodexResponseSessionId(response);

        await updateQueuedResultReply({
          message,
          queuedReply,
          fallbackReply: (replyMessage) => reply(replyMessage),
          payload: formatCodexResultUpdate(codexMessage, response, { recentEvents }),
        });
        const responseFailed = promptResponseFailed(response);
        const completionDelivery = await sendThreadCompletionMention({
          message,
          channelContext,
          agentLabel: "Codex",
          failed: responseFailed,
          deferForPendingRequest: !responseFailed && channelHasPendingAgentRequests(message.channelId, channelContext),
        });

        if (reviewSessionId) {
          if (completionDelivery !== "unavailable") {
            await input.markDiscordRequestedCodexSession?.(reviewSessionId, {
              discordChannelId: message.channelId,
              completionMentionSent: true,
            });
          } else {
            await input.markDiscordRequestedCodexSession?.(reviewSessionId, {
              discordChannelId: message.channelId,
            });
          }
        }
      } catch (error) {
        progressReporter.finish();
        const messageText = error instanceof Error ? error.message : "Codex review failed";
        await updateQueuedResultReply({
          message,
          queuedReply,
          fallbackReply: (replyMessage) => reply(replyMessage),
          payload: formatCodexResultUpdate(codexMessage, { error: { message: messageText } }, { recentEvents }),
        });
        await sendThreadCompletionMention({
          message,
          channelContext,
          agentLabel: "Codex",
          failed: true,
        });
      }
      return;
    }

    if (routed.type === "fork-session") {
      if (channelContext.channelMode !== "session-linked" && channelContext.channelMode !== "claude-code") {
        await reply(
          formatForkSessionResult({
            error: {
              message: "현재 /fork는 Codex 또는 Claude Code session thread에서만 지원됩니다.",
            },
          }),
        );
        return;
      }

      const isClaudeFork = channelContext.channelMode === "claude-code";
      const sourceSessionId = isClaudeFork
        ? claudeSessionIdsByChannel.get(message.channelId) ?? channelContext.claudeSessionId ?? null
        : codexSessionIdsByChannel.get(message.channelId) ?? channelContext.codexSessionId ?? null;

      const queuedReply = await reply(
        formatForkSessionAck({
          name: routed.name,
          channelMode: channelContext.channelMode,
          sourceSessionId,
        }),
      );
      let forkThread: NewCodexChatResult | null = null;
      const activeForkSessionIds = new Set<string>();

      const trackActiveForkSession = (sessionId: string) => {
        if (!input.setSessionStreaming || activeForkSessionIds.has(sessionId)) {
          return;
        }

        activeForkSessionIds.add(sessionId);
        input.setSessionStreaming(sessionId, true);
      };

      try {
        if (!sourceSessionId) {
          const agentLabel = isClaudeFork ? "Claude Code" : "Codex";
          throw new Error(`현재 Discord thread에 연결된 ${agentLabel} session ID가 없습니다. 먼저 이 thread에서 요청을 한 번 실행해 주세요.`);
        }

        if (!input.createForkedSessionThread) {
          throw new Error("Session fork thread creation is not connected for this bot mode.");
        }

        if (!message.guild) {
          throw new Error("Discord guild context is required for session fork.");
        }

        forkThread = await input.createForkedSessionThread({
          guild: message.guild,
          sourceDiscordChannelId: message.channelId,
          sourceSessionId,
          name: routed.name,
        });

        let forkSessionId: string | null = null;
        let finalMessage: string | null = null;

        if (isClaudeFork) {
          if (!input.submitClaudePrompt) {
            throw new Error("Claude Code is not connected for this bot mode.");
          }

          const response = await input.submitClaudePrompt({
            computerId: channelContext.computerId,
            ...(message.requestId ? { requestId: message.requestId, queueKey: message.channelId } : {}),
            payload: {
              workspaceRoot: forkThread.workspaceRoot,
              cwd: forkThread.cwd,
              prompt: claudeForkPrompt(routed.name),
              timeoutMs: resolveCodexPromptTimeoutMs(channelContext.timeoutMs),
              sessionId: sourceSessionId,
              forkSession: true,
            },
          });

          const failureMessage = forkResponseErrorMessage(response, "Claude Code");
          if (failureMessage) {
            throw new Error(failureMessage);
          }

          forkSessionId = extractCodexResponseSessionId(response);
          finalMessage = extractCodexResponseFinalMessage(response);

          if (!forkSessionId) {
            throw new Error("Claude Code fork가 새 session ID를 반환하지 않았습니다.");
          }

          if (forkSessionId.toLowerCase() === sourceSessionId.toLowerCase()) {
            throw new Error("Claude Code fork가 원본과 같은 session ID를 반환해 연결을 중단했습니다.");
          }

          if (!input.recordClaudeSession) {
            throw new Error("Claude Code fork session persistence is not connected for this bot mode.");
          }

          await input.recordClaudeSession({
            discordChannelId: forkThread.discordChannelId,
            claudeSessionId: forkSessionId,
          });
          claudeSessionIdsByChannel.set(forkThread.discordChannelId, forkSessionId);
        } else {
          if (!input.submitCodexPrompt) {
            throw new Error("Codex chat is not connected for this bot mode.");
          }

          const response = await input.submitCodexPrompt({
            computerId: channelContext.computerId,
            ...(message.requestId ? { requestId: message.requestId, queueKey: message.channelId } : {}),
            payload: {
              workspaceRoot: forkThread.workspaceRoot,
              cwd: forkThread.cwd,
              prompt: codexForkPrompt(routed.name),
              timeoutMs: resolveCodexPromptTimeoutMs(channelContext.timeoutMs),
              sessionId: sourceSessionId,
              forkSession: true,
              model: codexModelsByChannel.get(message.channelId) ?? null,
              reasoningEffort: reasoningEffortForChannel(message.channelId),
              controlKey: forkThread.discordChannelId,
            },
            onProgress: (event) => {
              if (event.type === "thread-started") {
                trackActiveForkSession(event.sessionId);
              }
            },
            onApprovalRequest: (request) => requestCodexApproval(replyWithRoleMentions, message.channelId, request),
          });

          const failureMessage = forkResponseErrorMessage(response, "Codex");
          if (failureMessage) {
            throw new Error(failureMessage);
          }

          forkSessionId = extractCodexResponseSessionId(response);
          finalMessage = extractCodexResponseFinalMessage(response);

          if (!forkSessionId) {
            throw new Error("Codex fork가 새 session ID를 반환하지 않았습니다.");
          }

          if (forkSessionId.toLowerCase() === sourceSessionId.toLowerCase()) {
            throw new Error("Codex fork가 원본과 같은 session ID를 반환해 연결을 중단했습니다.");
          }

          if (!input.linkNewCodexSession) {
            throw new Error("Codex fork session persistence is not connected for this bot mode.");
          }

          await input.linkNewCodexSession({
            discordChannelId: forkThread.discordChannelId,
            codexSessionId: forkSessionId,
            threadName: routed.name,
          });
          codexSessionIdsByChannel.set(forkThread.discordChannelId, forkSessionId);
        }

        try {
          await message.guild.sendTextMessage?.(
            forkThread.discordChannelId,
            formatForkedSessionThreadNotice({
              channelMode: forkThread.channelMode,
              sourceChannelId: message.channelId,
              sourceSessionId,
              forkSessionId,
              finalMessage,
            }),
            { mentionRoleIds: channelContext.allowedRoleIds },
          );
        } catch (error) {
          console.warn("discord-bot failed to post the fork thread notice", error);
        }

        if (!isClaudeFork && forkSessionId) {
          try {
            await input.markDiscordRequestedCodexSession?.(forkSessionId, {
              discordChannelId: forkThread.discordChannelId,
              completionMentionSent: true,
            });
          } catch (error) {
            console.warn("discord-bot failed to record the fork completion delivery", error);
          }
        }

        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatForkSessionResult({
            result: forkThread,
            sourceSessionId,
            forkSessionId,
            finalMessage,
          }),
        );
      } catch (error) {
        if (forkThread && message.guild && input.discardForkedSessionThread) {
          codexSessionIdsByChannel.delete(forkThread.discordChannelId);
          claudeSessionIdsByChannel.delete(forkThread.discordChannelId);

          try {
            await input.discardForkedSessionThread({
              guild: message.guild,
              discordChannelId: forkThread.discordChannelId,
            });
          } catch (cleanupError) {
            console.warn("discord-bot failed to clean up an unlinked fork thread", cleanupError);
          }
        }

        const messageText = error instanceof Error ? error.message : "Session fork failed";
        await updateQueuedReply(
          queuedReply,
          (replyMessage) => reply(replyMessage),
          formatForkSessionResult({ error: { message: messageText } }),
        );
      } finally {
        for (const sessionId of activeForkSessionIds) {
          input.setSessionStreaming?.(sessionId, false);
        }
      }
      return;
    }

    if (routed.type === "claude-chat") {
      const prompt = routed.content;
      const claudeMessage = {
        computerDisplayName: channelContext.computerDisplayName,
        workspaceDisplayName: channelContext.workspaceDisplayName,
        cwd: channelContext.cwd,
        prompt,
        agentLabel: "Claude Code",
      };

      if (!input.submitClaudePrompt) {
        await reply(
          formatCodexResultUpdate(claudeMessage, {
            error: { message: "Claude Code is not connected for this mode yet." },
          }),
        );
        return;
      }

      const queuedReply = await reply(formatCodexAck(claudeMessage));
      let recentEvents: string[] = [];
      let latestAgentMessage: string | null = null;
      let streamedSessionId =
        claudeSessionIdsByChannel.get(message.channelId) ?? channelContext.claudeSessionId ?? null;
      const progressReporter = createLiveProgressReporter({ message, channelContext, agentLabel: "Claude Code" });

      try {
        const response = await input.submitClaudePrompt({
          computerId: channelContext.computerId,
          ...(message.requestId ? { requestId: message.requestId, queueKey: message.channelId } : {}),
          payload: {
            workspaceRoot: channelContext.workspaceRoot,
            cwd: channelContext.cwd,
            prompt,
            timeoutMs: resolveCodexPromptTimeoutMs(channelContext.timeoutMs),
            sessionId: streamedSessionId,
          },
          onProgress: async (event) => {
            touchChannelActivity(message.channelId);
            if (event.type === "agent-message" && event.text?.trim()) {
              latestAgentMessage = event.text.trim();
            }

            if (event.type === "thread-started") {
              streamedSessionId = event.sessionId;
              recentEvents = appendProgressEvent(recentEvents, "생각중...");
              await updateQueuedReply(
                queuedReply,
                (replyMessage) => reply(replyMessage),
                formatCodexProgressUpdate(claudeMessage, {
                  status: "session opened",
                  sessionId: streamedSessionId,
                  recentEvents,
                }),
              );
              return;
            }

            const status = event.type === "operation-progress" ? event.label : event.type;
            recentEvents = appendProgressEvent(recentEvents, readableProgressEvent(event));
            await progressReporter.publish(event);
            await updateQueuedReply(
              queuedReply,
              (replyMessage) => reply(replyMessage),
              formatCodexProgressUpdate(claudeMessage, {
                status,
                sessionId: streamedSessionId,
                latestMessage:
                  event.type === "operation-progress"
                    ? event.detail
                    : event.type === "agent-message"
                      ? event.text
                      : undefined,
                recentEvents,
              }),
            );
          },
        });
        progressReporter.finish();
        const responseForDisplay = withAgentMessageFallback(response, latestAgentMessage);
        const responseSessionId = extractCodexResponseSessionId(response);
        const responseFailed = promptResponseFailed(response);

        if (responseSessionId) {
          claudeSessionIdsByChannel.set(message.channelId, responseSessionId);
          await input.recordClaudeSession?.({
            discordChannelId: message.channelId,
            claudeSessionId: responseSessionId,
          });
        }

        await updateQueuedResultReply({
          message,
          queuedReply,
          fallbackReply: (replyMessage) => reply(replyMessage),
          payload: formatCodexResultUpdate(claudeMessage, responseForDisplay, { recentEvents }),
          postAsNewMessage: channelContext.discordDeliveryMode === "thread",
          terminalPayload: formatAgentResultPosted({ agentLabel: "Claude Code", failed: responseFailed }),
        });
        await sendThreadCompletionMention({
          message,
          channelContext,
          agentLabel: "Claude Code",
          failed: responseFailed,
          deferForPendingRequest: !responseFailed && channelHasPendingAgentRequests(message.channelId, channelContext),
        });
      } catch (error) {
        progressReporter.finish();
        const messageText = error instanceof Error ? error.message : "Claude Code prompt failed";
        await updateQueuedResultReply({
          message,
          queuedReply,
          fallbackReply: (replyMessage) => reply(replyMessage),
          payload: formatCodexResultUpdate(claudeMessage, { error: { message: messageText } }, { recentEvents }),
          postAsNewMessage: channelContext.discordDeliveryMode === "thread",
          terminalPayload: formatAgentResultPosted({ agentLabel: "Claude Code", failed: true }),
        });
        await sendThreadCompletionMention({
          message,
          channelContext,
          agentLabel: "Claude Code",
          failed: true,
        });
      }
      return;
    }

    if (routed.type === "codex-chat" || routed.type === "codex-continue-session") {
      const prompt = routed.content;
      const codexMessage = {
        computerDisplayName: channelContext.computerDisplayName,
        workspaceDisplayName: channelContext.workspaceDisplayName,
        cwd: channelContext.cwd,
        prompt,
        permissionSettings: codexPermissionSettings(),
      };

      if (!input.submitCodexPrompt) {
        await reply(
          formatCodexResultUpdate(codexMessage, {
            error: { message: "Codex chat is not connected for this mode yet." },
          }),
        );
        return;
      }

      const queuedReply = await reply(formatCodexAck(codexMessage));
      const activeStreamingSessionIds = new Set<string>();
      let recentEvents: string[] = [];
      let latestAgentMessage: string | null = null;
      const progressReporter = createLiveProgressReporter({ message, channelContext, agentLabel: "Codex" });

      try {
        if (
          channelContext.channelMode === "session-linked" &&
          input.syncTranscriptUpdates &&
          message.guild
        ) {
          await input.syncTranscriptUpdates({
            guild: message.guild,
            discordChannelId: message.channelId,
            trigger: "on-chat",
            postUpdates: false,
          });
        }

        let streamedSessionId =
          routed.type === "codex-continue-session"
            ? routed.sessionId
            : codexSessionIdsByChannel.get(message.channelId) ?? channelContext.codexSessionId ?? null;

        if (streamedSessionId && input.setSessionStreaming) {
          input.setSessionStreaming(streamedSessionId, true);
          activeStreamingSessionIds.add(streamedSessionId);
        }

        const response = await input.submitCodexPrompt({
          computerId: channelContext.computerId,
          ...(message.requestId ? { requestId: message.requestId, queueKey: message.channelId } : {}),
          payload: {
            workspaceRoot: channelContext.workspaceRoot,
            cwd: channelContext.cwd,
            prompt,
            timeoutMs: resolveCodexPromptTimeoutMs(channelContext.timeoutMs),
            sessionId: streamedSessionId,
            model: codexModelsByChannel.get(message.channelId) ?? null,
            reasoningEffort: reasoningEffortForChannel(message.channelId),
            controlKey: message.channelId,
          },
          onProgress: async (event) => {
            touchChannelActivity(message.channelId);
            if (event.type === "thread-started") {
              streamedSessionId = event.sessionId;
              recentEvents = appendProgressEvent(recentEvents, "생각중...");
              if (input.setSessionStreaming && !activeStreamingSessionIds.has(streamedSessionId)) {
                input.setSessionStreaming(streamedSessionId, true);
                activeStreamingSessionIds.add(streamedSessionId);
              }
              await updateQueuedReply(
                queuedReply,
                (replyMessage) => reply(replyMessage),
                formatCodexProgressUpdate(codexMessage, {
                  status: "session opened",
                  sessionId: streamedSessionId,
                  recentEvents,
                }),
              );
              return;
            }

            if (event.type === "agent-message") {
              if (event.text?.trim()) {
                latestAgentMessage = event.text.trim();
              }
              recentEvents = appendProgressEvent(recentEvents, readableProgressEvent(event));
              await progressReporter.publish(event);
              await updateQueuedReply(
                queuedReply,
                (replyMessage) => reply(replyMessage),
                formatCodexProgressUpdate(codexMessage, {
                  status: "writing answer",
                  sessionId: streamedSessionId,
                  latestMessage: event.text,
                  recentEvents,
                }),
              );
              return;
            }

            if (event.type === "operation-progress") {
              recentEvents = appendProgressEvent(recentEvents, readableProgressEvent(event));
              await progressReporter.publish(event);
              await updateQueuedReply(
                queuedReply,
                (replyMessage) => reply(replyMessage),
                formatCodexProgressUpdate(codexMessage, {
                  status: event.label,
                  sessionId: streamedSessionId,
                  latestMessage: event.detail,
                  recentEvents,
                }),
              );
              return;
            }

            recentEvents = appendProgressEvent(recentEvents, readableProgressEvent(event));
            await progressReporter.publish(event);
            await updateQueuedReply(
              queuedReply,
              (replyMessage) => reply(replyMessage),
              formatCodexProgressUpdate(codexMessage, {
                status: event.eventType,
                sessionId: streamedSessionId,
                recentEvents,
              }),
            );
          },
          onApprovalRequest: (request) => requestCodexApproval(replyWithRoleMentions, message.channelId, request),
        });
        progressReporter.finish();
        const responseForDisplay = withAgentMessageFallback(response, latestAgentMessage);
        const nextSessionId = extractCodexResponseSessionId(response);

        if (nextSessionId) {
          if (routed.type === "codex-chat") {
            codexSessionIdsByChannel.set(message.channelId, nextSessionId);
          }

          if (
            routed.type === "codex-chat" &&
            channelContext.channelMode === "session-linked" &&
            !channelContext.codexSessionId &&
            input.linkNewCodexSession
          ) {
            await input.linkNewCodexSession({
              discordChannelId: message.channelId,
              codexSessionId: nextSessionId,
              threadName: prompt.slice(0, 120) || "New Codex chat",
            });
          }
        }

        if (
          channelContext.channelMode === "session-linked" &&
          input.syncTranscriptUpdates &&
          message.guild
        ) {
          await input.syncTranscriptUpdates({
            guild: message.guild,
            discordChannelId: message.channelId,
            trigger: "on-chat",
            postUpdates: false,
          });
        }

        const responseFailed = promptResponseFailed(response);
        await updateQueuedResultReply({
          message,
          queuedReply,
          fallbackReply: (replyMessage) => reply(replyMessage),
          payload: formatCodexResultUpdate(codexMessage, responseForDisplay, { recentEvents }),
          postAsNewMessage: channelContext.discordDeliveryMode === "thread",
          terminalPayload: formatAgentResultPosted({ agentLabel: "Codex", failed: responseFailed }),
        });
        const completionDelivery = await sendThreadCompletionMention({
          message,
          channelContext,
          agentLabel: "Codex",
          failed: responseFailed,
          deferForPendingRequest: !responseFailed && channelHasPendingAgentRequests(message.channelId, channelContext),
        });

        if (nextSessionId) {
          if (completionDelivery !== "unavailable") {
            await input.markDiscordRequestedCodexSession?.(nextSessionId, {
              discordChannelId: message.channelId,
              completionMentionSent: true,
            });
          } else {
            await input.markDiscordRequestedCodexSession?.(nextSessionId, {
              discordChannelId: message.channelId,
            });
          }
        }
      } catch (error) {
        progressReporter.finish();
        if (
          channelContext.channelMode === "session-linked" &&
          input.syncTranscriptUpdates &&
          message.guild
        ) {
          await input.syncTranscriptUpdates({
            guild: message.guild,
            discordChannelId: message.channelId,
            trigger: "on-chat",
            postUpdates: false,
          });
        }

        const messageText = error instanceof Error ? error.message : "Codex prompt failed";
        await updateQueuedResultReply({
          message,
          queuedReply,
          fallbackReply: (replyMessage) => reply(replyMessage),
          payload: formatCodexResultUpdate(codexMessage, { error: { message: messageText } }, { recentEvents }),
          postAsNewMessage: channelContext.discordDeliveryMode === "thread",
          terminalPayload: formatAgentResultPosted({ agentLabel: "Codex", failed: true }),
        });
        await sendThreadCompletionMention({
          message,
          channelContext,
          agentLabel: "Codex",
          failed: true,
        });
      } finally {
        for (const sessionId of activeStreamingSessionIds) {
          input.setSessionStreaming?.(sessionId, false);
        }
      }
      return;
    }

    if (routed.type === "denied") {
      await reply(formatDenied(routed.reason));
      return;
    }

    if (routed.type === "blocked-command") {
      await reply(formatBlockedCommand(routed));
      return;
    }

    const commandMessage = {
      computerDisplayName: channelContext.computerDisplayName,
      workspaceDisplayName: channelContext.workspaceDisplayName,
      cwd: channelContext.cwd,
      command: routed.command,
      channelMode: channelContext.channelMode,
    };
    const queuedReply = await reply(formatCommandAck(commandMessage));

    try {
      const response = await input.submitCommandJob({
        computerId: channelContext.computerId,
        ...(message.requestId ? { requestId: message.requestId, queueKey: message.channelId } : {}),
        payload: {
          workspaceRoot: channelContext.workspaceRoot,
          cwd: channelContext.cwd,
          command: routed.command,
          timeoutMs: channelContext.timeoutMs,
          confirmedDangerous: routed.confirmedDangerous,
        },
      });
      await recordCommandAudit(input, {
        discordChannelId: message.channelId,
        userId: message.userId,
        cwd: channelContext.cwd,
        rawCommand: routed.command,
        resultStatus: extractResultStatus(response),
      });

      const nextCwd = extractUpdatedCwd(response);

      if (nextCwd) {
        await input.updateChannelCwd({
          discordChannelId: message.channelId,
          cwd: nextCwd,
        });
      }

      await updateQueuedReply(
        queuedReply,
        (replyMessage) => reply(replyMessage),
        formatCommandResultUpdate(commandMessage, response),
      );
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Control API request failed";
      await recordCommandAudit(input, {
        discordChannelId: message.channelId,
        userId: message.userId,
        cwd: channelContext.cwd,
        rawCommand: routed.command,
        resultStatus: "failed",
      });
      await updateQueuedReply(
        queuedReply,
        (replyMessage) => reply(replyMessage),
        formatCommandResultUpdate(commandMessage, { error: { message: messageText } }),
      );
    }
  }

  const handleDiscordMessage = async (message: DiscordMessageLike): Promise<void> => {
    if (message.authorBot) {
      return;
    }

    const immediateControl = Boolean(
      parseCodexApprovalResponse(message.content) || isImmediateQueueControl(message.content),
    );

    if ((deferredRestartRequested || restartScheduled) && !immediateControl) {
      await message.reply(formatRestartDrainPending());
      return;
    }

    if (immediateControl) {
      await processDiscordMessage(message);
      return;
    }

    let queue = channelQueues.get(message.channelId);
    let queuedMessage = message;

    if (queue?.activeMessage || isExplicitQueuePrompt(message.content)) {
      const channelContext = await input.resolveChannelContext(message.channelId);

      if (!channelContext) {
        return;
      }

      const routed = routeMessage(message, channelContext);

      if (routed.type === "queue-prompt") {
        queuedMessage = { ...message, content: routed.content };
      } else if (queue?.activeMessage && await tryAutoSteerCodexTurn(message, channelContext, queue)) {
        return;
      }
    }

    if (!queuedMessage.requestId && input.persistDurableRequest) {
      const channelContext = await input.resolveChannelContext(queuedMessage.channelId);

      if (!channelContext) {
        return;
      }

      const routed = routeMessage(queuedMessage, channelContext);
      if (isDurableAgentRequest(routed.type)) {
        const persisted = await input.persistDurableRequest({
          channelId: queuedMessage.channelId,
          userId: queuedMessage.userId,
          content: queuedMessage.content,
          roleIds: queuedMessage.roleIds,
          createdAt: queuedMessage.durableQueuedAt,
        });
        queuedMessage = {
          ...queuedMessage,
          requestId: persisted.requestId,
          durableQueuedAt: persisted.createdAt,
        };
      }
    }

    if (!queue) {
      queue = {
        running: false,
        activeMessage: null,
        activeStartedAt: null,
        activeLastActivityAt: null,
        pending: [],
      };
      channelQueues.set(message.channelId, queue);
    }

    if (queuedMessage.restoreOnly) {
      queue.pending.push({
        message: queuedMessage,
        resolve: () => undefined,
        reject: (error) => console.error(
          `discord-bot failed to run restored request ${queuedMessage.requestId ?? "unknown"}`,
          error,
        ),
      });
      queue.pending.sort((left, right) =>
        (left.message.durableQueuedAt ?? "").localeCompare(right.message.durableQueuedAt ?? ""),
      );
      return;
    }

    await new Promise<void>((resolve, reject) => {
      queue?.pending.push({ message: queuedMessage, resolve, reject });
      queue?.pending.sort((left, right) =>
        (left.message.durableQueuedAt ?? "").localeCompare(right.message.durableQueuedAt ?? ""),
      );
      void drainChannelQueue(message.channelId, queue as ChannelQueue);
    });
  };

  handleDiscordMessage.drainRestoredMessages = () => {
    for (const [channelId, queue] of channelQueues) {
      void drainChannelQueue(channelId, queue);
    }
  };

  return handleDiscordMessage;

  async function drainChannelQueue(channelId: string, queue: ChannelQueue): Promise<void> {
    if (queue.running) {
      return;
    }

    queue.running = true;

    try {
      while (queue.pending.length > 0) {
        const entry = queue.pending.shift();

        if (!entry) {
          continue;
        }

        queue.activeMessage = entry.message;
        queue.activeStartedAt = Date.now();
        queue.activeLastActivityAt = queue.activeStartedAt;

        let completed = false;
        try {
          await processDiscordMessage(entry.message);
          completed = true;
          entry.resolve();
        } catch (error) {
          entry.reject(error);
        } finally {
          if (completed) {
            await completeDurableMessage(entry.message);
          }
          queue.activeMessage = null;
          queue.activeStartedAt = null;
          queue.activeLastActivityAt = null;
        }
      }
    } finally {
      queue.running = false;
      if (queue.pending.length === 0 && channelQueues.get(channelId) === queue) {
        channelQueues.delete(channelId);
      }

      await restartAfterQueueDrain();
    }
  }
}

function queueMessageSummary(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized || "(empty message)";
}

function isImmediateQueueControl(content: string): boolean {
  const normalized = content.replace(/\s+/g, " ").trim().replace(/^\/+/, "");
  return /^(?:where|status|context|target|pwd\?|queue-clear|clear-queue|interrupt|stop-current)(?:\s|$)/i.test(normalized)
    || /^(?:queue|queue-status)$/i.test(normalized)
    || /^(?:bot )?reload restart force confirm$/i.test(normalized)
    || /^steer\s+\S/i.test(normalized);
}

function isExplicitQueuePrompt(content: string): boolean {
  return /^\/*queue\s+prompt\s*:\s*\S/i.test(content.trim());
}

function isDurableAgentRequest(type: string): boolean {
  return type === "execute-command" ||
    type === "codex-chat" ||
    type === "codex-continue-session" ||
    type === "codex-review" ||
    type === "claude-chat";
}
