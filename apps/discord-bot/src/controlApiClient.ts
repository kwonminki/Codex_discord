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

export interface ControlApiClient {
  getChannelContext(discordChannelId: string): Promise<ManagedDiscordChannelContext | null>;
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
