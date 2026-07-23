import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";
import type { ChannelMode, SessionOrigin } from "../../../packages/core/src/index.js";
import type { ControlApiClient } from "./controlApiClient.js";
import type {
  DiscordSessionDeliveryMode,
  DirectSyncState,
  DirectSyncStateStore,
  SyncedSessionChannelState,
  SyncedWorkspaceState,
} from "./directState.js";
import { sanitizeDiscordThreadName, type DiscordGuildSurface } from "./codexSessionSync.js";

export interface CreateNewCodexChatInput {
  guild: DiscordGuildSurface;
  controlApi: Pick<ControlApiClient, "createCategoryMapping" | "createManagedChannel" | "linkCodexSession">;
  stateStore: DirectSyncStateStore;
  computerId: string;
  computerDisplayName: string;
  defaultWorkspaceRoot: string;
  currentCwd?: string | null;
  generalChatsRoot?: string;
  now?: Date;
  name?: string | null;
  cwd?: string | null;
  useCategory: boolean;
  initialPrompt?: string | null;
  sessionThreadParentChannelId?: string | null;
  channelMode?: Extract<ChannelMode, "session-linked" | "claude-code">;
}

export interface NewCodexChatResult {
  discordChannelId: string;
  discordCategoryId: string | null;
  channelName: string;
  threadName: string;
  cwd: string;
  workspaceRoot: string;
  workspaceDisplayName: string;
  pendingSession: boolean;
  initialPrompt: string | null;
  discordDeliveryMode: DiscordSessionDeliveryMode;
  channelMode: Extract<ChannelMode, "session-linked" | "claude-code">;
}

export interface ForkDiscordSessionThreadInput {
  guild: DiscordGuildSurface;
  controlApi: Pick<ControlApiClient, "createManagedChannel">;
  stateStore: DirectSyncStateStore;
  sourceDiscordChannelId: string;
  sourceSessionId: string;
  name: string;
  now?: Date;
}

export const CONNECTOR_MAINTENANCE_THREAD_NAME = "디스코드봇업데이트";

export interface EnsureConnectorMaintenanceThreadInput {
  guild: DiscordGuildSurface;
  controlApi: Pick<ControlApiClient, "createManagedChannel">;
  stateStore: DirectSyncStateStore;
  computerId: string;
  defaultWorkspaceRoot: string;
  preferredAgent: "codex" | "claude";
  codexParentChannelId: string;
  claudeParentChannelId?: string | null;
}

export interface ConnectorMaintenanceThreadResult {
  agent: "codex" | "claude";
  channelId: string;
  parentChannelId: string;
  created: boolean;
}

function sanitizeName(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[`"'’“”]/g, "")
    .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized.slice(0, 90) || "codex-chat";
}

function workspaceDisplayName(workspaceRoot: string): string {
  return path.basename(workspaceRoot) || workspaceRoot;
}

function workspaceId(computerId: string, workspaceRoot: string): string {
  return `${computerId}:${workspaceRoot}`;
}

async function registerMaintenanceThread(input: {
  controlApi: EnsureConnectorMaintenanceThreadInput["controlApi"];
  stateStore: DirectSyncStateStore;
  computerId: string;
  workspaceRoot: string;
  channelId: string;
  parentChannelId: string;
  channelMode: Extract<ChannelMode, "session-linked" | "claude-code">;
}): Promise<void> {
  const displayName = workspaceDisplayName(input.workspaceRoot);
  const nextChannel: SyncedSessionChannelState = {
    codexSessionId: null,
    threadName: CONNECTOR_MAINTENANCE_THREAD_NAME,
    updatedAt: new Date().toISOString(),
    cwd: input.workspaceRoot,
    workspaceRoot: input.workspaceRoot,
    workspaceDisplayName: displayName,
    discordCategoryId: null,
    discordChannelId: input.channelId,
    discordParentChannelId: input.parentChannelId,
    discordDeliveryMode: "thread",
    channelPurpose: "maintenance",
    channelMode: input.channelMode,
    channelName: sanitizeName(CONNECTOR_MAINTENANCE_THREAD_NAME),
    computerId: input.computerId,
    workspaceId: workspaceId(input.computerId, input.workspaceRoot),
  };

  await input.controlApi.createManagedChannel({
    id: `channel:${input.channelId}`,
    discordChannelId: input.channelId,
    computerId: input.computerId,
    workspaceId: nextChannel.workspaceId,
    channelMode: input.channelMode,
  });
  await input.stateStore.update((state) => ({
    ...state,
    sessionChannels: [
      ...state.sessionChannels.filter(
        (candidate) =>
          candidate.discordChannelId !== input.channelId &&
          !(
            candidate.channelPurpose === "maintenance" &&
            candidate.discordParentChannelId === input.parentChannelId &&
            candidate.channelMode === input.channelMode
          ),
      ),
      nextChannel,
    ],
  }));
}

export async function ensureConnectorMaintenanceThread(
  input: EnsureConnectorMaintenanceThreadInput,
): Promise<ConnectorMaintenanceThreadResult> {
  if (!input.guild.createThread) {
    throw new Error("Discord guild surface cannot create maintenance threads.");
  }

  const useClaude = input.preferredAgent === "claude" && Boolean(input.claudeParentChannelId?.trim());
  const agent = useClaude ? "claude" : "codex";
  const channelMode = useClaude ? "claude-code" : "session-linked";
  const parentChannelId = useClaude
    ? input.claudeParentChannelId!.trim()
    : input.codexParentChannelId.trim();
  const state = await input.stateStore.read();
  const existing = state.sessionChannels.find(
    (channel) =>
      channel.discordDeliveryMode === "thread" &&
      channel.discordParentChannelId === parentChannelId &&
      channel.channelMode === channelMode &&
      (channel.channelPurpose === "maintenance" ||
        channel.threadName === CONNECTOR_MAINTENANCE_THREAD_NAME),
  );

  if (existing) {
    const available = input.guild.ensureChannelAvailable
      ? await input.guild.ensureChannelAvailable(existing.discordChannelId)
      : true;
    if (available) {
      if (existing.channelPurpose !== "maintenance") {
        await input.stateStore.update((latestState) => ({
          ...latestState,
          sessionChannels: latestState.sessionChannels.map((channel) =>
            channel.discordChannelId === existing.discordChannelId
              ? { ...channel, channelPurpose: "maintenance" }
              : channel,
          ),
        }));
      }
      return {
        agent,
        channelId: existing.discordChannelId,
        parentChannelId,
        created: false,
      };
    }
    await input.stateStore.update((latestState) => ({
      ...latestState,
      sessionChannels: latestState.sessionChannels.filter(
        (channel) => channel.discordChannelId !== existing.discordChannelId,
      ),
    }));
  }

  const discovered = await input.guild.findThreadByName?.({
    name: CONNECTOR_MAINTENANCE_THREAD_NAME,
    parentChannelId,
  });
  if (discovered) {
    await registerMaintenanceThread({
      controlApi: input.controlApi,
      stateStore: input.stateStore,
      computerId: input.computerId,
      workspaceRoot: input.defaultWorkspaceRoot,
      channelId: discovered.id,
      parentChannelId,
      channelMode,
    });
    return {
      agent,
      channelId: discovered.id,
      parentChannelId,
      created: false,
    };
  }

  const created = await input.guild.createThread({
    name: CONNECTOR_MAINTENANCE_THREAD_NAME,
    parentChannelId,
    autoArchiveDuration: 10_080,
    reason: "AI Agent Discord Connector release maintenance",
  });
  await registerMaintenanceThread({
    controlApi: input.controlApi,
    stateStore: input.stateStore,
    computerId: input.computerId,
    workspaceRoot: input.defaultWorkspaceRoot,
    channelId: created.id,
    parentChannelId,
    channelMode,
  });

  return {
    agent,
    channelId: created.id,
    parentChannelId,
    created: true,
  };
}

function defaultGeneralChatsRoot(): string {
  return path.resolve(process.env.CODEX_GENERAL_CHATS_ROOT ?? path.join(os.homedir(), "Documents", "Codex"));
}

function dateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

async function createGeneralChatWorkspace(input: {
  root?: string;
  name?: string | null;
  now?: Date;
}): Promise<string> {
  const root = path.resolve(input.root ?? defaultGeneralChatsRoot());
  const slug = sanitizeName(input.name?.trim() || "new-chat");
  const baseName = `${dateStamp(input.now ?? new Date())}-${slug}`;

  await mkdir(root, { recursive: true });

  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = path.join(root, `${baseName}${suffix}`);

    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Could not allocate a general Codex chat folder under ${root}`);
}

function resolveRequestedCwd(defaultWorkspaceRoot: string, requestedCwd?: string | null, currentCwd?: string | null): string {
  const normalizedCwd = requestedCwd?.trim();

  if (!normalizedCwd) {
    return path.resolve(defaultWorkspaceRoot);
  }

  if (normalizedCwd.startsWith("~")) {
    return path.resolve(normalizedCwd.replace(/^~/, os.homedir()));
  }

  return path.isAbsolute(normalizedCwd)
    ? path.resolve(normalizedCwd)
    : path.resolve(currentCwd?.trim() || defaultWorkspaceRoot, normalizedCwd);
}

function newChatTopic(input: {
  channelMode: Extract<ChannelMode, "session-linked" | "claude-code">;
  cwd: string;
  workspaceRoot: string;
  pendingSession: boolean;
  initialPrompt: string | null;
}): string {
  const agentLabel = input.channelMode === "claude-code" ? "Claude Code" : "Codex";

  return [
    `${agentLabel} session: ${input.pendingSession ? "pending" : "new"}`,
    `Workspace: ${input.workspaceRoot}`,
    `Working directory: ${input.cwd}`,
    input.initialPrompt ? "Initial prompt: queued by chat-new command" : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

async function ensureWorkspaceCategory(input: {
  guild: DiscordGuildSurface;
  controlApi: CreateNewCodexChatInput["controlApi"];
  state: DirectSyncState;
  computerId: string;
  workspaceRoot: string;
}): Promise<SyncedWorkspaceState> {
  const existingWorkspace = input.state.workspaces.find(
    (workspace) => workspace.workspaceRoot === input.workspaceRoot,
  );

  if (existingWorkspace) {
    return existingWorkspace;
  }

  const displayName = workspaceDisplayName(input.workspaceRoot);
  const category = await input.guild.createCategory({ name: displayName });
  const nextWorkspace: SyncedWorkspaceState = {
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

  return nextWorkspace;
}

function isMissingCategoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("CHANNEL_PARENT_INVALID") || message.includes("Category does not exist");
}

async function recreateWorkspaceCategory(input: {
  guild: DiscordGuildSurface;
  controlApi: CreateNewCodexChatInput["controlApi"];
  workspace: SyncedWorkspaceState;
}): Promise<SyncedWorkspaceState> {
  const category = await input.guild.createCategory({ name: input.workspace.workspaceDisplayName });
  input.workspace.discordCategoryId = category.id;

  await input.controlApi.createCategoryMapping({
    id: `category:${category.id}`,
    discordCategoryId: category.id,
    computerId: input.workspace.computerId,
    workspaceId: input.workspace.workspaceId,
  });

  return input.workspace;
}

export async function createNewCodexChatChannel(
  input: CreateNewCodexChatInput,
): Promise<NewCodexChatResult> {
  const state = await input.stateStore.read();
  const channelMode = input.channelMode ?? "session-linked";
  const categorized = input.useCategory || Boolean(input.cwd?.trim());
  const cwd = categorized
    ? resolveRequestedCwd(input.defaultWorkspaceRoot, input.cwd, input.currentCwd)
    : await createGeneralChatWorkspace({
        root: input.generalChatsRoot,
        name: input.name,
        now: input.now,
      });
  const workspaceRoot = cwd;
  const workspace = categorized
    ? await ensureWorkspaceCategory({
        guild: input.guild,
        controlApi: input.controlApi,
        state,
        computerId: input.computerId,
        workspaceRoot,
      })
    : null;
  const displayName = workspace?.workspaceDisplayName ?? "General Chat";
  const threadName = input.name?.trim() || (categorized ? `New chat: ${displayName}` : "General Codex chat");
  const channelName = sanitizeName(input.name?.trim() || (categorized ? threadName : "general-codex-chat"));
  const discordThreadName = sanitizeDiscordThreadName(threadName, channelName);
  const prompt = input.initialPrompt?.trim() || null;
  const channelInput = {
    name: channelName,
    parentId: workspace?.discordCategoryId ?? null,
    topic: newChatTopic({
      channelMode,
      cwd,
      workspaceRoot,
      pendingSession: true,
      initialPrompt: prompt,
    }),
  };
  const threadParentChannelId = input.sessionThreadParentChannelId?.trim() || null;
  const shouldCreateThread = Boolean(threadParentChannelId && input.guild.createThread);
  let channel: { id: string };

  try {
    channel =
      shouldCreateThread && input.guild.createThread && threadParentChannelId
        ? await input.guild.createThread({
            name: discordThreadName,
            parentChannelId: threadParentChannelId,
            autoArchiveDuration: 10_080,
            reason: channelInput.topic,
          })
        : await input.guild.createTextChannel(channelInput);
  } catch (error) {
    if (shouldCreateThread || !workspace || !isMissingCategoryError(error)) {
      throw error;
    }

    const recreatedWorkspace = await recreateWorkspaceCategory({
      guild: input.guild,
      controlApi: input.controlApi,
      workspace,
    });
    channel = await input.guild.createTextChannel({
      ...channelInput,
      parentId: recreatedWorkspace.discordCategoryId,
    });
  }
  const nextChannel: SyncedSessionChannelState = {
    codexSessionId: null,
    threadName,
    updatedAt: new Date().toISOString(),
    cwd,
    workspaceRoot,
    workspaceDisplayName: displayName,
    discordCategoryId: workspace?.discordCategoryId ?? null,
    discordChannelId: channel.id,
    discordParentChannelId: shouldCreateThread ? threadParentChannelId : (workspace?.discordCategoryId ?? null),
    discordDeliveryMode: shouldCreateThread ? "thread" : "channel",
    channelMode,
    channelName,
    computerId: input.computerId,
    workspaceId: workspace?.workspaceId ?? workspaceId(input.computerId, workspaceRoot),
  };

  await input.controlApi.createManagedChannel({
    id: `channel:${channel.id}`,
    discordChannelId: channel.id,
    computerId: input.computerId,
    workspaceId: nextChannel.workspaceId,
    channelMode,
  });
  await input.stateStore.update((latestState) => ({
    ...latestState,
    workspaces: workspace
      ? [
          ...latestState.workspaces.filter(
            (candidate) => candidate.workspaceRoot !== workspace.workspaceRoot,
          ),
          workspace,
        ]
      : latestState.workspaces,
    sessionChannels: [
      ...latestState.sessionChannels.filter(
        (candidate) => candidate.discordChannelId !== nextChannel.discordChannelId,
      ),
      nextChannel,
    ],
  }));

  return {
    discordChannelId: channel.id,
    discordCategoryId: nextChannel.discordCategoryId,
    channelName,
    threadName,
    cwd,
    workspaceRoot,
    workspaceDisplayName: displayName,
    pendingSession: true,
    initialPrompt: prompt,
    discordDeliveryMode: nextChannel.discordDeliveryMode ?? "channel",
    channelMode,
  };
}

export async function createForkedDiscordSessionThread(
  input: ForkDiscordSessionThreadInput,
): Promise<NewCodexChatResult> {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Fork thread name is required.");
  }

  if (!input.guild.createThread) {
    throw new Error("Discord guild surface cannot create threads.");
  }

  const state = await input.stateStore.read();
  const sourceChannel = state.sessionChannels.find(
    (channel) => channel.discordChannelId === input.sourceDiscordChannelId,
  );

  if (!sourceChannel) {
    throw new Error("현재 Discord 스레드의 세션 상태를 찾을 수 없습니다.");
  }

  const channelMode = sourceChannel.channelMode === "claude-code" ? "claude-code" : "session-linked";
  const sourceSessionId = input.sourceSessionId.trim();
  const persistedSourceSessionId = channelMode === "claude-code"
    ? sourceChannel.claudeSessionId?.trim() || null
    : sourceChannel.codexSessionId?.trim() || null;

  if (!sourceSessionId) {
    throw new Error("Fork source session ID is required.");
  }

  if (persistedSourceSessionId && persistedSourceSessionId.toLowerCase() !== sourceSessionId.toLowerCase()) {
    throw new Error("Discord source thread session changed while the fork was being prepared.");
  }

  const parentChannelId = sourceChannel.discordParentChannelId?.trim();

  if (!parentChannelId || sourceChannel.discordDeliveryMode !== "thread") {
    throw new Error("Fork는 세션별 Discord thread 안에서만 사용할 수 있습니다.");
  }

  const channelName = sanitizeName(name);
  const discordThreadName = sanitizeDiscordThreadName(name, channelName);
  const thread = await input.guild.createThread({
    name: discordThreadName,
    parentChannelId,
    autoArchiveDuration: 10_080,
    reason: [
      `${channelMode === "claude-code" ? "Claude Code" : "Codex"} session fork`,
      `Source thread: ${sourceChannel.threadName}`,
      `Workspace: ${sourceChannel.workspaceRoot}`,
      `Working directory: ${sourceChannel.cwd}`,
    ].join("\n"),
  });
  const nextChannel: SyncedSessionChannelState = {
    codexSessionId: null,
    threadName: name,
    updatedAt: (input.now ?? new Date()).toISOString(),
    cwd: sourceChannel.cwd,
    workspaceRoot: sourceChannel.workspaceRoot,
    workspaceDisplayName: sourceChannel.workspaceDisplayName,
    discordCategoryId: sourceChannel.discordCategoryId ?? null,
    discordChannelId: thread.id,
    discordParentChannelId: parentChannelId,
    discordDeliveryMode: "thread",
    channelMode,
    agentModelOverride: sourceChannel.agentModelOverride ?? null,
    agentEffortOverride: sourceChannel.agentEffortOverride ?? null,
    pendingForkSourceDiscordChannelId: input.sourceDiscordChannelId,
    pendingForkSourceSessionId: sourceSessionId,
    channelName,
    computerId: sourceChannel.computerId,
    workspaceId: sourceChannel.workspaceId,
  };

  await input.controlApi.createManagedChannel({
    id: `channel:${thread.id}`,
    discordChannelId: thread.id,
    computerId: nextChannel.computerId,
    workspaceId: nextChannel.workspaceId,
    channelMode,
  });

  try {
    await input.stateStore.update((latestState) => {
      const latestSourceChannel = latestState.sessionChannels.find(
        (candidate) => candidate.discordChannelId === input.sourceDiscordChannelId,
      );
      const latestSourceSessionId = channelMode === "claude-code"
        ? latestSourceChannel?.claudeSessionId?.trim() || null
        : latestSourceChannel?.codexSessionId?.trim() || null;

      if (!latestSourceChannel) {
        throw new Error("Fork source Discord thread disappeared while the fork was being prepared.");
      }

      if (latestSourceSessionId && latestSourceSessionId.toLowerCase() !== sourceSessionId.toLowerCase()) {
        throw new Error("Discord source thread session changed while the fork was being prepared.");
      }

      return {
        ...latestState,
        sessionChannels: [
          ...latestState.sessionChannels.filter(
            (candidate) => candidate.discordChannelId !== nextChannel.discordChannelId,
          ),
          nextChannel,
        ],
      };
    });
  } catch (error) {
    if (input.guild.deleteChannel) {
      await input.guild.deleteChannel(thread.id).catch(() => undefined);
    }
    throw error;
  }

  return {
    discordChannelId: thread.id,
    discordCategoryId: nextChannel.discordCategoryId,
    channelName,
    threadName: name,
    cwd: nextChannel.cwd,
    workspaceRoot: nextChannel.workspaceRoot,
    workspaceDisplayName: nextChannel.workspaceDisplayName,
    pendingSession: true,
    initialPrompt: null,
    discordDeliveryMode: "thread",
    channelMode,
  };
}

export async function discardPendingDiscordSessionThread(input: {
  guild: Pick<DiscordGuildSurface, "deleteChannel">;
  stateStore: DirectSyncStateStore;
  discordChannelId: string;
}): Promise<boolean> {
  const removed = await input.stateStore.removePendingSessionChannel(input.discordChannelId);

  if (removed && input.guild.deleteChannel) {
    await input.guild.deleteChannel(input.discordChannelId);
  }

  return removed;
}

export async function linkPendingNewCodexChatSession(input: {
  controlApi: Pick<ControlApiClient, "linkCodexSession">;
  stateStore: DirectSyncStateStore;
  discordChannelId: string;
  codexSessionId: string;
  threadName: string;
}): Promise<void> {
  const origin: SessionOrigin = "managed_new";

  await input.controlApi.linkCodexSession({
    discordChannelId: input.discordChannelId,
    id: `session-link:${input.discordChannelId}:${input.codexSessionId}`,
    codexSessionId: input.codexSessionId,
    origin,
    threadNameSnapshot: input.threadName,
  });
  await input.stateStore.updateSessionChannelCodexSession(
    input.discordChannelId,
    input.codexSessionId,
    input.threadName,
  );
}
