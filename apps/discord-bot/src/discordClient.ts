import { Client, GatewayIntentBits, type Message } from "discord.js";
import type { DiscordMessageLike } from "./messageHandler.js";

interface DiscordMessageEventClient {
  on(eventName: "messageCreate", listener: (message: Message) => void): unknown;
}

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
}

function getRoleIds(message: Message): string[] {
  const roles = message.member?.roles;

  if (!roles || !("cache" in roles)) {
    return [];
  }

  return [...roles.cache.keys()];
}

export function attachDiscordMessageHandler(
  client: DiscordMessageEventClient,
  handleMessage: (message: DiscordMessageLike) => Promise<void>,
): void {
  client.on("messageCreate", (message) => {
    const discordMessage = message as Message;

    void handleMessage({
      authorBot: discordMessage.author.bot,
      userId: discordMessage.author.id,
      channelId: discordMessage.channelId,
      content: discordMessage.content,
      roleIds: getRoleIds(discordMessage),
      reply: async (replyMessage) => {
        await discordMessage.reply(replyMessage);
      },
    }).catch((error) => {
      console.error("discord-bot failed to handle message", error);
    });
  });
}
