import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "./agentRegistry.js";
import { createServer } from "./server.js";

describe("control api server", () => {
  it("responds to health checks", async () => {
    const app = createServer({ agentRegistry: createAgentRegistry() });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it("lists registered online agents", async () => {
    const registry = createAgentRegistry();
    registry.register({
      computerId: "computer-1",
      displayName: "macbook-pro-01",
      capabilities: ["shell", "codex-import"],
      send: async () => {},
    });

    const app = createServer({ agentRegistry: registry });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/computers",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        {
          computerId: "computer-1",
          displayName: "macbook-pro-01",
          capabilities: ["shell", "codex-import"],
          status: "online",
        },
      ]);
    } finally {
      await app.close();
    }
  });
});
