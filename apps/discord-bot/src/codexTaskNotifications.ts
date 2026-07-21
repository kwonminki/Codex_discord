import type { DiscoveredCodexSession } from "../../../packages/codex-adapter/src/index.js";
import type { ControlApiClient } from "./controlApiClient.js";
import {
  codexSessionDiscordThreadName,
  sessionTopic,
  workspaceDisplayName,
  workspaceId,
  type DiscordGuildSurface,
} from "./codexSessionSync.js";
import type {
  CodexTaskCompletionNotificationState,
  DirectSyncState,
  DirectSyncStateStore,
  SyncedSessionChannelState,
} from "./directState.js";
import {
  attachCodexVisibleProcessSnapshot,
  CODEX_PROGRESS_EVENT_LIMIT,
  codexVisibleProcessActionRow,
  extractCodexDiscordSendOutputs,
  extractLocalMediaLinkOutputs,
  type DiscordFilePayload,
  type DiscordMessagePayload,
} from "./responses.js";

const MAX_FIELD_CHARS = 180;
const MAX_ANSWER_EMBED_CHARS = 3_800;
const ANSWER_ATTACHMENT_NAME = "codex-answer.txt";
const ANSWER_EMBED_COLOR = 0x2ecc71;
const TASK_COMPLETION_NOTIFICATION_SCOPE = "all-nonarchived";

export interface NotifyCodexTaskCompletionsInput {
  guild: Pick<DiscordGuildSurface, "sendTextMessage" | "createThread">;
  controlApi?: Pick<ControlApiClient, "createManagedChannel" | "linkCodexSession">;
  stateStore: DirectSyncStateStore;
  adminChannelId: string;
  computerId?: string;
  defaultWorkspaceRoot?: string;
  sessions: DiscoveredCodexSession[];
  mentionRoleIds?: string[];
  ignoredSessionIds?: Iterable<string>;
}

export interface NotifyCodexTaskCompletionsResult {
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

function latestTaskCompleteEvent(session: DiscoveredCodexSession): { key: string } | null {
  return (
    session.realtimeEvents
      ?.filter((event) => event.kind === "status" && event.text === "작업 완료")
      .at(-1) ?? null
  );
}

function normalizedSessionId(sessionId: string): string {
  return sessionId.trim().toLowerCase();
}

function latestAssistantAnswer(session: DiscoveredCodexSession): string | null {
  const contextAnswer = session.contextPreview
    ?.filter((message) => message.role === "assistant" && message.text.trim().length > 0)
    .at(-1)?.text;

  if (contextAnswer?.trim()) {
    return contextAnswer.trim();
  }

  const realtimeAnswer = session.realtimeEvents
    ?.filter((event) => event.kind === "assistant" && event.text.trim().length > 0)
    .at(-1)?.text;

  return realtimeAnswer?.trim() || null;
}

function latestTaskProcessEvents(session: DiscoveredCodexSession, answer: string | null): string[] {
  const answerText = answer?.trim();

  return (
    session.realtimeEvents
      ?.filter((event) => event.kind !== "user")
      .filter((event) => !(event.kind === "status" && event.text === "작업 완료"))
      .map((event) => event.text.trim())
      .filter((text) => text.length > 0)
      .filter((text) => !answerText || text !== answerText)
      .slice(-CODEX_PROGRESS_EVENT_LIMIT) ?? []
  );
}

function taskProcessSnapshotText(session: DiscoveredCodexSession, answer: string | null): string {
  const processEvents = latestTaskProcessEvents(session, answer);

  return [
    "**생각 / 중간 출력**",
    ...(processEvents.length > 0 ? processEvents : ["아직 표시할 중간 출력이 없습니다."]),
  ].join("\n");
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

  const previewAnswer = [
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
  session: DiscoveredCodexSession;
  eventKey: string;
  notifiedAt?: string | null;
}): CodexTaskCompletionNotificationState {
  return {
    sessionId: input.session.id,
    lastTaskCompleteEventKey: input.eventKey,
    threadName: input.session.threadName,
    updatedAt: input.session.updatedAt,
    notifiedAt: input.notifiedAt ?? null,
  };
}

function formatTaskCompleteNotification(
  session: DiscoveredCodexSession,
  options: { includeAnswer: boolean } = { includeAnswer: true },
): DiscordMessagePayload {
  const threadName = sanitizeInline(session.threadName) || session.id.slice(0, 8);
  const cwd = sanitizeInline(session.cwdHint);
  const updatedAt = sanitizeInline(session.updatedAt);
  const latestAnswer = latestAssistantAnswer(session);
  const rawAnswer = options.includeAnswer ? latestAnswer : null;
  const parsedAnswer = rawAnswer ? answerOutputs(rawAnswer) : null;
  const answer = parsedAnswer?.previewAnswer ?? null;
  const answerFiles = parsedAnswer?.files ?? [];
  const answerPreview = answer ? formatAnswerPreview(answer) : null;
  const lines = [
    "**Codex 작업 완료**",
    `세션: \`${threadName}\``,
    cwd ? `위치: \`${cwd}\`` : null,
    updatedAt ? `업데이트: \`${updatedAt}\`` : null,
    `세션 ID: \`${session.id}\``,
  ].filter((line): line is string => Boolean(line));

  const payload: DiscordMessagePayload = {
    allowedMentions: { parse: [] },
    content: lines.join("\n"),
    embeds: answerPreview
      ? [
          {
            title: "답변",
            color: ANSWER_EMBED_COLOR,
            description: answerPreview.description,
          },
        ]
      : [],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: `cdc:codex:continue:${session.id}`,
            label: "이어 작업 요청",
            style: 1,
          },
          ...codexVisibleProcessActionRow().components,
        ],
      },
    ],
    ...(rawAnswer && (answerPreview?.clipped || answerFiles.length > 0)
      ? {
          files: [
            ...(answerPreview?.clipped ? [answerAttachment(answer ?? rawAnswer)] : []),
            ...answerFiles,
          ],
        }
      : {}),
  };

  return attachCodexVisibleProcessSnapshot(payload, taskProcessSnapshotText(session, latestAnswer));
}

function uniqueSessionChannel(
  state: DirectSyncState,
  sessionId: string,
  options: { threadOnly?: boolean } = {},
): SyncedSessionChannelState | null {
  const normalizedId = normalizedSessionId(sessionId);
  const matches = state.sessionChannels.filter(
    (channel) => normalizedSessionId(channel.codexSessionId ?? "") === normalizedId,
  );

  if (matches.length > 1) {
    console.error(
      `discord-bot found multiple Discord channels for Codex session ${sessionId}; completion routing was skipped`,
    );
    return null;
  }

  const match = matches[0] ?? null;
  return options.threadOnly && match?.discordDeliveryMode !== "thread" ? null : match;
}

async function ensureSessionThread(input: {
  guild: Pick<DiscordGuildSurface, "createThread">;
  controlApi?: Pick<ControlApiClient, "createManagedChannel" | "linkCodexSession">;
  state: DirectSyncState;
  adminChannelId: string;
  computerId?: string;
  defaultWorkspaceRoot?: string;
  session: DiscoveredCodexSession;
}): Promise<{ channel: SyncedSessionChannelState | null; created: boolean }> {
  const existingThread = uniqueSessionChannel(input.state, input.session.id, { threadOnly: true });

  if (existingThread) {
    return { channel: existingThread, created: false };
  }

  if (!input.guild.createThread || !input.controlApi || !input.computerId) {
    return {
      channel: uniqueSessionChannel(input.state, input.session.id),
      created: false,
    };
  }

  const previousChannel = uniqueSessionChannel(input.state, input.session.id);
  const workspaceRoot =
    input.session.cwdHint ??
    previousChannel?.workspaceRoot ??
    input.defaultWorkspaceRoot ??
    "";
  const displayName = previousChannel?.workspaceDisplayName ?? workspaceDisplayName(workspaceRoot);
  const nextWorkspaceId = previousChannel?.workspaceId ?? workspaceId(input.computerId, workspaceRoot);
  const thread = await input.guild.createThread({
    name: codexSessionDiscordThreadName(input.session),
    parentChannelId: input.adminChannelId,
    autoArchiveDuration: 10_080,
    reason: sessionTopic(input.session, workspaceRoot),
  });
  const nextChannel: SyncedSessionChannelState = {
    codexSessionId: input.session.id,
    threadName: input.session.threadName,
    updatedAt: input.session.updatedAt,
    cwd: input.session.cwdHint ?? previousChannel?.cwd ?? workspaceRoot,
    workspaceRoot,
    workspaceDisplayName: displayName,
    discordCategoryId: previousChannel?.discordCategoryId ?? null,
    discordChannelId: thread.id,
    discordParentChannelId: input.adminChannelId,
    discordDeliveryMode: "thread",
    channelName: codexSessionDiscordThreadName(input.session),
    computerId: input.computerId,
    workspaceId: nextWorkspaceId,
  };

  await input.controlApi.createManagedChannel({
    id: `channel:${thread.id}`,
    discordChannelId: thread.id,
    computerId: input.computerId,
    workspaceId: nextWorkspaceId,
    channelMode: "session-linked",
  });
  await input.controlApi.linkCodexSession({
    discordChannelId: thread.id,
    id: `session-link:${thread.id}:${input.session.id}`,
    codexSessionId: input.session.id,
    origin: "imported_native",
    threadNameSnapshot: input.session.threadName,
  });

  input.state.sessionChannels = [
    ...input.state.sessionChannels.filter((channel) => channel.codexSessionId !== input.session.id),
    nextChannel,
  ];

  return { channel: nextChannel, created: true };
}

export async function notifyCodexTaskCompletions(
  input: NotifyCodexTaskCompletionsInput,
): Promise<NotifyCodexTaskCompletionsResult> {
  const state = await input.stateStore.read();
  const notificationsBySession = new Map(
    state.taskCompletionNotifications.map((notification) => [
      normalizedSessionId(notification.sessionId),
      notification,
    ]),
  );
  const discordRequestedSessions = new Map(
    state.discordRequestedCodexSessionRequests.map((request) => [normalizedSessionId(request.sessionId), request]),
  );
  const ignoredSessionIds = new Set(
    [...(input.ignoredSessionIds ?? [])]
      .map((sessionId) => normalizedSessionId(sessionId))
      .filter((sessionId) => sessionId.length > 0),
  );
  const seenCompletionEvents = new Set<string>();
  const initialized =
    Boolean(state.taskCompletionNotificationsInitializedAt) &&
    state.taskCompletionNotificationScope === TASK_COMPLETION_NOTIFICATION_SCOPE;
  const now = new Date().toISOString();
  const replacementThreadsBySession = new Map<string, SyncedSessionChannelState>();
  const updatedNotificationSessionIds = new Set<string>();
  const consumedDiscordRequestSessionIds = new Set<string>();
  let completedSessions = 0;
  let notifiedSessions = 0;
  let changed = false;

  const persistState = async () => {
    await input.stateStore.update((latestState) => {
      const mergedNotifications = new Map(
        latestState.taskCompletionNotifications.map((notification) => [
          normalizedSessionId(notification.sessionId),
          notification,
        ]),
      );

      for (const sessionId of updatedNotificationSessionIds) {
        const notification = notificationsBySession.get(sessionId);
        if (notification) {
          mergedNotifications.set(sessionId, notification);
        }
      }

      let sessionChannels = latestState.sessionChannels;
      for (const [sessionId, replacement] of replacementThreadsBySession) {
        sessionChannels = [
          ...sessionChannels.filter(
            (channel) => normalizedSessionId(channel.codexSessionId ?? "") !== sessionId,
          ),
          replacement,
        ];
      }

      return {
        ...latestState,
        sessionChannels,
        taskCompletionNotificationsInitializedAt:
          latestState.taskCompletionNotificationsInitializedAt ?? now,
        taskCompletionNotificationScope: TASK_COMPLETION_NOTIFICATION_SCOPE,
        taskCompletionNotifications: [...mergedNotifications.values()],
        discordRequestedCodexSessionIds: [],
        discordRequestedCodexSessionRequests:
          latestState.discordRequestedCodexSessionRequests.filter(
            (request) => !consumedDiscordRequestSessionIds.has(normalizedSessionId(request.sessionId)),
          ),
      };
    });
  };

  for (const session of input.sessions) {
    const sessionKey = normalizedSessionId(session.id);

    if (ignoredSessionIds.has(sessionKey)) {
      continue;
    }

    const completionEvent = latestTaskCompleteEvent(session);

    if (!completionEvent) {
      continue;
    }

    completedSessions += 1;

    const completionEventKey = `${sessionKey}:${completionEvent.key}`;

    if (seenCompletionEvents.has(completionEventKey)) {
      continue;
    }

    seenCompletionEvents.add(completionEventKey);

    const previous = notificationsBySession.get(sessionKey);
    const discordRequest = discordRequestedSessions.get(sessionKey);
    const requestedChannel = discordRequest?.discordChannelId
      ? state.sessionChannels.find(
          (channel) => channel.discordChannelId === discordRequest.discordChannelId,
        ) ?? null
      : null;
    const ensuredThread = initialized
      ? discordRequest?.discordChannelId
        ? { channel: requestedChannel, created: false }
        : await ensureSessionThread({
            guild: input.guild,
            controlApi: input.controlApi,
            state,
            adminChannelId: input.adminChannelId,
            computerId: input.computerId,
            defaultWorkspaceRoot: input.defaultWorkspaceRoot,
            session,
          })
      : {
          channel:
            uniqueSessionChannel(state, session.id),
          created: false,
        };

    if (ensuredThread.created) {
      if (ensuredThread.channel) {
        replacementThreadsBySession.set(sessionKey, ensuredThread.channel);
      }
      changed = true;
    }

    if (previous?.lastTaskCompleteEventKey === completionEvent.key) {
      if (discordRequestedSessions.delete(sessionKey)) {
        consumedDiscordRequestSessionIds.add(sessionKey);
        changed = true;
      }
      continue;
    }

    const omitAnswerForDiscordRequest = Boolean(discordRequest);
    const completionMentionAlreadySent = discordRequest?.completionMentionSent === true;

    notificationsBySession.set(
      sessionKey,
      nextNotificationState({
        session,
        eventKey: completionEvent.key,
        notifiedAt: completionMentionAlreadySent ? now : null,
      }),
    );
    updatedNotificationSessionIds.add(sessionKey);
    changed = true;

    if (initialized && input.guild.sendTextMessage && !completionMentionAlreadySent) {
      await persistState();
      changed = false;

      const syncedChannel = ensuredThread.channel;
      const targetChannelId = discordRequest?.discordChannelId ?? syncedChannel?.discordChannelId ?? input.adminChannelId;
      const notification = formatTaskCompleteNotification(session, {
        includeAnswer: !omitAnswerForDiscordRequest,
      });
      const mentionRoleIds =
        syncedChannel?.discordDeliveryMode === "thread"
          ? input.mentionRoleIds?.filter((roleId) => roleId.trim().length > 0)
          : [];

      if (mentionRoleIds && mentionRoleIds.length > 0) {
        await input.guild.sendTextMessage(targetChannelId, notification, { mentionRoleIds });
      } else {
        await input.guild.sendTextMessage(targetChannelId, notification);
      }
      notifiedSessions += 1;

      notificationsBySession.set(
        sessionKey,
        nextNotificationState({
          session,
          eventKey: completionEvent.key,
          notifiedAt: now,
        }),
      );
      updatedNotificationSessionIds.add(sessionKey);
      changed = true;
    }

    if (omitAnswerForDiscordRequest) {
      discordRequestedSessions.delete(sessionKey);
      consumedDiscordRequestSessionIds.add(sessionKey);
      changed = true;
    }
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
