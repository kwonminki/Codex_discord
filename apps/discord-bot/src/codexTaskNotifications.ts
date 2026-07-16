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
import type { DiscordFilePayload, DiscordMessagePayload } from "./responses.js";

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

function taskCompletionState(input: {
  state: DirectSyncState;
  notificationsBySession: Map<string, CodexTaskCompletionNotificationState>;
  discordRequestedSessionIds?: Set<string>;
  now: string;
}): DirectSyncState {
  return {
    ...input.state,
    taskCompletionNotificationsInitializedAt: input.state.taskCompletionNotificationsInitializedAt ?? input.now,
    taskCompletionNotificationScope: TASK_COMPLETION_NOTIFICATION_SCOPE,
    taskCompletionNotifications: [...input.notificationsBySession.values()],
    discordRequestedCodexSessionIds: [
      ...(input.discordRequestedSessionIds ?? new Set(input.state.discordRequestedCodexSessionIds)),
    ],
  };
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
  const answer = options.includeAnswer ? latestAssistantAnswer(session) : null;
  const answerPreview = answer ? formatAnswerPreview(answer) : null;
  const lines = [
    "**Codex 작업 완료**",
    `세션: \`${threadName}\``,
    cwd ? `위치: \`${cwd}\`` : null,
    updatedAt ? `업데이트: \`${updatedAt}\`` : null,
    `세션 ID: \`${session.id}\``,
  ].filter((line): line is string => Boolean(line));

  return {
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
        ],
      },
    ],
    ...(answer && answerPreview?.clipped ? { files: [answerAttachment(answer)] } : {}),
  };
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
  const existingThread = input.state.sessionChannels.find(
    (channel) => channel.codexSessionId === input.session.id && channel.discordDeliveryMode === "thread",
  );

  if (existingThread) {
    return { channel: existingThread, created: false };
  }

  if (!input.guild.createThread || !input.controlApi || !input.computerId) {
    return {
      channel: input.state.sessionChannels.find((channel) => channel.codexSessionId === input.session.id) ?? null,
      created: false,
    };
  }

  const previousChannel = input.state.sessionChannels.find((channel) => channel.codexSessionId === input.session.id);
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
  const discordRequestedSessionIds = new Set(state.discordRequestedCodexSessionIds);
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
  let completedSessions = 0;
  let notifiedSessions = 0;
  let changed = false;

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
    const ensuredThread = initialized
      ? await ensureSessionThread({
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
            state.sessionChannels.find(
              (channel) => normalizedSessionId(channel.codexSessionId ?? "") === sessionKey,
            ) ?? null,
          created: false,
        };

    if (ensuredThread.created) {
      changed = true;
    }

    if (previous?.lastTaskCompleteEventKey === completionEvent.key) {
      if (discordRequestedSessionIds.delete(sessionKey)) {
        changed = true;
      }
      continue;
    }

    const omitAnswerForDiscordRequest = discordRequestedSessionIds.has(sessionKey);

    notificationsBySession.set(
      sessionKey,
      nextNotificationState({
        session,
        eventKey: completionEvent.key,
        notifiedAt: null,
      }),
    );
    changed = true;

    if (initialized && input.guild.sendTextMessage) {
      await input.stateStore.write(taskCompletionState({
        state,
        notificationsBySession,
        discordRequestedSessionIds,
        now,
      }));
      changed = false;

      const syncedChannel = ensuredThread.channel;
      const targetChannelId = syncedChannel?.discordChannelId ?? input.adminChannelId;
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
      changed = true;
    }

    if (omitAnswerForDiscordRequest) {
      discordRequestedSessionIds.delete(sessionKey);
      changed = true;
    }
  }

  if (!initialized) {
    changed = true;
  }

  if (changed) {
    await input.stateStore.write(taskCompletionState({
      state,
      notificationsBySession,
      discordRequestedSessionIds,
      now,
    }));
  }

  return {
    checkedSessions: input.sessions.length,
    completedSessions,
    notifiedSessions,
    initialized: !initialized,
  };
}
