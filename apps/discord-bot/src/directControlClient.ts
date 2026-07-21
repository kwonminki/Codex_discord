import { randomUUID } from "node:crypto";
import { discoverCodexSessions } from "../../../packages/codex-adapter/src/index.js";
import { runClaudePrompt } from "../../local-agent/src/claudeRunner.js";
import {
  interruptActiveCodexAppServerTurn,
  runCodexAppServerPrompt,
  steerActiveCodexAppServerTurn,
} from "../../local-agent/src/codexAppServerRunner.js";
import { runCodexPrompt } from "../../local-agent/src/codexRunner.js";
import { runWorkspaceCommand } from "../../local-agent/src/runner.js";
import { assertInsideWorkspace } from "../../local-agent/src/workspace.js";
import type { ControlApiClient } from "./controlApiClient.js";
import type { DirectConnectConfig } from "./connectConfig.js";
import type { DirectSyncStateStore } from "./directState.js";

export function createDirectControlClient(
  config: DirectConnectConfig,
  options: { stateStore?: DirectSyncStateStore } = {},
): ControlApiClient {
  const codexRunner = process.env.CODEX_DISCORD_CODEX_RUNNER === "app-server" ? "app-server" : "exec";
  const claudeChannelId = config.direct.claudeChannelId?.trim() || null;
  let cwd = config.direct.initialCwd
    ? assertInsideWorkspace(config.direct.workspaceRoot, config.direct.initialCwd)
    : config.direct.workspaceRoot;
  let claudeCwd = cwd;
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
          capabilities: ["shell", "codex-import", "codex-chat", "claude-code"],
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
          discordDeliveryMode: "channel",
          discordParentChannelId: null,
        };
      }

      if (claudeChannelId && discordChannelId === claudeChannelId) {
        return {
          channelMode: "claude-code",
          allowedRoleIds: [...config.discord.allowedRoleIds],
          computerId: config.direct.computerId,
          computerDisplayName: config.direct.computerDisplayName,
          workspaceDisplayName: config.direct.workspaceDisplayName,
          workspaceRoot: config.direct.workspaceRoot,
          cwd: claudeCwd,
          timeoutMs: config.direct.timeoutMs,
          codexSessionId: null,
          discordDeliveryMode: "channel",
          discordParentChannelId: null,
        };
      }

      const syncedChannel = await options.stateStore?.findSessionChannelByDiscordId(discordChannelId);

      if (!syncedChannel) {
        return null;
      }

      const syncedChannelMode = syncedChannel.channelMode ?? "session-linked";

      return {
        channelMode: syncedChannelMode,
        allowedRoleIds: [...config.discord.allowedRoleIds],
        computerId: syncedChannel.computerId,
        computerDisplayName: config.direct.computerDisplayName,
        workspaceDisplayName: syncedChannel.workspaceDisplayName,
        workspaceRoot: syncedChannel.workspaceRoot,
        cwd: syncedChannel.cwd,
        timeoutMs: config.direct.timeoutMs,
        codexSessionId: syncedChannel.codexSessionId,
        claudeSessionId: syncedChannel.claudeSessionId ?? null,
        discordDeliveryMode: syncedChannel.discordDeliveryMode ?? "channel",
        discordParentChannelId: syncedChannel.discordParentChannelId ?? null,
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
      let updatedCwd = input.cwd;

      if (input.discordChannelId === config.direct.channelId) {
        cwd = input.cwd;
        updatedCwd = cwd;
      }

      if (claudeChannelId && input.discordChannelId === claudeChannelId) {
        claudeCwd = input.cwd;
        updatedCwd = claudeCwd;
      }

      await options.stateStore?.updateChannelCwd(input.discordChannelId, input.cwd);

      return { cwd: updatedCwd };
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

      return {
        jobId: randomUUID(),
        result: await discoverCodexSessions(input.codexHome, {
          activeOnly: input.activeOnly ?? true,
          includeExecSessions: input.includeExecSessions ?? false,
          includeSessionIds: input.includeSessionIds,
          includeContextPreview: true,
          includeRealtimeEvents: true,
          contextMessageLimit: 25,
          contextMessageMaxChars: 8_000,
          realtimeEventLimit: 40,
        }),
      };
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

      const runnerInput = {
        ...input.payload,
        codexHome: config.direct.codexHome,
        onProgress: input.onProgress,
        onApprovalRequest: input.onApprovalRequest,
      };
      if (input.payload.forkSession && codexRunner !== "app-server") {
        return {
          jobId: randomUUID(),
          result: {
            status: "failed",
            finalMessage: "Codex session fork requires CODEX_DISCORD_CODEX_RUNNER=app-server.",
            sessionId: input.payload.sessionId,
            stderr: "",
            exitCode: null,
            errorCode: "CODEX_FORK_APP_SERVER_REQUIRED",
          },
        };
      }
      const result =
        codexRunner === "app-server" && input.payload.mode !== "review"
          ? await runCodexAppServerPrompt(runnerInput)
          : await runCodexPrompt(runnerInput);
      return { jobId: randomUUID(), result };
    },
    async controlCodexTurn(input) {
      if (input.computerId !== config.direct.computerId) {
        return {
          status: "failed",
          message: "Computer is offline",
        };
      }

      if (codexRunner !== "app-server") {
        return {
          status: "unsupported",
          message: "Codex steering requires CODEX_DISCORD_CODEX_RUNNER=app-server.",
        };
      }

      return input.action === "steer"
        ? steerActiveCodexAppServerTurn(input.controlKey, input.content ?? "")
        : interruptActiveCodexAppServerTurn(input.controlKey);
    },
    async submitClaudePrompt(input) {
      if (input.computerId !== config.direct.computerId) {
        return { jobId: randomUUID(), error: { message: "Computer is offline" } };
      }

      const result = await runClaudePrompt({
        ...input.payload,
        onProgress: input.onProgress,
      });
      return { jobId: randomUUID(), result };
    },
  };
}
