import type { ChannelMode, CommandTier, SessionOrigin } from "@codex-discord/core";
import type { ManagedDiscordChannelContext } from "./channelContext.js";

export interface RunCommandJobPayload {
  workspaceRoot: string;
  cwd: string;
  command: string;
  timeoutMs: number;
  confirmedDangerous: boolean;
}

export interface RunCodexPromptJobPayload {
  workspaceRoot: string;
  cwd: string;
  prompt: string;
  timeoutMs: number;
  sessionId: string | null;
}

export type ControlApiJobResponse =
  | { jobId: string; result: unknown }
  | { jobId: string; error: { message: string } };

export interface SubmitCommandJobInput {
  computerId: string;
  payload: RunCommandJobPayload;
}

export interface SubmitCodexPromptInput {
  computerId: string;
  payload: RunCodexPromptJobPayload;
}

export interface ListCodexSessionsInput {
  computerId: string;
  codexHome: string;
}

export interface WorkspaceInventoryItem {
  id: string;
  absolutePath: string;
  displayName: string;
  status: string;
}

export interface ComputerInventoryItem {
  id: string;
  displayName: string;
  hostname: string;
  status: string;
  allowedRoleIds: string[];
  capabilities: string[];
  workspaces: WorkspaceInventoryItem[];
}

export interface CreateCategoryMappingInput {
  id: string;
  discordCategoryId: string;
  computerId: string;
  workspaceId: string;
}

export interface CategoryMappingResponse {
  id: string;
  discordCategoryId: string;
  computerId: string;
  workspaceId: string;
  syncStatus: string;
}

export interface CreateManagedChannelInput {
  id: string;
  discordChannelId: string;
  computerId: string;
  workspaceId: string;
  channelMode: ChannelMode;
}

export interface UpdateChannelCwdInput {
  discordChannelId: string;
  cwd: string;
}

export interface RecordCommandAuditInput {
  discordChannelId: string;
  userId: string;
  cwd: string | null;
  rawCommand: string;
  tier: CommandTier;
  resultStatus: string;
}

export interface CommandAuditResponse {
  id: string;
  channelId: string | null;
  userId: string;
  targetComputerId: string;
  targetWorkspaceId: string | null;
  cwd: string | null;
  rawCommand: string;
  tier: string;
  resultStatus: string;
}

export interface LinkCodexSessionInput {
  discordChannelId: string;
  id: string;
  codexSessionId: string;
  origin: SessionOrigin;
  threadNameSnapshot: string;
}

export interface LinkedCodexSessionResponse {
  id: string;
  channelId: string;
  codexSessionId: string;
  origin: SessionOrigin;
  threadNameSnapshot: string;
  availabilityStatus: string;
}

export interface ManagedChannelResponse {
  id: string;
  discordChannelId: string;
  computerId: string;
  workspaceId: string;
  channelMode: ChannelMode;
  cwd: string;
  status: string;
}

export interface ControlApiClient {
  listInventory(): Promise<ComputerInventoryItem[]>;
  getChannelContext(discordChannelId: string): Promise<ManagedDiscordChannelContext | null>;
  createCategoryMapping(input: CreateCategoryMappingInput): Promise<CategoryMappingResponse>;
  createManagedChannel(input: CreateManagedChannelInput): Promise<ManagedChannelResponse>;
  updateChannelCwd(input: UpdateChannelCwdInput): Promise<{ cwd: string }>;
  recordCommandAudit(input: RecordCommandAuditInput): Promise<CommandAuditResponse>;
  linkCodexSession(input: LinkCodexSessionInput): Promise<LinkedCodexSessionResponse>;
  listCodexSessions(input: ListCodexSessionsInput): Promise<ControlApiJobResponse>;
  submitCodexPrompt(input: SubmitCodexPromptInput): Promise<ControlApiJobResponse>;
  submitCommandJob(input: SubmitCommandJobInput): Promise<ControlApiJobResponse>;
}

interface ControlApiErrorResponse {
  error?: { message?: string };
}

export function createControlApiClient(input: { baseUrl: string }): ControlApiClient {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");

  return {
    async listInventory() {
      const response = await fetch(`${baseUrl}/inventory`);
      const body = (await response.json()) as ComputerInventoryItem[] | ControlApiErrorResponse;

      if (!response.ok) {
        const errorBody = body as ControlApiErrorResponse;
        const message = errorBody.error?.message ?? "Control API inventory request failed";
        throw new Error(message);
      }

      return body as ComputerInventoryItem[];
    },
    async getChannelContext(discordChannelId) {
      const response = await fetch(
        `${baseUrl}/discord/channels/${encodeURIComponent(discordChannelId)}/context`,
      );

      if (response.status === 404) {
        return null;
      }

      const body = (await response.json()) as ManagedDiscordChannelContext | ControlApiErrorResponse;

      if (!response.ok) {
        const errorBody = body as ControlApiErrorResponse;
        const message = errorBody.error?.message ?? "Control API channel context request failed";
        throw new Error(message);
      }

      return body as ManagedDiscordChannelContext;
    },
    async createCategoryMapping(categoryInput) {
      const response = await fetch(
        `${baseUrl}/workspaces/${encodeURIComponent(categoryInput.workspaceId)}/category-mappings`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: categoryInput.id,
            discordCategoryId: categoryInput.discordCategoryId,
            computerId: categoryInput.computerId,
          }),
        },
      );
      const body = (await response.json()) as CategoryMappingResponse | ControlApiErrorResponse;

      if (!response.ok) {
        const errorBody = body as ControlApiErrorResponse;
        const message = errorBody.error?.message ?? "Control API category mapping request failed";
        throw new Error(message);
      }

      return body as CategoryMappingResponse;
    },
    async createManagedChannel(channelInput) {
      const response = await fetch(
        `${baseUrl}/workspaces/${encodeURIComponent(channelInput.workspaceId)}/channels`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: channelInput.id,
            discordChannelId: channelInput.discordChannelId,
            computerId: channelInput.computerId,
            channelMode: channelInput.channelMode,
          }),
        },
      );
      const body = (await response.json()) as ManagedChannelResponse | ControlApiErrorResponse;

      if (!response.ok) {
        const errorBody = body as ControlApiErrorResponse;
        const message = errorBody.error?.message ?? "Control API managed channel request failed";
        throw new Error(message);
      }

      return body as ManagedChannelResponse;
    },
    async updateChannelCwd(channelInput) {
      const response = await fetch(
        `${baseUrl}/discord/channels/${encodeURIComponent(channelInput.discordChannelId)}/context`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: channelInput.cwd }),
        },
      );
      const body = (await response.json()) as { cwd: string } | ControlApiErrorResponse;

      if (!response.ok) {
        const errorBody = body as ControlApiErrorResponse;
        const message = errorBody.error?.message ?? "Control API channel context update failed";
        throw new Error(message);
      }

      return body as { cwd: string };
    },
    async recordCommandAudit(auditInput) {
      const response = await fetch(
        `${baseUrl}/discord/channels/${encodeURIComponent(auditInput.discordChannelId)}/audit-events`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: auditInput.userId,
            cwd: auditInput.cwd,
            rawCommand: auditInput.rawCommand,
            tier: auditInput.tier,
            resultStatus: auditInput.resultStatus,
          }),
        },
      );
      const body = (await response.json()) as CommandAuditResponse | ControlApiErrorResponse;

      if (!response.ok) {
        const errorBody = body as ControlApiErrorResponse;
        const message = errorBody.error?.message ?? "Control API command audit request failed";
        throw new Error(message);
      }

      return body as CommandAuditResponse;
    },
    async linkCodexSession(sessionInput) {
      const response = await fetch(
        `${baseUrl}/discord/channels/${encodeURIComponent(sessionInput.discordChannelId)}/session-links`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: sessionInput.id,
            codexSessionId: sessionInput.codexSessionId,
            origin: sessionInput.origin,
            threadNameSnapshot: sessionInput.threadNameSnapshot,
          }),
        },
      );
      const body = (await response.json()) as LinkedCodexSessionResponse | ControlApiErrorResponse;

      if (!response.ok) {
        const errorBody = body as ControlApiErrorResponse;
        const message = errorBody.error?.message ?? "Control API session link request failed";
        throw new Error(message);
      }

      return body as LinkedCodexSessionResponse;
    },
    async listCodexSessions(sessionInput) {
      const response = await fetch(
        `${baseUrl}/computers/${encodeURIComponent(sessionInput.computerId)}/codex-sessions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ codexHome: sessionInput.codexHome }),
        },
      );
      const body = (await response.json()) as ControlApiJobResponse | ControlApiErrorResponse;

      if (!response.ok) {
        const errorBody = body as ControlApiErrorResponse;
        const message = errorBody.error?.message ?? "Control API Codex session listing failed";
        throw new Error(message);
      }

      return body as ControlApiJobResponse;
    },
    async submitCommandJob(commandInput) {
      const response = await fetch(
        `${baseUrl}/computers/${encodeURIComponent(commandInput.computerId)}/jobs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "run-command",
            payload: commandInput.payload,
          }),
        },
      );
      const body = (await response.json()) as ControlApiJobResponse | ControlApiErrorResponse;

      if (!response.ok) {
        const errorBody = body as ControlApiErrorResponse;
        const message = errorBody.error?.message ?? "Control API job request failed";
        throw new Error(message);
      }

      return body as ControlApiJobResponse;
    },
    async submitCodexPrompt(promptInput) {
      const response = await fetch(
        `${baseUrl}/computers/${encodeURIComponent(promptInput.computerId)}/jobs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "run-codex-prompt",
            payload: promptInput.payload,
          }),
        },
      );
      const body = (await response.json()) as ControlApiJobResponse | ControlApiErrorResponse;

      if (!response.ok) {
        const errorBody = body as ControlApiErrorResponse;
        const message = errorBody.error?.message ?? "Control API Codex prompt request failed";
        throw new Error(message);
      }

      return body as ControlApiJobResponse;
    },
  };
}
