import { ChannelType, Client, GatewayIntentBits, type Guild, type Message } from "discord.js";
import type { DiscordGuildSurface } from "./codexSessionSync.js";
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

function createGuildSurface(guild: Guild | null): DiscordGuildSurface | null {
  if (!guild) {
    return null;
  }

  return {
    async createCategory(input) {
      const category = await guild.channels.create({
        name: input.name,
        type: ChannelType.GuildCategory,
      });

      return { id: category.id };
    },
    async createTextChannel(input) {
      const channel = await guild.channels.create({
        name: input.name,
        type: ChannelType.GuildText,
        parent: input.parentId,
        topic: input.topic,
      });

      return { id: channel.id };
    },
    async deleteChannel(id) {
      const channel = await guild.channels.fetch(id);
      await channel?.delete();
    },
    async deleteCategory(id) {
      const category = await guild.channels.fetch(id);
      await category?.delete();
    },
  };
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
      guild: createGuildSurface(discordMessage.guild),
      reply: async (replyMessage) => discordMessage.reply(replyMessage),
    }).catch((error) => {
      console.error("discord-bot failed to handle message", error);
    });
  });
}
