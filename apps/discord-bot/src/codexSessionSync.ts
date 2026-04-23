import path from "node:path";
import type { SessionOrigin } from "@codex-discord/core";
import type { DiscoveredCodexSession } from "../../../packages/codex-adapter/src/index.js";
import type { ControlApiClient } from "./controlApiClient.js";
import type {
  DirectSyncState,
  DirectSyncStateStore,
  SyncedSessionChannelState,
  SyncedWorkspaceState,
} from "./directState.js";

export interface DiscordGuildSurface {
  createCategory(input: { name: string }): Promise<{ id: string }>;
  createTextChannel(input: { name: string; parentId: string; topic?: string }): Promise<{ id: string }>;
  deleteChannel?(id: string): Promise<void>;
  deleteCategory?(id: string): Promise<void>;
}

export interface SyncCodexSessionsInput {
  guild: DiscordGuildSurface;
  controlApi: Pick<ControlApiClient, "createCategoryMapping" | "createManagedChannel" | "linkCodexSession">;
  stateStore: DirectSyncStateStore;
  computerId: string;
  computerDisplayName: string;
  defaultWorkspaceRoot: string;
  sessions: DiscoveredCodexSession[];
  limit: number;
}

export interface SyncCodexSessionsResult {
  createdCategories: number;
  existingCategories: number;
  createdChannels: number;
  existingChannels: number;
  skippedSessions: number;
}

function sanitizeName(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[`"'’“”]/g, "")
    .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized.slice(0, 90) || "codex-session";
}

function workspaceDisplayName(workspaceRoot: string): string {
  return path.basename(workspaceRoot) || workspaceRoot;
}

function workspaceId(computerId: string, workspaceRoot: string): string {
  return `${computerId}:${workspaceRoot}`;
}

function sessionChannelName(session: DiscoveredCodexSession): string {
  return sanitizeName(session.threadName);
}

function sessionTopic(session: DiscoveredCodexSession, workspaceRoot: string): string {
  return [
    `Codex session: ${session.id}`,
    `Workspace: ${workspaceRoot}`,
    `Updated: ${session.updatedAt}`,
  ].join("\n");
}

async function ensureWorkspaceCategory(input: {
  guild: DiscordGuildSurface;
  controlApi: SyncCodexSessionsInput["controlApi"];
  state: DirectSyncState;
  computerId: string;
  workspaceRoot: string;
}): Promise<{ workspace: SyncedWorkspaceState; created: boolean }> {
  const existingWorkspace = input.state.workspaces.find(
    (workspace) => workspace.workspaceRoot === input.workspaceRoot,
  );

  if (existingWorkspace) {
    return { workspace: existingWorkspace, created: false };
  }

  const displayName = workspaceDisplayName(input.workspaceRoot);
  const category = await input.guild.createCategory({ name: displayName });
  const nextWorkspace = {
    workspaceRoot: input.workspaceRoot,
    workspaceDisplayName: displayName,
    discordCategoryId: category.id,
    computerId: input.computerId,
    workspaceId: workspaceId(input.computerId, input.workspaceRoot),
  };

  await input.controlApi.createCategoryMapping({
    id: `category:${category.id}`,
    discordCategoryId: category.id,
    computerId: input.computerId,
    workspaceId: nextWorkspace.workspaceId,
  });
  input.state.workspaces.push(nextWorkspace);

  return { workspace: nextWorkspace, created: true };
}

async function createSessionChannel(input: {
  guild: DiscordGuildSurface;
  controlApi: SyncCodexSessionsInput["controlApi"];
  state: DirectSyncState;
  computerId: string;
  session: DiscoveredCodexSession;
  workspace: SyncedWorkspaceState;
}): Promise<SyncedSessionChannelState> {
  const channelName = sessionChannelName(input.session);
  const channel = await input.guild.createTextChannel({
    name: channelName,
    parentId: input.workspace.discordCategoryId,
    topic: sessionTopic(input.session, input.workspace.workspaceRoot),
  });
  const nextChannel = {
    codexSessionId: input.session.id,
    threadName: input.session.threadName,
    updatedAt: input.session.updatedAt,
    cwd: input.session.cwdHint ?? input.workspace.workspaceRoot,
    workspaceRoot: input.workspace.workspaceRoot,
    workspaceDisplayName: input.workspace.workspaceDisplayName,
    discordCategoryId: input.workspace.discordCategoryId,
    discordChannelId: channel.id,
    channelName,
    computerId: input.computerId,
    workspaceId: input.workspace.workspaceId,
  };
  const origin: SessionOrigin = "imported_native";

  await input.controlApi.createManagedChannel({
    id: `channel:${channel.id}`,
    discordChannelId: channel.id,
    computerId: input.computerId,
    workspaceId: input.workspace.workspaceId,
    channelMode: "session-linked",
  });
  await input.controlApi.linkCodexSession({
    discordChannelId: channel.id,
    id: `session-link:${channel.id}:${input.session.id}`,
    codexSessionId: input.session.id,
    origin,
    threadNameSnapshot: input.session.threadName,
  });
  input.state.sessionChannels.push(nextChannel);

  return nextChannel;
}

export async function syncCodexSessionsToDiscord(
  input: SyncCodexSessionsInput,
): Promise<SyncCodexSessionsResult> {
  const state = await input.stateStore.read();
  const initialWorkspaceRoots = new Set(state.workspaces.map((workspace) => workspace.workspaceRoot));
  const selectedSessions = input.sessions.slice(0, input.limit);
  const result: SyncCodexSessionsResult = {
    createdCategories: 0,
    existingCategories: 0,
    createdChannels: 0,
    existingChannels: 0,
    skippedSessions: Math.max(0, input.sessions.length - selectedSessions.length),
  };

  for (const session of selectedSessions) {
    const workspaceRoot = session.cwdHint ?? input.defaultWorkspaceRoot;
    const category = await ensureWorkspaceCategory({
      guild: input.guild,
      controlApi: input.controlApi,
      state,
      computerId: input.computerId,
      workspaceRoot,
    });

    if (category.created) {
      result.createdCategories += 1;
      initialWorkspaceRoots.delete(category.workspace.workspaceRoot);
    } else if (initialWorkspaceRoots.has(category.workspace.workspaceRoot)) {
      result.existingCategories += 1;
      initialWorkspaceRoots.delete(category.workspace.workspaceRoot);
    }

    if (state.sessionChannels.some((channel) => channel.codexSessionId === session.id)) {
      result.existingChannels += 1;
      continue;
    }

    await createSessionChannel({
      guild: input.guild,
      controlApi: input.controlApi,
      state,
      computerId: input.computerId,
      session,
      workspace: category.workspace,
    });
    result.createdChannels += 1;
  }

  await input.stateStore.write(state);
  return result;
}
