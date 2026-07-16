import type { DiscoveredCodexSession } from "../../../packages/codex-adapter/src/index.js";
import type { DiscordGuildSurface } from "./codexSessionSync.js";
import type {
  CodexTaskCompletionNotificationState,
  DirectSyncStateStore,
} from "./directState.js";
import type { DiscordFilePayload, DiscordMessagePayload } from "./responses.js";

const MAX_FIELD_CHARS = 180;
const MAX_ANSWER_EMBED_CHARS = 3_800;
const ANSWER_ATTACHMENT_NAME = "codex-answer.txt";
const ANSWER_EMBED_COLOR = 0x2ecc71;
const TASK_COMPLETION_NOTIFICATION_SCOPE = "all-nonarchived";

export interface NotifyCodexTaskCompletionsInput {
  guild: Pick<DiscordGuildSurface, "sendTextMessage">;
  stateStore: DirectSyncStateStore;
  adminChannelId: string;
  sessions: DiscoveredCodexSession[];
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

function formatTaskCompleteNotification(session: DiscoveredCodexSession): DiscordMessagePayload {
  const threadName = sanitizeInline(session.threadName) || session.id.slice(0, 8);
  const cwd = sanitizeInline(session.cwdHint);
  const updatedAt = sanitizeInline(session.updatedAt);
  const answer = latestAssistantAnswer(session);
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

export async function notifyCodexTaskCompletions(
  input: NotifyCodexTaskCompletionsInput,
): Promise<NotifyCodexTaskCompletionsResult> {
  const state = await input.stateStore.read();
  const notificationsBySession = new Map(
    state.taskCompletionNotifications.map((notification) => [notification.sessionId, notification]),
  );
  const initialized =
    Boolean(state.taskCompletionNotificationsInitializedAt) &&
    state.taskCompletionNotificationScope === TASK_COMPLETION_NOTIFICATION_SCOPE;
  const now = new Date().toISOString();
  let completedSessions = 0;
  let notifiedSessions = 0;
  let changed = false;

  for (const session of input.sessions) {
    const completionEvent = latestTaskCompleteEvent(session);

    if (!completionEvent) {
      continue;
    }

    completedSessions += 1;

    const previous = notificationsBySession.get(session.id);

    if (previous?.lastTaskCompleteEventKey === completionEvent.key) {
      continue;
    }

    if (initialized && input.guild.sendTextMessage) {
      await input.guild.sendTextMessage(input.adminChannelId, formatTaskCompleteNotification(session));
      notifiedSessions += 1;
    }

    notificationsBySession.set(
      session.id,
      nextNotificationState({
        session,
        eventKey: completionEvent.key,
        notifiedAt: initialized ? now : null,
      }),
    );
    changed = true;
  }

  if (!initialized) {
    changed = true;
  }

  if (changed) {
    await input.stateStore.write({
      ...state,
      taskCompletionNotificationsInitializedAt: state.taskCompletionNotificationsInitializedAt ?? now,
      taskCompletionNotificationScope: TASK_COMPLETION_NOTIFICATION_SCOPE,
      taskCompletionNotifications: [...notificationsBySession.values()],
    });
  }

  return {
    checkedSessions: input.sessions.length,
    completedSessions,
    notifiedSessions,
    initialized: !initialized,
  };
}
