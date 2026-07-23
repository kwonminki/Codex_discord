import { chmod, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import { resolveConnectorLocale } from "../../../packages/core/src/index.js";

export const relayBotConfigSchema = z.object({
  version: z.literal(1),
  token: z.string().min(1),
  guildId: z.string().min(1),
  operatorRoleIds: z.array(z.string().min(1)).min(1),
  controlChannelId: z.string().min(1),
  connectorBotUserIds: z.array(z.string().min(1)).min(1),
  locale: z.enum(["ko", "en", "zh", "ja"]).default("ko"),
  stateRoot: z.string().min(1).optional(),
});

export type RelayBotConfig = z.infer<typeof relayBotConfigSchema>;

function identifierList(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean))];
}

export function defaultRelayBotConfigPath(): string {
  return path.resolve(process.env.RELAY_CONFIG_PATH ?? ".connect/relay-config.json");
}

export async function loadRelayBotConfig(configPath = defaultRelayBotConfigPath()): Promise<RelayBotConfig> {
  let fileConfig: Partial<RelayBotConfig> = {};
  try {
    fileConfig = JSON.parse(await readFile(configPath, "utf8")) as Partial<RelayBotConfig>;
    await chmod(configPath, 0o600);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const operatorRoleIds = identifierList(process.env.RELAY_OPERATOR_ROLE_IDS);
  const connectorBotUserIds = identifierList(process.env.RELAY_CONNECTOR_BOT_USER_IDS);
  return relayBotConfigSchema.parse({
    version: 1,
    token: process.env.RELAY_DISCORD_BOT_TOKEN?.trim() || fileConfig.token,
    guildId: process.env.RELAY_DISCORD_GUILD_ID?.trim() || fileConfig.guildId,
    operatorRoleIds: operatorRoleIds.length > 0 ? operatorRoleIds : fileConfig.operatorRoleIds,
    controlChannelId: process.env.RELAY_CONTROL_CHANNEL_ID?.trim() || fileConfig.controlChannelId,
    connectorBotUserIds: connectorBotUserIds.length > 0
      ? connectorBotUserIds
      : fileConfig.connectorBotUserIds,
    locale: resolveConnectorLocale(process.env.RELAY_LOCALE?.trim() || fileConfig.locale),
    stateRoot: process.env.RELAY_STATE_ROOT?.trim() || fileConfig.stateRoot,
  });
}
