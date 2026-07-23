import { describe, expect, it } from "vitest";

import {
  formatConnectorDiscoveryMarker,
  formatConnectorPresenceMarker,
  parseConnectorDiscoveryMarker,
  parseConnectorPresenceMarker,
} from "../src/connectorDiscovery.js";

const discoveryId = "30519a6b-5fd5-4944-9fd2-2e3293c1c925";

describe("connector discovery markers", () => {
  it("round-trips a discovery marker", () => {
    const marker = formatConnectorDiscoveryMarker(discoveryId);

    expect(parseConnectorDiscoveryMarker(marker)).toBe(discoveryId);
    expect(parseConnectorDiscoveryMarker("agent-connector-discover:not-valid")).toBeNull();
  });

  it("round-trips connector presence without exposing raw labels in the marker", () => {
    const marker = formatConnectorPresenceMarker({
      version: 1,
      discoveryId,
      computerId: "server-a",
      computerDisplayName: "Server A",
      connectorVersion: "1.3.0",
      preferredAgent: "claude",
      channels: {
        codex: "1527202616818405498",
        claude: "1528612744973123727",
      },
      registeredAt: "2026-07-24T00:00:00.000Z",
    });

    expect(marker).not.toContain("Server A");
    expect(parseConnectorPresenceMarker(marker)).toEqual({
      version: 1,
      discoveryId,
      computerId: "server-a",
      computerDisplayName: "Server A",
      connectorVersion: "1.3.0",
      preferredAgent: "claude",
      channels: {
        codex: "1527202616818405498",
        claude: "1528612744973123727",
      },
      registeredAt: "2026-07-24T00:00:00.000Z",
    });
  });

  it("rejects malformed presence payloads", () => {
    expect(parseConnectorPresenceMarker("agent-connector-presence:not-base64-json")).toBeNull();
  });
});
