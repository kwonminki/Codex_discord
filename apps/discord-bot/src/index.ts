import { pathToFileURL } from "node:url";

import { createControlApiClient } from "./controlApiClient.js";
import { attachDiscordMessageHandler, createDiscordClient } from "./discordClient.js";
import {
  createDiscordMessageHandler,
  type ManagedDiscordChannelContext,
} from "./messageHandler.js";

function parseChannelContexts(rawValue: string | undefined): Map<string, ManagedDiscordChannelContext> {
  if (!rawValue) {
    return new Map();
  }

  const parsed = JSON.parse(rawValue) as Record<string, ManagedDiscordChannelContext>;
  return new Map(Object.entries(parsed));
}

export async function startBot(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;

  if (!token) {
    throw new Error("DISCORD_TOKEN is required");
  }

  const client = createDiscordClient();
  const channelContexts = parseChannelContexts(process.env.DISCORD_CHANNEL_CONTEXTS_JSON);
  const controlApiClient = createControlApiClient({
    baseUrl: process.env.CONTROL_API_URL ?? "http://127.0.0.1:4317",
  });
  const handleMessage = createDiscordMessageHandler({
    resolveChannelContext: (channelId) => channelContexts.get(channelId) ?? null,
    submitCommandJob: controlApiClient.submitCommandJob,
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
