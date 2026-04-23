import { describe, expect, it, vi } from "vitest";
import { attachDiscordMessageHandler } from "./discordClient.js";

describe("attachDiscordMessageHandler", () => {
  it("adapts Discord messageCreate events into the pure message handler", async () => {
    const handlers = new Map<string, (message: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (message: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const guild = {
      channels: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: "category-1" })
          .mockResolvedValueOnce({ id: "channel-1" }),
      },
    };

    attachDiscordMessageHandler(client, handleMessage);
    handlers.get("messageCreate")?.({
      author: { bot: false, id: "discord-user-1" },
      channelId: "discord-channel-1",
      content: "ls",
      member: {
        roles: {
          cache: new Map([
            ["role-operator", { id: "role-operator" }],
            ["role-extra", { id: "role-extra" }],
          ]),
        },
      },
      reply,
      guild,
    });

    expect(client.on).toHaveBeenCalledWith("messageCreate", expect.any(Function));
    expect(handleMessage).toHaveBeenCalledWith({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "ls",
      roleIds: ["role-operator", "role-extra"],
      guild: expect.any(Object),
      reply: expect.any(Function),
    });

    const payload = { embeds: [{ title: "pong" }] };
    const adaptedMessage = handleMessage.mock.calls[0][0] as { reply(message: unknown): Promise<unknown> };
    await adaptedMessage.reply(payload);
    expect(reply).toHaveBeenCalledWith(payload);

    const adaptedGuild = handleMessage.mock.calls[0][0].guild as {
      createCategory(input: { name: string }): Promise<{ id: string }>;
      createTextChannel(input: { name: string; parentId: string; topic?: string }): Promise<{ id: string }>;
    };
    await expect(adaptedGuild.createCategory({ name: "repo" })).resolves.toEqual({ id: "category-1" });
    await expect(
      adaptedGuild.createTextChannel({
        name: "session",
        parentId: "category-1",
        topic: "Codex session",
      }),
    ).resolves.toEqual({ id: "channel-1" });
    expect(guild.channels.create).toHaveBeenCalledTimes(2);
  });
});
