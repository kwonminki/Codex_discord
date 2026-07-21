import type { DiscordGuildSurface } from "./codexSessionSync.js";
import type { DiscoveredClaudeCodeSession } from "./claudeSessionSync.js";
import { isExternallyStartedClaudeCodeSession } from "./claudeSessionSync.js";
import type {
  ClaudeCodeCompletionNotificationState,
  DirectSyncState,
  DirectSyncStateStore,
} from "./directState.js";
import {
  extractCodexDiscordSendOutputs,
  extractLocalMediaLinkOutputs,
  type DiscordFilePayload,
  type DiscordMessagePayload,
} from "./responses.js";

const MAX_FIELD_CHARS = 180;
const MAX_ANSWER_EMBED_CHARS = 3_800;
const ANSWER_ATTACHMENT_NAME = "claude-answer.txt";
const ANSWER_EMBED_COLOR = 0x8e44ad;
const CLAUDE_COMPLETION_NOTIFICATION_SCOPE = "external-claude-code-idle-assistant-messages-v2";
export const DEFAULT_CLAUDE_COMPLETION_IDLE_MS = 120_000;

export interface NotifyClaudeCodeTaskCompletionsInput {
  guild: Pick<DiscordGuildSurface, "sendTextMessage">;
  stateStore: DirectSyncStateStore;
  sessions: DiscoveredClaudeCodeSession[];
  mentionRoleIds?: string[];
  idleMs?: number;
  now?: Date;
}

export interface NotifyClaudeCodeTaskCompletionsResult {
  checkedSessions: number;
  completedSessions: number;
  notifiedSessions: number;
  initialized: boolean;
}

function sanitizeInline(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/`/g, "'")
    .replace(/@/g, "[at]")
    .trim()
    .slice(0, MAX_FIELD_CHARS);
}

function sanitizeDiscordText(value: string): string {
  return value.replace(/@/g, "[at]").trimEnd();
}

function normalizedSessionId(sessionId: string): string {
  return sessionId.trim().toLowerCase();
}

function formatAnswerPreview(answer: string): { description: string; clipped: boolean } {
  const sanitizedAnswer = sanitizeDiscordText(answer);

  if (sanitizedAnswer.length <= MAX_ANSWER_EMBED_CHARS) {
    return { description: sanitizedAnswer, clipped: false };
  }

  const suffix = `\n\n... (전체 답변은 첨부 파일 \`${ANSWER_ATTACHMENT_NAME}\`에서 확인하세요.)`;
  return {
    description: `${sanitizedAnswer.slice(0, MAX_ANSWER_EMBED_CHARS - suffix.length).trimEnd()}${suffix}`,
    clipped: true,
  };
}

function answerAttachment(answer: string): DiscordFilePayload {
  return {
    attachment: Buffer.from(answer, "utf8"),
    name: ANSWER_ATTACHMENT_NAME,
  };
}

function answerOutputs(answer: string): {
  previewAnswer: string;
  files: DiscordFilePayload[];
} {
  const discordSendOutputs = extractCodexDiscordSendOutputs(answer);
  const mediaLinkOutputs = extractLocalMediaLinkOutputs(discordSendOutputs.cleanedText);
  const files = [...discordSendOutputs.attachments, ...mediaLinkOutputs.attachments];

  if (!discordSendOutputs.hadBlocks && mediaLinkOutputs.notices.length === 0) {
    return { previewAnswer: answer, files };
  }

  const previewAnswer =
    [
      discordSendOutputs.cleanedText,
      ...discordSendOutputs.messages,
      ...discordSendOutputs.notices.map((notice) => `주의: ${notice}`),
      ...mediaLinkOutputs.notices.map((notice) => `주의: ${notice}`),
    ]
      .filter((line) => line.trim().length > 0)
      .join("\n") || (files.length > 0 ? "첨부 파일을 보냈습니다." : answer);

  return { previewAnswer, files };
}

function nextNotificationState(input: {
  session: DiscoveredClaudeCodeSession;
  notifiedAt?: string | null;
}): ClaudeCodeCompletionNotificationState {
  return {
    sessionId: input.session.id,
    lastAssistantMessageKey: input.session.latestAssistantMessageKey ?? "",
    threadName: input.session.firstUserMessage,
    updatedAt: input.session.updatedAt,
    notifiedAt: input.notifiedAt ?? null,
  };
}

function completionState(input: {
  state: DirectSyncState;
  notificationsBySession: Map<string, ClaudeCodeCompletionNotificationState>;
  now: string;
}): DirectSyncState {
  return {
    ...input.state,
    claudeCompletionNotificationsInitializedAt:
      input.state.claudeCompletionNotificationsInitializedAt ?? input.now,
    claudeCompletionNotificationScope: CLAUDE_COMPLETION_NOTIFICATION_SCOPE,
    claudeCompletionNotifications: [...input.notificationsBySession.values()],
  };
}

function formatClaudeCompleteNotification(session: DiscoveredClaudeCodeSession): DiscordMessagePayload {
  const threadName = sanitizeInline(session.firstUserMessage) || session.id.slice(0, 8);
  const cwd = sanitizeInline(session.cwd);
  const updatedAt = sanitizeInline(session.updatedAt);
  const rawAnswer = session.latestAssistantMessage ?? "";
  const parsedAnswer = answerOutputs(rawAnswer);
  const answer = parsedAnswer.previewAnswer;
  const answerPreview = formatAnswerPreview(answer);
  const lines = [
    "**Claude Code 작업 완료**",
    `세션: \`${threadName}\``,
    cwd ? `위치: \`${cwd}\`` : null,
    updatedAt ? `업데이트: \`${updatedAt}\`` : null,
    `Claude session: \`${session.id}\``,
  ].filter((line): line is string => Boolean(line));

  return {
    allowedMentions: { parse: [] },
    content: lines.join("\n"),
    embeds: [
      {
        title: "답변",
        color: ANSWER_EMBED_COLOR,
        description: answerPreview.description,
      },
    ],
    components: [],
    ...(answerPreview.clipped || parsedAnswer.files.length > 0
      ? {
          files: [
            ...(answerPreview.clipped ? [answerAttachment(answer)] : []),
            ...parsedAnswer.files,
          ],
        }
      : {}),
  };
}

function isClaudeCompletionCandidate(session: DiscoveredClaudeCodeSession, input: { now: Date; idleMs: number }): boolean {
  if (
    !isExternallyStartedClaudeCodeSession(session) ||
    !session.latestAssistantMessage ||
    !session.latestAssistantMessageKey ||
    session.latestActivityKind !== "assistant_text"
  ) {
    return false;
  }

  const updatedAtMs = Date.parse(session.updatedAt);

  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return updatedAtMs <= input.now.getTime() - input.idleMs;
}

export async function notifyClaudeCodeTaskCompletions(
  input: NotifyClaudeCodeTaskCompletionsInput,
): Promise<NotifyClaudeCodeTaskCompletionsResult> {
  const state = await input.stateStore.read();
  const notificationsBySession = new Map(
    state.claudeCompletionNotifications.map((notification) => [
      normalizedSessionId(notification.sessionId),
      notification,
    ]),
  );
  const channelGroupsByClaudeSession = new Map<string, typeof state.sessionChannels>();

  for (const channel of state.sessionChannels) {
    if (channel.channelMode !== "claude-code" || !channel.claudeSessionId) {
      continue;
    }

    const sessionId = normalizedSessionId(channel.claudeSessionId);
    channelGroupsByClaudeSession.set(sessionId, [
      ...(channelGroupsByClaudeSession.get(sessionId) ?? []),
      channel,
    ]);
  }

  const channelsByClaudeSession = new Map(
    [...channelGroupsByClaudeSession]
      .filter(([, channels]) => channels.length === 1)
      .map(([sessionId, channels]) => [sessionId, channels[0]]),
  );
  const initialized =
    Boolean(state.claudeCompletionNotificationsInitializedAt) &&
    state.claudeCompletionNotificationScope === CLAUDE_COMPLETION_NOTIFICATION_SCOPE;
  const nowDate = input.now ?? new Date();
  const now = nowDate.toISOString();
  const idleMs = Math.max(0, input.idleMs ?? DEFAULT_CLAUDE_COMPLETION_IDLE_MS);
  let completedSessions = 0;
  let notifiedSessions = 0;
  let changed = false;
  const persistState = async () => {
    await input.stateStore.update((latestState) => completionState({
      state: latestState,
      notificationsBySession,
      now,
    }));
  };

  for (const session of input.sessions) {
    if (!isClaudeCompletionCandidate(session, { now: nowDate, idleMs })) {
      continue;
    }

    completedSessions += 1;

    const sessionKey = normalizedSessionId(session.id);
    const previous = notificationsBySession.get(sessionKey);

    if (previous?.lastAssistantMessageKey === session.latestAssistantMessageKey) {
      continue;
    }

    const syncedChannel = channelsByClaudeSession.get(sessionKey);

    if (!initialized) {
      notificationsBySession.set(sessionKey, nextNotificationState({ session, notifiedAt: null }));
      changed = true;
      continue;
    }

    if (!syncedChannel || !input.guild.sendTextMessage) {
      continue;
    }

    await persistState();
    changed = false;

    const notification = formatClaudeCompleteNotification(session);
    const mentionRoleIds =
      syncedChannel.discordDeliveryMode === "thread"
        ? input.mentionRoleIds?.filter((roleId) => roleId.trim().length > 0)
        : [];

    if (mentionRoleIds && mentionRoleIds.length > 0) {
      await input.guild.sendTextMessage(syncedChannel.discordChannelId, notification, { mentionRoleIds });
    } else {
      await input.guild.sendTextMessage(syncedChannel.discordChannelId, notification);
    }

    notifiedSessions += 1;
    notificationsBySession.set(sessionKey, nextNotificationState({ session, notifiedAt: now }));
    changed = true;
  }

  if (!initialized) {
    changed = true;
  }

  if (changed) {
    await persistState();
  }

  return {
    checkedSessions: input.sessions.length,
    completedSessions,
    notifiedSessions,
    initialized: !initialized,
  };
}
