import { pathToFileURL } from "node:url";

import { createControlApiClient } from "./controlApiClient.js";
import { attachDiscordMessageHandler, createDiscordClient } from "./discordClient.js";
import { createDiscordMessageHandler } from "./messageHandler.js";

export async function startBot(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;

  if (!token) {
    throw new Error("DISCORD_TOKEN is required");
  }

  const client = createDiscordClient();
  const controlApiClient = createControlApiClient({
    baseUrl: process.env.CONTROL_API_URL ?? "http://127.0.0.1:4317",
  });
  const handleMessage = createDiscordMessageHandler({
    resolveChannelContext: controlApiClient.getChannelContext,
    submitCommandJob: controlApiClient.submitCommandJob,
    updateChannelCwd: controlApiClient.updateChannelCwd,
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
