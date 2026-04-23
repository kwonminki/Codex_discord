import { pathToFileURL } from "node:url";

import { loadConnectConfig } from "./connectConfig.js";
import { createControlApiClient } from "./controlApiClient.js";
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

  if (requestedMode === "direct" && connectConfig?.mode !== "direct") {
    throw new Error("Direct mode requires .connect/config.json. Run `pnpm connect setup --direct`.");
  }

  const controlApiClient =
    connectConfig?.mode === "direct"
      ? createDirectControlClient(connectConfig)
      : createControlApiClient({
          baseUrl:
            connectConfig?.mode === "hub"
              ? connectConfig.hub.controlApiUrl
              : process.env.CONTROL_API_URL ?? "http://127.0.0.1:4317",
        });
  const handleMessage = createDiscordMessageHandler({
    resolveChannelContext: controlApiClient.getChannelContext,
    submitCommandJob: controlApiClient.submitCommandJob,
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
