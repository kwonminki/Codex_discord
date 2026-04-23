import { createDiscordClient } from "./discordClient.js";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("DISCORD_TOKEN is required");
}

const client = createDiscordClient();

client.once("ready", () => {
  console.info(`Discord bot ready as ${client.user?.tag ?? "unknown"}`);
});

await client.login(token);
