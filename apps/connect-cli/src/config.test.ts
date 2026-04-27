import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDirectConfig,
  buildHubConfig,
  renderEnvFile,
  writeSetupFiles,
} from "./config.js";
import {
  BOT_RELOAD_EXIT_CODE,
  buildManagedProcessEnv,
  buildManagedProcessCommands,
  shouldRestartManagedProcess,
} from "./index.js";

describe("connect setup config", () => {
  it("builds direct mode config with minimal operator inputs", () => {
    const config = buildDirectConfig({
      token: "discord-token",
      guildId: "guild-1",
      channelId: "channel-1",
      roleIds: "role-operator, role-admin",
      workspaceRoot: "/repo",
      workspaceDisplayName: "repo",
      computerId: "local-dev",
      computerDisplayName: "Local Dev",
      codexHome: "/Users/me/.codex",
    });

    expect(config).toEqual({
      mode: "direct",
      discord: {
        token: "discord-token",
        guildId: "guild-1",
        allowedRoleIds: ["role-operator", "role-admin"],
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
    });
  });

  it("can keep the direct workspace root broader than the initial cwd", () => {
    const config = buildDirectConfig({
      token: "discord-token",
      guildId: "guild-1",
      channelId: "channel-1",
      roleIds: "role-operator",
      workspaceRoot: "/repo",
      initialCwd: "/repo/apps/web",
    });

    expect(config.direct).toMatchObject({
      workspaceId: "local-dev:/repo",
      workspaceRoot: "/repo",
      initialCwd: "/repo/apps/web",
      workspaceDisplayName: "repo",
    });
  });

  it("writes generated config and env files", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "connect-cli-"));

    try {
      const config = buildHubConfig({
        token: "discord-token",
        guildId: "guild-1",
        roleIds: "role-operator",
        controlApiUrl: "http://127.0.0.1:4317",
        controlWsUrl: "ws://127.0.0.1:4317/agents",
      });

      await writeSetupFiles({ cwd: tempRoot, config });

      await expect(readFile(path.join(tempRoot, ".connect", "config.json"), "utf8")).resolves.toContain(
        '"mode": "hub"',
      );
      await expect(readFile(path.join(tempRoot, ".env"), "utf8")).resolves.toBe(renderEnvFile(config));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("restarts only the Discord bot when it exits with the reload code", () => {
    expect(
      shouldRestartManagedProcess({
        script: "dev:bot",
        code: BOT_RELOAD_EXIT_CODE,
      }),
    ).toBe(true);
    expect(
      shouldRestartManagedProcess({
        script: "dev:agent",
        code: BOT_RELOAD_EXIT_CODE,
      }),
    ).toBe(false);
    expect(
      shouldRestartManagedProcess({
        script: "dev:bot",
        code: 1,
      }),
    ).toBe(false);
  });

  it("builds package-local process commands for installed CLI execution", () => {
    expect(buildManagedProcessCommands("direct")).toEqual([
      ["node", ["--import", "tsx", "apps/discord-bot/src/index.ts"], "dev:bot"],
    ]);
    expect(buildManagedProcessCommands("hub")).toEqual([
      ["node", ["--import", "tsx", "apps/control-api/src/index.ts"], "dev:control"],
      ["node", ["--import", "tsx", "apps/local-agent/src/index.ts"], "dev:agent"],
      ["node", ["--import", "tsx", "apps/discord-bot/src/index.ts"], "dev:bot"],
    ]);
  });

  it("keeps operator config and state paths rooted in the launch directory", () => {
    expect(buildManagedProcessEnv("direct", "/operator/project", { EXISTING: "1" })).toMatchObject({
      EXISTING: "1",
      CONNECT_MODE: "direct",
      CONNECT_CONFIG_PATH: "/operator/project/.connect/config.json",
      CONNECT_STATE_PATH: "/operator/project/.connect/state.json",
    });
  });
});
