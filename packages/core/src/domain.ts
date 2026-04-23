export type ChannelMode = "shell-admin" | "session-linked";
export type ChannelStatus = "created" | "attached" | "active" | "archived" | "detached";
export type SessionOrigin = "managed_new" | "imported_native";
export type AvailabilityStatus = "available" | "unavailable";

export interface ManagedChannel {
  channelId: string;
  workspaceId: string;
  computerId: string;
  channelMode: ChannelMode;
  cwd: string;
  status: ChannelStatus;
  currentSessionLinkId: string | null;
}

export interface CodexSessionLink {
  sessionLinkId: string;
  channelId: string;
  codexSessionId: string;
  origin: SessionOrigin;
  threadNameSnapshot: string;
  attachedAt: string;
  availabilityStatus: AvailabilityStatus;
}

export interface CreateManagedChannelInput {
  channelId: string;
  workspaceId: string;
  computerId: string;
  workspaceRoot: string;
  mode: ChannelMode;
}

export interface LinkCodexSessionInput {
  sessionLinkId: string;
  codexSessionId: string;
  origin: SessionOrigin;
  threadNameSnapshot: string;
  attachedAt: string;
}

export function createWorkspaceCategoryName(
  computerDisplayName: string,
  workspaceDisplayName: string,
): string {
  return `${computerDisplayName} / ${workspaceDisplayName}`;
}

export function createManagedChannel(input: CreateManagedChannelInput): ManagedChannel {
  return {
    channelId: input.channelId,
    workspaceId: input.workspaceId,
    computerId: input.computerId,
    channelMode: input.mode,
    cwd: input.workspaceRoot,
    status: "created",
    currentSessionLinkId: null,
  };
}

export function linkCodexSession(
  channel: ManagedChannel,
  input: LinkCodexSessionInput,
): { channel: ManagedChannel; link: CodexSessionLink } {
  const link: CodexSessionLink = {
    sessionLinkId: input.sessionLinkId,
    channelId: channel.channelId,
    codexSessionId: input.codexSessionId,
    origin: input.origin,
    threadNameSnapshot: input.threadNameSnapshot,
    attachedAt: input.attachedAt,
    availabilityStatus: "available",
  };

  return {
    channel: {
      ...channel,
      status: "attached",
      currentSessionLinkId: link.sessionLinkId,
    },
    link,
  };
}
