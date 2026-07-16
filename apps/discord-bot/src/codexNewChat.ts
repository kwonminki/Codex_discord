import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";
import type { SessionOrigin } from "../../../packages/core/src/index.js";
import type { ControlApiClient } from "./controlApiClient.js";
import type {
  DiscordSessionDeliveryMode,
  DirectSyncState,
  DirectSyncStateStore,
  SyncedSessionChannelState,
  SyncedWorkspaceState,
} from "./directState.js";
import type { DiscordGuildSurface } from "./codexSessionSync.js";

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
    return path.resolve(normalizedCwd.replace(/^~/, process.env.HOME ?? ""));
  }

  return path.isAbsolute(normalizedCwd)
    ? path.resolve(normalizedCwd)
    : path.resolve(currentCwd?.trim() || defaultWorkspaceRoot, normalizedCwd);
}

function newChatTopic(input: {
  cwd: string;
  workspaceRoot: string;
  pendingSession: boolean;
  initialPrompt: string | null;
}): string {
  return [
    `Codex session: ${input.pendingSession ? "pending" : "new"}`,
    `Workspace: ${input.workspaceRoot}`,
    `Working directory: ${input.cwd}`,
    input.initialPrompt ? "Initial prompt: queued by admin command" : null,
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
  const prompt = input.initialPrompt?.trim() || null;
  const channelInput = {
    name: channelName,
    parentId: workspace?.discordCategoryId ?? null,
    topic: newChatTopic({
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
            name: channelName,
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
    channelName,
    computerId: input.computerId,
    workspaceId: workspace?.workspaceId ?? workspaceId(input.computerId, workspaceRoot),
  };

  await input.controlApi.createManagedChannel({
    id: `channel:${channel.id}`,
    discordChannelId: channel.id,
    computerId: input.computerId,
    workspaceId: nextChannel.workspaceId,
    channelMode: "session-linked",
  });
  state.sessionChannels.push(nextChannel);
  await input.stateStore.write(state);

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
  };
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
