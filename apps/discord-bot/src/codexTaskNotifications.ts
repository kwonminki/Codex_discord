import type { DiscoveredCodexSession } from "../../../packages/codex-adapter/src/index.js";
import type { DiscordGuildSurface } from "./codexSessionSync.js";
import type {
  CodexTaskCompletionNotificationState,
  DirectSyncStateStore,
} from "./directState.js";
import type { DiscordMessagePayload } from "./responses.js";

const MAX_FIELD_CHARS = 180;
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

function latestTaskCompleteEvent(session: DiscoveredCodexSession): { key: string } | null {
  return (
    session.realtimeEvents
      ?.filter((event) => event.kind === "status" && event.text === "작업 완료")
      .at(-1) ?? null
  );
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
    embeds: [],
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
