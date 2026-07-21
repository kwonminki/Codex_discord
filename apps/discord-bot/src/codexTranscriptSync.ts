import { createHash } from "node:crypto";
import type {
  CodexSessionContextMessage,
  CodexSessionRealtimeEvent,
  DiscoveredCodexSession,
} from "../../../packages/codex-adapter/src/index.js";
import type { DiscordGuildSurface } from "./codexSessionSync.js";
import type {
  DirectSyncStateStore,
  SyncedSessionChannelState,
  TranscriptSyncMode,
} from "./directState.js";
import { formatCollapsibleThoughtMessage, type DiscordMessagePayload } from "./responses.js";

const MAX_DISCORD_TEXT_LENGTH = 1_900;
const MAX_ROLLING_TRANSCRIPT_MESSAGES = 12;

export interface SyncCodexSessionTranscriptUpdatesInput {
  guild: Pick<DiscordGuildSurface, "sendTextMessage" | "editTextMessage">;
  stateStore: DirectSyncStateStore;
  sessions: DiscoveredCodexSession[];
  trigger: "on-chat" | "realtime";
  discordChannelId?: string;
  postUpdates?: boolean;
  ignoredSessionIds?: Iterable<string>;
  mentionRoleIds?: string[];
}

export interface SyncCodexSessionTranscriptUpdatesResult {
  mode: TranscriptSyncMode;
  trigger: "on-chat" | "realtime";
  checkedChannels: number;
  updatedChannels: number;
  postedMessages: number;
  skippedByMode: boolean;
}

interface TranscriptMessage {
  key: string;
  role: CodexSessionContextMessage["role"] | "status";
  text: string;
}

function transcriptMessageKey(message: CodexSessionContextMessage, occurrence: number): string {
  return createHash("sha1")
    .update(`${message.role}\0${message.text.trim()}\0${occurrence}`)
    .digest("hex");
}

function extractTranscriptMessages(session: DiscoveredCodexSession): TranscriptMessage[] {
  if (Array.isArray(session.realtimeEvents) && session.realtimeEvents.length > 0) {
    return session.realtimeEvents
      .filter((event) => event.text.trim().length > 0)
      .map((event) => ({
        key: event.key,
        role: realtimeEventRole(event),
        text: event.text.trim(),
      }));
  }

  const occurrenceByMessage = new Map<string, number>();
  const messages = session.contextPreview?.filter((message) => message.text.trim().length > 0) ?? [];

  return messages.map((message) => {
    const normalizedText = message.text.trim();
    const occurrenceKey = `${message.role}\0${normalizedText}`;
    const occurrence = occurrenceByMessage.get(occurrenceKey) ?? 0;
    occurrenceByMessage.set(occurrenceKey, occurrence + 1);

    return {
      key: transcriptMessageKey({ role: message.role, text: normalizedText }, occurrence),
      role: message.role,
      text: normalizedText,
    };
  });
}

export function latestTranscriptMessageKey(session: DiscoveredCodexSession): string | null {
  return extractTranscriptMessages(session).at(-1)?.key ?? null;
}

function realtimeEventRole(event: CodexSessionRealtimeEvent): TranscriptMessage["role"] {
  switch (event.kind) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    default:
      return "status";
  }
}

function sanitizeDiscordText(value: string): string {
  return value.replace(/@/g, "[at]").trimEnd();
}

function truncateDiscordText(value: string): string {
  if (value.length <= MAX_DISCORD_TEXT_LENGTH) {
    return value;
  }

  const suffix = "\n\n... (일부만 표시)";
  return `${value.slice(0, MAX_DISCORD_TEXT_LENGTH - suffix.length)}${suffix}`;
}

function quoteStatusText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatTranscriptUpdateMessage(input: {
  message: TranscriptMessage;
}): string | DiscordMessagePayload {
  const text = sanitizeDiscordText(input.message.text);

  if (input.message.role === "user") {
    const [firstLine = "", ...remainingLines] = text.split(/\r?\n/);
    const heading = `### ${firstLine}`;
    return truncateDiscordText([heading, ...remainingLines].join("\n").trimEnd());
  }

  if (input.message.role === "assistant") {
    return truncateDiscordText(text);
  }

  return formatCollapsibleThoughtMessage({
    collapsedContent: "> 생각중...",
    expandedContent: truncateDiscordText(quoteStatusText(text)),
  });
}

function formatRollingTranscriptUpdateMessage(messages: TranscriptMessage[]): string | DiscordMessagePayload {
  const recentMessages = messages.slice(-MAX_ROLLING_TRANSCRIPT_MESSAGES);
  const visibleParts = recentMessages
    .filter((message) => message.role !== "status")
    .map((message) => formatTranscriptUpdateMessage({ message }))
    .filter((message): message is string => typeof message === "string" && message.trim().length > 0);
  const expandedParts = recentMessages
    .map((message) =>
      message.role === "status"
        ? truncateDiscordText(quoteStatusText(sanitizeDiscordText(message.text)))
        : formatTranscriptUpdateMessage({ message }),
    )
    .map((message) => (typeof message === "string" ? message : message.content))
    .filter((message): message is string => typeof message === "string" && message.trim().length > 0);
  const hasThoughts = recentMessages.some((message) => message.role === "status");
  const collapsedContent = truncateDiscordText(visibleParts.join("\n\n").trim() || "> 생각중...");
  const expandedContent = truncateDiscordText(expandedParts.join("\n\n").trim() || collapsedContent);

  return hasThoughts
    ? formatCollapsibleThoughtMessage({
        collapsedContent,
        expandedContent,
      })
    : collapsedContent;
}

function responseMessageId(response: { id?: string } | void): string | null {
  return typeof response?.id === "string" && response.id.length > 0 ? response.id : null;
}

async function upsertTranscriptDiscordMessage(input: {
  guild: Pick<DiscordGuildSurface, "sendTextMessage" | "editTextMessage">;
  channel: SyncedSessionChannelState;
  content: string | DiscordMessagePayload;
  mentionRoleIds?: string[];
}): Promise<string | null> {
  const existingMessageId = input.channel.lastTranscriptDiscordMessageId ?? null;

  if (existingMessageId && input.guild.editTextMessage) {
    try {
      const editedMessageId = responseMessageId(
        await input.guild.editTextMessage(input.channel.discordChannelId, existingMessageId, input.content),
      );
      return editedMessageId ?? existingMessageId;
    } catch (error) {
      console.warn("discord-bot failed to edit transcript sync message; sending a replacement", error);
    }
  }

  if (!input.guild.sendTextMessage) {
    return existingMessageId;
  }

  const mentionRoleIds =
    input.channel.discordDeliveryMode === "thread"
      ? input.mentionRoleIds?.filter((roleId) => roleId.trim().length > 0)
      : [];

  if (mentionRoleIds && mentionRoleIds.length > 0) {
    return responseMessageId(
      await input.guild.sendTextMessage(input.channel.discordChannelId, input.content, { mentionRoleIds }),
    );
  }

  return responseMessageId(await input.guild.sendTextMessage(input.channel.discordChannelId, input.content));
}

function nextChannelState(
  channel: SyncedSessionChannelState,
  session: DiscoveredCodexSession,
  latestMessageKey: string,
  transcriptDiscordMessageId?: string | null,
): SyncedSessionChannelState {
  return {
    ...channel,
    threadName: session.threadName,
    updatedAt: session.updatedAt,
    cwd: session.cwdHint ?? channel.cwd,
    lastTranscriptMessageKey: latestMessageKey,
    lastTranscriptSyncedAt: new Date().toISOString(),
    lastTranscriptDiscordMessageId: transcriptDiscordMessageId ?? channel.lastTranscriptDiscordMessageId ?? null,
  };
}

export async function syncCodexSessionTranscriptUpdates(
  input: SyncCodexSessionTranscriptUpdatesInput,
): Promise<SyncCodexSessionTranscriptUpdatesResult> {
  const state = await input.stateStore.read();
  const mode = state.transcriptSyncMode;

  if (input.trigger === "realtime" && mode !== "realtime") {
    return {
      mode,
      trigger: input.trigger,
      checkedChannels: 0,
      updatedChannels: 0,
      postedMessages: 0,
      skippedByMode: true,
    };
  }

  const ignoredSessionIds = new Set(input.ignoredSessionIds ?? []);
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  let checkedChannels = 0;
  let updatedChannels = 0;
  let postedMessages = 0;
  let changed = false;
  const changedChannels = new Map<string, SyncedSessionChannelState>();

  const sessionChannels = [...state.sessionChannels];

  for (let index = 0; index < sessionChannels.length; index += 1) {
    const channel = sessionChannels[index];

    if (input.discordChannelId && channel.discordChannelId !== input.discordChannelId) {
      continue;
    }

    if (!channel.codexSessionId) {
      continue;
    }

    const session = sessionsById.get(channel.codexSessionId);

    if (!session) {
      continue;
    }

    const transcriptMessages = extractTranscriptMessages(session);
    const latestMessage = transcriptMessages.at(-1);

    if (!latestMessage) {
      continue;
    }

    checkedChannels += 1;

    if (channel.lastTranscriptMessageKey === latestMessage.key) {
      continue;
    }

    const markerIndex = channel.lastTranscriptMessageKey
      ? transcriptMessages.findIndex((message) => message.key === channel.lastTranscriptMessageKey)
      : -1;
    const newMessages = channel.lastTranscriptMessageKey
      ? markerIndex >= 0
        ? transcriptMessages.slice(markerIndex + 1)
        : transcriptMessages
      : [];

    if (
      newMessages.length > 0 &&
      (input.guild.sendTextMessage || (channel.lastTranscriptDiscordMessageId && input.guild.editTextMessage)) &&
      input.postUpdates !== false &&
      !ignoredSessionIds.has(session.id)
    ) {
      const transcriptDiscordMessageId = await upsertTranscriptDiscordMessage({
        guild: input.guild,
        channel,
        content: formatRollingTranscriptUpdateMessage(transcriptMessages),
        mentionRoleIds: input.mentionRoleIds,
      });
      channel.lastTranscriptDiscordMessageId = transcriptDiscordMessageId;
      postedMessages += newMessages.length;
    }

    sessionChannels[index] = nextChannelState(
      channel,
      session,
      latestMessage.key,
      channel.lastTranscriptDiscordMessageId,
    );
    changedChannels.set(channel.discordChannelId, sessionChannels[index]);
    updatedChannels += 1;
    changed = true;
  }

  if (changed) {
    await input.stateStore.update((latestState) => ({
      ...latestState,
      sessionChannels: latestState.sessionChannels.map((channel) => {
        const changedChannel = changedChannels.get(channel.discordChannelId);

        if (
          !changedChannel ||
          changedChannel.codexSessionId?.toLowerCase() !== channel.codexSessionId?.toLowerCase()
        ) {
          return channel;
        }

        return {
          ...channel,
          threadName: changedChannel.threadName,
          updatedAt: changedChannel.updatedAt,
          cwd: changedChannel.cwd,
          lastTranscriptMessageKey: changedChannel.lastTranscriptMessageKey,
          lastTranscriptSyncedAt: changedChannel.lastTranscriptSyncedAt,
          lastTranscriptDiscordMessageId: changedChannel.lastTranscriptDiscordMessageId,
        };
      }),
    }));
  }

  return {
    mode,
    trigger: input.trigger,
    checkedChannels,
    updatedChannels,
    postedMessages,
    skippedByMode: false,
  };
}
