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
});
