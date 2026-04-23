import type { ChannelMode } from "@codex-discord/core";
import type { ManagedDiscordChannelContext } from "./channelContext.js";

export interface RunCommandJobPayload {
  workspaceRoot: string;
  cwd: string;
  command: string;
  timeoutMs: number;
  confirmedDangerous: boolean;
}

export type ControlApiJobResponse =
  | { jobId: string; result: unknown }
  | { jobId: string; error: { message: string } };

export interface SubmitCommandJobInput {
  computerId: string;
  payload: RunCommandJobPayload;
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
  getChannelContext(discordChannelId: string): Promise<ManagedDiscordChannelContext | null>;
  createCategoryMapping(input: CreateCategoryMappingInput): Promise<CategoryMappingResponse>;
  createManagedChannel(input: CreateManagedChannelInput): Promise<ManagedChannelResponse>;
  updateChannelCwd(input: UpdateChannelCwdInput): Promise<{ cwd: string }>;
  submitCommandJob(input: SubmitCommandJobInput): Promise<ControlApiJobResponse>;
}

interface ControlApiErrorResponse {
  error?: { message?: string };
}

export function createControlApiClient(input: { baseUrl: string }): ControlApiClient {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");

  return {
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
  };
}
