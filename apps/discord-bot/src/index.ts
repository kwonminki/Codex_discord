import { pathToFileURL } from "node:url";

import { createDiscordClient } from "./discordClient.js";

export async function startBot(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;

  if (!token) {
    throw new Error("DISCORD_TOKEN is required");
  }

  const client = createDiscordClient();

  client.once("ready", () => {
    console.info(`Discord bot ready as ${client.user?.tag ?? "unknown"}`);
  });

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
