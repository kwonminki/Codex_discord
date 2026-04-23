import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  delete process.env.DISCORD_TOKEN;
  vi.resetModules();
  vi.unmock("./discordClient.js");
});

describe("bot entrypoint", () => {
  it("does not start the bot when imported", async () => {
    const login = vi.fn();
    const once = vi.fn();
    const attachDiscordMessageHandler = vi.fn();
    const createDiscordClient = vi.fn(() => ({
      login,
      once,
    }));

    vi.doMock("./discordClient.js", () => ({
      attachDiscordMessageHandler,
      createDiscordClient,
    }));

    await expect(import("./index.js")).resolves.toBeTruthy();
    expect(createDiscordClient).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
    expect(once).not.toHaveBeenCalled();
  });

  it("starts the bot when requested", async () => {
    process.env.DISCORD_TOKEN = "discord-token";

    const login = vi.fn().mockResolvedValue("logged-in");
    const once = vi.fn();
    const on = vi.fn();
    const attachDiscordMessageHandler = vi.fn();
    const createDiscordClient = vi.fn(() => ({
      login,
      once,
      on,
    }));

    vi.doMock("./discordClient.js", () => ({
      attachDiscordMessageHandler,
      createDiscordClient,
    }));

    const { startBot } = await import("./index.js");
    await startBot();

    expect(createDiscordClient).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledWith("ready", expect.any(Function));
    expect(attachDiscordMessageHandler).toHaveBeenCalledWith(
      { login, once, on },
      expect.any(Function),
    );
    expect(login).toHaveBeenCalledWith("discord-token");
  });

  it("rejects startBot without a token", async () => {
    const login = vi.fn();
    const once = vi.fn();
    const attachDiscordMessageHandler = vi.fn();
    const createDiscordClient = vi.fn(() => ({
      login,
      once,
    }));

    vi.doMock("./discordClient.js", () => ({
      attachDiscordMessageHandler,
      createDiscordClient,
    }));

    const { startBot } = await import("./index.js");

    await expect(startBot()).rejects.toThrow("DISCORD_TOKEN is required");
    expect(createDiscordClient).not.toHaveBeenCalled();
  });
});
