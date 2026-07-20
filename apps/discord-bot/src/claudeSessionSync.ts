import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ControlApiClient } from "./controlApiClient.js";
import {
  sanitizeDiscordThreadName,
  workspaceDisplayName,
  workspaceId,
  type DiscordGuildSurface,
} from "./codexSessionSync.js";
import type { DirectSyncState, DirectSyncStateStore, SyncedSessionChannelState } from "./directState.js";

const MAX_CHANNEL_NAME_LENGTH = 90;

export interface DiscoveredClaudeCodeSession {
  id: string;
  cwd: string;
  entrypoint: string | null;
  firstUserMessage: string | null;
  updatedAt: string;
  filePath: string;
}

export interface DiscoverClaudeCodeSessionsInput {
  claudeHome?: string;
  projectsRoot?: string;
  updatedAfter?: Date | null;
  excludeSessionIds?: Iterable<string>;
}

export interface SyncClaudeCodeSessionsInput {
  guild: Pick<DiscordGuildSurface, "createThread" | "sendTextMessage">;
  controlApi: Pick<ControlApiClient, "createManagedChannel">;
  stateStore: DirectSyncStateStore;
  computerId: string;
  computerDisplayName: string;
  parentChannelId: string;
  mentionRoleIds?: string[];
  claudeHome?: string;
  lookbackMs: number;
  limit: number;
  now?: Date;
  sessions?: DiscoveredClaudeCodeSession[];
}

export interface SyncClaudeCodeSessionsResult {
  checkedSessions: number;
  createdThreads: number;
  skippedExisting: number;
  skippedOld: number;
  skippedEntrypoint: number;
  skippedUnavailable: boolean;
}

interface ParsedClaudeRecord {
  cwd?: unknown;
  entrypoint?: unknown;
  message?: {
    role?: unknown;
    content?: unknown;
  };
  sessionId?: unknown;
  timestamp?: unknown;
  type?: unknown;
}

function defaultClaudeProjectsRoot(claudeHome = path.join(os.homedir(), ".claude")): string {
  return path.join(claudeHome, "projects");
}

function sanitizeChannelName(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[`"'’“”]/g, "")
    .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized.slice(0, MAX_CHANNEL_NAME_LENGTH) || "claude-code-session";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content.trim() || null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }

      return null;
    })
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n")
    .trim();

  return text || null;
}

function newerIsoTimestamp(current: string | null, next: unknown): string | null {
  const nextText = asString(next);

  if (!nextText) {
    return current;
  }

  const nextTime = Date.parse(nextText);

  if (!Number.isFinite(nextTime)) {
    return current;
  }

  if (!current || nextTime > Date.parse(current)) {
    return new Date(nextTime).toISOString();
  }

  return current;
}

async function parseClaudeCodeSessionFile(filePath: string, fallbackUpdatedAt: string): Promise<DiscoveredClaudeCodeSession | null> {
  const fallbackId = path.basename(filePath, ".jsonl");
  let sessionId: string | null = fallbackId || null;
  let cwd: string | null = null;
  let entrypoint: string | null = null;
  let firstUserMessage: string | null = null;
  let updatedAt: string | null = null;
  const raw = await readFile(filePath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let record: ParsedClaudeRecord;
    try {
      record = JSON.parse(line) as ParsedClaudeRecord;
    } catch {
      continue;
    }

    sessionId = asString(record.sessionId) ?? sessionId;
    cwd = asString(record.cwd) ?? cwd;
    entrypoint = asString(record.entrypoint) ?? entrypoint;
    updatedAt = newerIsoTimestamp(updatedAt, record.timestamp);

    const role = asString(record.message?.role);
    const type = asString(record.type);
    if (!firstUserMessage && (role === "user" || type === "user")) {
      firstUserMessage = textFromContent(record.message?.content);
    }
  }

  if (!sessionId || !cwd) {
    return null;
  }

  return {
    id: sessionId,
    cwd,
    entrypoint,
    firstUserMessage,
    updatedAt: updatedAt ?? fallbackUpdatedAt,
    filePath,
  };
}

export async function discoverClaudeCodeSessions(
  input: DiscoverClaudeCodeSessionsInput = {},
): Promise<DiscoveredClaudeCodeSession[]> {
  const projectsRoot = input.projectsRoot ?? defaultClaudeProjectsRoot(input.claudeHome);
  const updatedAfterTime = input.updatedAfter ? input.updatedAfter.getTime() : null;
  const excludedSessionIds = new Set(
    [...(input.excludeSessionIds ?? [])].map((sessionId) => sessionId.trim()).filter(Boolean),
  );
  const projectDirs = await readdir(projectsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  });
  const sessions: DiscoveredClaudeCodeSession[] = [];

  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) {
      continue;
    }

    const projectPath = path.join(projectsRoot, projectDir.name);
    const files = await readdir(projectPath, { withFileTypes: true }).catch(() => []);

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) {
        continue;
      }

      const fileSessionId = path.basename(file.name, ".jsonl");
      if (excludedSessionIds.has(fileSessionId)) {
        continue;
      }

      const filePath = path.join(projectPath, file.name);
      const fileStats = await stat(filePath);

      if (updatedAfterTime !== null && fileStats.mtimeMs < updatedAfterTime) {
        continue;
      }

      const session = await parseClaudeCodeSessionFile(filePath, fileStats.mtime.toISOString());

      if (session) {
        sessions.push(session);
      }
    }
  }

  return sessions.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function isExternallyStartedClaudeCodeSession(session: Pick<DiscoveredClaudeCodeSession, "entrypoint">): boolean {
  const entrypoint = session.entrypoint?.trim().toLowerCase();

  return Boolean(entrypoint && entrypoint !== "sdk-cli");
}

function claudeThreadName(session: DiscoveredClaudeCodeSession): string {
  const title = session.firstUserMessage?.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();

  return sanitizeDiscordThreadName(title ?? `Claude Code ${path.basename(session.cwd)}`, `Claude Code ${session.id.slice(0, 8)}`);
}

function claudeSessionTopic(session: DiscoveredClaudeCodeSession): string {
  return [
    `Claude Code session: ${session.id}`,
    `Workspace: ${session.cwd}`,
    session.entrypoint ? `Entrypoint: ${session.entrypoint}` : null,
    `Updated: ${session.updatedAt}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function claudeSessionContextMessage(input: {
  session: DiscoveredClaudeCodeSession;
  computerDisplayName: string;
  threadName: string;
}): string {
  return [
    "**Claude Code 세션 연결됨**",
    `세션: \`${input.threadName.replace(/`/g, "'")}\``,
    `위치: \`${input.session.cwd.replace(/`/g, "'")}\``,
    `업데이트: \`${input.session.updatedAt.replace(/`/g, "'")}\``,
    `Claude session: \`${input.session.id.replace(/`/g, "'")}\``,
    input.session.entrypoint ? `Entrypoint: \`${input.session.entrypoint.replace(/`/g, "'")}\`` : null,
    "",
    `이 스레드에 메시지를 보내면 ${input.computerDisplayName}의 같은 Claude Code 세션으로 이어집니다.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function knownClaudeSessionIds(state: DirectSyncState): Set<string> {
  return new Set(
    state.sessionChannels
      .map((channel) => channel.claudeSessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId?.trim()))
      .map((sessionId) => sessionId.trim()),
  );
}

export async function syncClaudeCodeSessionsToDiscord(
  input: SyncClaudeCodeSessionsInput,
): Promise<SyncClaudeCodeSessionsResult> {
  const result: SyncClaudeCodeSessionsResult = {
    checkedSessions: 0,
    createdThreads: 0,
    skippedExisting: 0,
    skippedOld: 0,
    skippedEntrypoint: 0,
    skippedUnavailable: false,
  };

  if (!input.guild.createThread) {
    return { ...result, skippedUnavailable: true };
  }

  const now = input.now ?? new Date();
  const lookbackMs = Math.max(0, input.lookbackMs);
  const updatedAfter = lookbackMs > 0 ? new Date(now.getTime() - lookbackMs) : null;
  const state = await input.stateStore.read();
  const existingClaudeSessionIds = knownClaudeSessionIds(state);
  const discoveredSessions =
    input.sessions ??
    (await discoverClaudeCodeSessions({
      claudeHome: input.claudeHome,
      updatedAfter,
      excludeSessionIds: existingClaudeSessionIds,
    }));
  const selectedSessions = discoveredSessions
    .filter((session) => {
      result.checkedSessions += 1;

      if (updatedAfter && Date.parse(session.updatedAt) < updatedAfter.getTime()) {
        result.skippedOld += 1;
        return false;
      }

      if (!isExternallyStartedClaudeCodeSession(session)) {
        result.skippedEntrypoint += 1;
        return false;
      }

      return true;
    })
    .slice(0, Math.max(0, input.limit));

  if (selectedSessions.length === 0) {
    return result;
  }

  for (const session of selectedSessions) {
    if (existingClaudeSessionIds.has(session.id)) {
      result.skippedExisting += 1;
      continue;
    }

    const threadName = claudeThreadName(session);
    const thread = await input.guild.createThread({
      name: threadName,
      parentChannelId: input.parentChannelId,
      autoArchiveDuration: 10_080,
      reason: claudeSessionTopic(session),
    });
    const sessionWorkspaceId = workspaceId(input.computerId, session.cwd);
    const channel: SyncedSessionChannelState = {
      codexSessionId: null,
      claudeSessionId: session.id,
      threadName,
      updatedAt: session.updatedAt,
      cwd: session.cwd,
      workspaceRoot: session.cwd,
      workspaceDisplayName: workspaceDisplayName(session.cwd),
      discordCategoryId: null,
      discordChannelId: thread.id,
      discordParentChannelId: input.parentChannelId,
      discordDeliveryMode: "thread",
      channelMode: "claude-code",
      channelName: sanitizeChannelName(threadName),
      computerId: input.computerId,
      workspaceId: sessionWorkspaceId,
      contextPostedAt: new Date().toISOString(),
    };

    await input.controlApi.createManagedChannel({
      id: `channel:${thread.id}`,
      discordChannelId: thread.id,
      computerId: input.computerId,
      workspaceId: sessionWorkspaceId,
      channelMode: "claude-code",
    });

    state.sessionChannels.push(channel);
    existingClaudeSessionIds.add(session.id);
    await input.stateStore.write(state);
    result.createdThreads += 1;

    if (input.guild.sendTextMessage) {
      const mentionRoleIds = input.mentionRoleIds?.filter((roleId) => roleId.trim().length > 0);
      await input.guild.sendTextMessage(
        thread.id,
        claudeSessionContextMessage({
          session,
          computerDisplayName: input.computerDisplayName,
          threadName,
        }),
        mentionRoleIds && mentionRoleIds.length > 0 ? { mentionRoleIds } : undefined,
      );
    }
  }

  return result;
}
