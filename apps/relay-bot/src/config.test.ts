import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadRelayBotConfig } from "./config.js";

describe("relay bot config", () => {
  it("loads a local secret config and restricts its POSIX file mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "relay-config-"));
    const configPath = path.join(root, "relay-config.json");
    await writeFile(configPath, JSON.stringify({
      version: 1,
      token: "secret-token",
      guildId: "guild-1",
      operatorRoleIds: ["role-1"],
      controlChannelId: "control-1",
      connectorBotUserIds: ["connector-1"],
      releaseChannelId: "release-1",
      locale: "ja",
    }), { mode: 0o644 });

    try {
      await expect(loadRelayBotConfig(configPath)).resolves.toMatchObject({
        token: "secret-token",
        guildId: "guild-1",
        operatorRoleIds: ["role-1"],
        controlChannelId: "control-1",
        connectorBotUserIds: ["connector-1"],
        releaseChannelId: "release-1",
        locale: "ja",
      });
      if (process.platform !== "win32") {
        expect((await stat(configPath)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an incomplete trust configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "relay-config-invalid-"));
    const configPath = path.join(root, "relay-config.json");
    await writeFile(configPath, JSON.stringify({
      version: 1,
      token: "secret-token",
      guildId: "guild-1",
      operatorRoleIds: [],
      controlChannelId: "control-1",
      connectorBotUserIds: [],
    }));

    try {
      await expect(loadRelayBotConfig(configPath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
