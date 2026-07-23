import { Buffer } from "node:buffer";

import { z } from "zod";

export const CONNECTOR_DISCOVERY_PREFIX = "agent-connector-discover:";
export const CONNECTOR_PRESENCE_PREFIX = "agent-connector-presence:";

const discoveryIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i);
const discordChannelIdSchema = z.string().regex(/^\d+$/);

export const connectorPresenceSchema = z.object({
  version: z.literal(1),
  discoveryId: discoveryIdSchema,
  computerId: z.string().trim().min(1).max(200),
  computerDisplayName: z.string().trim().min(1).max(200),
  connectorVersion: z.string().trim().min(1).max(64),
  preferredAgent: z.enum(["codex", "claude"]),
  channels: z.object({
    codex: discordChannelIdSchema,
    claude: discordChannelIdSchema.nullable(),
  }),
  maintenance: z.object({
    agent: z.enum(["codex", "claude"]),
    channelId: discordChannelIdSchema,
  }).nullable().optional(),
  registeredAt: z.string().datetime({ offset: true }),
});

export type ConnectorPresence = z.infer<typeof connectorPresenceSchema>;

export function formatConnectorDiscoveryMarker(discoveryId: string): string {
  return `${CONNECTOR_DISCOVERY_PREFIX}${discoveryIdSchema.parse(discoveryId)}`;
}

export function parseConnectorDiscoveryMarker(content: string): string | null {
  const value = content.trim();
  if (!value.startsWith(CONNECTOR_DISCOVERY_PREFIX)) {
    return null;
  }
  const parsed = discoveryIdSchema.safeParse(value.slice(CONNECTOR_DISCOVERY_PREFIX.length));
  return parsed.success ? parsed.data.toLowerCase() : null;
}

export function formatConnectorPresenceMarker(presence: ConnectorPresence): string {
  const payload = connectorPresenceSchema.parse(presence);
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${CONNECTOR_PRESENCE_PREFIX}${encoded}`;
}

export function parseConnectorPresenceMarker(content: string): ConnectorPresence | null {
  const value = content.trim();
  if (!value.startsWith(CONNECTOR_PRESENCE_PREFIX)) {
    return null;
  }

  try {
    const encoded = value.slice(CONNECTOR_PRESENCE_PREFIX.length);
    if (!encoded || encoded.length > 1_800) {
      return null;
    }
    return connectorPresenceSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}
