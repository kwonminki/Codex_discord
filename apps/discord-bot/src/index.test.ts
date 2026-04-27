import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  process.env.CONNECT_CONFIG_PATH = path.join(
    os.tmpdir(),
    `codex-discord-missing-${randomUUID()}.json`,
  );
});

afterEach(() => {
  delete process.env.DISCORD_TOKEN;
  delete process.env.CONNECT_CONFIG_PATH;
  vi.resetModules();
  vi.unmock("./discordClient.js");
});

describe("bot entrypoint", () => {
  it("uses fast realtime polling without auto-creating session channels", async () => {
    const { resolveRealtimeIntervalMs, shouldRunRealtimeSessionAutosync } = await import("./index.js");

    expect(resolveRealtimeIntervalMs(undefined, 1_000)).toBe(1_000);
    expect(resolveRealtimeIntervalMs("250", 1_000)).toBe(500);
    expect(resolveRealtimeIntervalMs("2000", 1_000)).toBe(2_000);
    expect(resolveRealtimeIntervalMs("bad", 1_000)).toBe(1_000);
    expect(
      shouldRunRealtimeSessionAutosync({
        mode: "realtime",
        now: 10_000,
        lastAutoSyncAt: 0,
        intervalMs: 10_000,
      }),
    ).toBe(false);
    expect(
      shouldRunRealtimeSessionAutosync({
        mode: "on-chat",
        now: 10_000,
        lastAutoSyncAt: 0,
        intervalMs: 10_000,
      }),
    ).toBe(false);
  });

  it("does not start the bot when imported", async () => {
    const login = vi.fn();
    const once = vi.fn();
    const attachDiscordMessageHandler = vi.fn();
    const attachDiscordInteractionHandler = vi.fn();
    const registerDiscordApplicationCommands = vi.fn();
    const createDiscordClient = vi.fn(() => ({
      login,
      once,
    }));

    vi.doMock("./discordClient.js", () => ({
      attachDiscordInteractionHandler,
      attachDiscordMessageHandler,
      createDiscordGuildSurface: vi.fn(() => null),
      createDiscordClient,
      registerDiscordApplicationCommands,
    }));

    await expect(import("./index.js")).resolves.toBeTruthy();
    expect(createDiscordClient).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
    expect(once).not.toHaveBeenCalled();
  }, 15_000);

  it("starts the bot when requested", async () => {
    process.env.DISCORD_TOKEN = "discord-token";

    const login = vi.fn().mockResolvedValue("logged-in");
    const once = vi.fn();
    const on = vi.fn();
    const attachDiscordMessageHandler = vi.fn();
    const attachDiscordInteractionHandler = vi.fn();
    const registerDiscordApplicationCommands = vi.fn();
    const createDiscordClient = vi.fn(() => ({
      login,
      once,
      on,
    }));

    vi.doMock("./discordClient.js", () => ({
      attachDiscordInteractionHandler,
      attachDiscordMessageHandler,
      createDiscordGuildSurface: vi.fn(() => null),
      createDiscordClient,
      registerDiscordApplicationCommands,
    }));

    const { startBot } = await import("./index.js");
    await startBot();

    expect(createDiscordClient).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledWith("ready", expect.any(Function));
    expect(attachDiscordMessageHandler).toHaveBeenCalledWith(
      { login, once, on },
      expect.any(Function),
    );
    expect(attachDiscordInteractionHandler).toHaveBeenCalledWith(
      { login, once, on },
      expect.any(Function),
    );
    expect(login).toHaveBeenCalledWith("discord-token");
  }, 15_000);

  it("starts the bot from a generated direct mode config", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "direct-config-"));
    const configPath = path.join(tempRoot, "config.json");
    process.env.CONNECT_CONFIG_PATH = configPath;

    try {
      await writeFile(
        configPath,
        JSON.stringify({
          mode: "direct",
          discord: {
            token: "discord-token",
            guildId: "guild-1",
            allowedRoleIds: ["role-operator"],
          },
          direct: {
            computerId: "local-dev",
            computerDisplayName: "Local Dev",
            workspaceId: "local-dev:/repo",
            workspaceRoot: "/repo",
            workspaceDisplayName: "repo",
            channelId: "channel-1",
            channelMode: "shell-admin",
            timeoutMs: 30_000,
            codexHome: "/Users/me/.codex",
          },
        }),
        "utf8",
      );

      const login = vi.fn().mockResolvedValue("logged-in");
      const once = vi.fn();
      const on = vi.fn();
      const attachDiscordMessageHandler = vi.fn();
      const attachDiscordInteractionHandler = vi.fn();
      const registerDiscordApplicationCommands = vi.fn().mockResolvedValue(undefined);
      const createDiscordClient = vi.fn(() => ({
        login,
        once,
        on,
      }));

      vi.doMock("./discordClient.js", () => ({
        attachDiscordInteractionHandler,
        attachDiscordMessageHandler,
        createDiscordGuildSurface: vi.fn(() => null),
        createDiscordClient,
        registerDiscordApplicationCommands,
      }));

      const { startBot } = await import("./index.js");
      await startBot();

      expect(attachDiscordMessageHandler).toHaveBeenCalledWith(
        { login, once, on },
        expect.any(Function),
      );
      expect(attachDiscordInteractionHandler).toHaveBeenCalledWith(
        { login, once, on },
        expect.any(Function),
      );
      expect(login).toHaveBeenCalledWith("discord-token");

      const readyHandler = once.mock.calls.find(([eventName]) => eventName === "ready")?.[1] as
        | (() => void)
        | undefined;
      readyHandler?.();
      expect(registerDiscordApplicationCommands).toHaveBeenCalledWith({ login, once, on }, "guild-1");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects startBot without a token", async () => {
    const login = vi.fn();
    const once = vi.fn();
    const attachDiscordMessageHandler = vi.fn();
    const attachDiscordInteractionHandler = vi.fn();
    const registerDiscordApplicationCommands = vi.fn();
    const createDiscordClient = vi.fn(() => ({
      login,
      once,
    }));

    vi.doMock("./discordClient.js", () => ({
      attachDiscordInteractionHandler,
      attachDiscordMessageHandler,
      createDiscordGuildSurface: vi.fn(() => null),
      createDiscordClient,
      registerDiscordApplicationCommands,
    }));

    const { startBot } = await import("./index.js");

    await expect(startBot()).rejects.toThrow("DISCORD_TOKEN is required");
    expect(createDiscordClient).not.toHaveBeenCalled();
  });
});
