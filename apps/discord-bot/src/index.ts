import { pathToFileURL } from "node:url";

import type { DiscoveredCodexSession } from "../../../packages/codex-adapter/src/index.js";
import { syncCodexSessionsToDiscord, type DiscordGuildSurface } from "./codexSessionSync.js";
import { loadConnectConfig } from "./connectConfig.js";
import { createControlApiClient } from "./controlApiClient.js";
import { createDirectSyncStateStore } from "./directState.js";
import { createDirectControlClient } from "./directControlClient.js";
import { attachDiscordMessageHandler, createDiscordClient } from "./discordClient.js";
import { createDiscordMessageHandler } from "./messageHandler.js";

export async function startBot(): Promise<void> {
  const connectConfig = await loadConnectConfig();
  const token = process.env.DISCORD_TOKEN ?? connectConfig?.discord.token;

  if (!token) {
    throw new Error("DISCORD_TOKEN is required");
  }

  const client = createDiscordClient();
  const requestedMode = connectConfig?.mode ?? process.env.CONNECT_MODE;
  const directStateStore = connectConfig?.mode === "direct" ? createDirectSyncStateStore() : null;

  if (requestedMode === "direct" && connectConfig?.mode !== "direct") {
    throw new Error("Direct mode requires .connect/config.json. Run `pnpm connect setup --direct`.");
  }

  const controlApiClient =
    connectConfig?.mode === "direct"
      ? createDirectControlClient(connectConfig, { stateStore: directStateStore ?? undefined })
      : createControlApiClient({
          baseUrl:
            connectConfig?.mode === "hub"
              ? connectConfig.hub.controlApiUrl
              : process.env.CONTROL_API_URL ?? "http://127.0.0.1:4317",
        });
  const syncCodexSessions =
    connectConfig?.mode === "direct" && directStateStore
      ? async (input: { guild: DiscordGuildSurface; limit: number }) => {
          const response = await controlApiClient.listCodexSessions({
            computerId: connectConfig.direct.computerId,
            codexHome: connectConfig.direct.codexHome,
          });

          if ("error" in response) {
            throw new Error(response.error.message);
          }

          return syncCodexSessionsToDiscord({
            guild: input.guild,
            controlApi: controlApiClient,
            stateStore: directStateStore,
            computerId: connectConfig.direct.computerId,
            computerDisplayName: connectConfig.direct.computerDisplayName,
            defaultWorkspaceRoot: connectConfig.direct.workspaceRoot,
            sessions: response.result as DiscoveredCodexSession[],
            limit: input.limit,
          });
        }
      : undefined;
  const handleMessage = createDiscordMessageHandler({
    resolveChannelContext: controlApiClient.getChannelContext,
    submitCommandJob: controlApiClient.submitCommandJob,
    submitCodexPrompt: controlApiClient.submitCodexPrompt,
    syncCodexSessions,
    updateChannelCwd: controlApiClient.updateChannelCwd,
    recordCommandAudit: controlApiClient.recordCommandAudit,
  });

  client.once("ready", () => {
    console.info(`Discord bot ready as ${client.user?.tag ?? "unknown"}`);
  });
  attachDiscordMessageHandler(client, handleMessage);

  await client.login(token);
}

export async function main(): Promise<void> {
  await startBot();
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  await main();
}
