import { randomUUID } from "node:crypto";
import { discoverCodexSessions } from "../../../packages/codex-adapter/src/index.js";
import { runCodexPrompt } from "../../local-agent/src/codexRunner.js";
import { runWorkspaceCommand } from "../../local-agent/src/runner.js";
import type { ControlApiClient } from "./controlApiClient.js";
import type { DirectConnectConfig } from "./connectConfig.js";
import type { DirectSyncStateStore } from "./directState.js";

export function createDirectControlClient(
  config: DirectConnectConfig,
  options: { stateStore?: DirectSyncStateStore } = {},
): ControlApiClient {
  let cwd = config.direct.workspaceRoot;
  const sessionLinks = new Map<string, {
    id: string;
    channelId: string;
    codexSessionId: string;
    origin: "managed_new" | "imported_native";
    threadNameSnapshot: string;
    availabilityStatus: string;
  }>();

  return {
    async listInventory() {
      return [
        {
          id: config.direct.computerId,
          displayName: config.direct.computerDisplayName,
          hostname: config.direct.computerId,
          status: "online",
          allowedRoleIds: [...config.discord.allowedRoleIds],
          capabilities: ["shell", "codex-import", "codex-chat"],
          workspaces: [
            {
              id: config.direct.workspaceId,
              absolutePath: config.direct.workspaceRoot,
              displayName: config.direct.workspaceDisplayName,
              status: "valid",
            },
          ],
        },
      ];
    },
    async getChannelContext(discordChannelId) {
      if (discordChannelId === config.direct.channelId) {
        return {
          channelMode: config.direct.channelMode,
          allowedRoleIds: [...config.discord.allowedRoleIds],
          computerId: config.direct.computerId,
          computerDisplayName: config.direct.computerDisplayName,
          workspaceDisplayName: config.direct.workspaceDisplayName,
          workspaceRoot: config.direct.workspaceRoot,
          cwd,
          timeoutMs: config.direct.timeoutMs,
          codexSessionId: null,
        };
      }

      const syncedChannel = await options.stateStore?.findSessionChannelByDiscordId(discordChannelId);

      if (!syncedChannel) {
        return null;
      }

      return {
        channelMode: "session-linked",
        allowedRoleIds: [...config.discord.allowedRoleIds],
        computerId: syncedChannel.computerId,
        computerDisplayName: config.direct.computerDisplayName,
        workspaceDisplayName: syncedChannel.workspaceDisplayName,
        workspaceRoot: syncedChannel.workspaceRoot,
        cwd: syncedChannel.cwd,
        timeoutMs: config.direct.timeoutMs,
        codexSessionId: syncedChannel.codexSessionId,
      };
    },
    async createCategoryMapping(input) {
      return {
        id: input.id,
        discordCategoryId: input.discordCategoryId,
        computerId: input.computerId,
        workspaceId: input.workspaceId,
        syncStatus: "direct",
      };
    },
    async createManagedChannel(input) {
      return {
        id: input.id,
        discordChannelId: input.discordChannelId,
        computerId: input.computerId,
        workspaceId: input.workspaceId,
        channelMode: input.channelMode,
        cwd,
        status: "direct",
      };
    },
    async updateChannelCwd(input) {
      if (input.discordChannelId === config.direct.channelId) {
        cwd = input.cwd;
      }

      await options.stateStore?.updateChannelCwd(input.discordChannelId, input.cwd);

      return { cwd };
    },
    async recordCommandAudit(input) {
      return {
        id: randomUUID(),
        channelId: input.discordChannelId,
        userId: input.userId,
        targetComputerId: config.direct.computerId,
        targetWorkspaceId: config.direct.workspaceId,
        cwd: input.cwd,
        rawCommand: input.rawCommand,
        tier: input.tier,
        resultStatus: input.resultStatus,
      };
    },
    async linkCodexSession(input) {
      const link = {
        id: input.id,
        channelId: input.discordChannelId,
        codexSessionId: input.codexSessionId,
        origin: input.origin,
        threadNameSnapshot: input.threadNameSnapshot,
        availabilityStatus: "available",
      };
      sessionLinks.set(input.discordChannelId, link);
      return link;
    },
    async listCodexSessions(input) {
      if (input.computerId !== config.direct.computerId) {
        return { jobId: randomUUID(), error: { message: "Computer is offline" } };
      }

      return { jobId: randomUUID(), result: await discoverCodexSessions(input.codexHome) };
    },
    async submitCommandJob(input) {
      if (input.computerId !== config.direct.computerId) {
        return { jobId: randomUUID(), error: { message: "Computer is offline" } };
      }

      const result = await runWorkspaceCommand(input.payload);
      return { jobId: randomUUID(), result };
    },
    async submitCodexPrompt(input) {
      if (input.computerId !== config.direct.computerId) {
        return { jobId: randomUUID(), error: { message: "Computer is offline" } };
      }

      const result = await runCodexPrompt({
        ...input.payload,
        codexHome: config.direct.codexHome,
      });
      return { jobId: randomUUID(), result };
    },
  };
}
