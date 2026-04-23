import Fastify from "fastify";
import type { AgentRegistry } from "./agentRegistry.js";

export interface CreateServerInput {
  agentRegistry: AgentRegistry;
}

export function createServer({ agentRegistry }: CreateServerInput) {
  const app = Fastify({
    logger: false,
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/computers", async () => agentRegistry.list());

  return app;
}
