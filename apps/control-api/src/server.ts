import Fastify from "fastify";
import type { AgentRegistry } from "./agentRegistry.js";
import { attachAgentWebSocketServer } from "./agentWebSocket.js";
import type { ChannelContextService } from "./channelContexts.js";
import type { ComputerPresenceService } from "./computerPresence.js";
import { createJob, createJobDispatcher, type AgentJob } from "./jobs.js";

export interface CreateServerInput {
  agentRegistry: AgentRegistry;
  channelContexts?: ChannelContextService;
  computerPresence?: ComputerPresenceService;
  jobTimeoutMs?: number;
}

function isAgentJobType(value: unknown): value is AgentJob["type"] {
  return value === "run-command" || value === "list-codex-sessions";
}

export function createServer({
  agentRegistry,
  channelContexts,
  computerPresence,
  jobTimeoutMs,
}: CreateServerInput) {
  const app = Fastify({
    logger: false,
  });
  const jobDispatcher = createJobDispatcher(agentRegistry, { timeoutMs: jobTimeoutMs });
  const agentWebSocketServer = attachAgentWebSocketServer({
    server: app.server,
    agentRegistry,
    computerPresence,
    jobDispatcher,
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/computers", async () => agentRegistry.list());
  app.get<{ Params: { discordChannelId: string } }>(
    "/discord/channels/:discordChannelId/context",
    async (request, reply) => {
      const context =
        (await channelContexts?.findByDiscordChannelId(request.params.discordChannelId)) ?? null;

      if (!context) {
        return reply.code(404).send({ error: { message: "Discord channel is not managed" } });
      }

      return context;
    },
  );
  app.post<{
    Params: { computerId: string };
    Body: { type?: unknown; payload?: unknown } | undefined;
  }>("/computers/:computerId/jobs", async (request, reply) => {
    const body = request.body ?? {};

    if (!isAgentJobType(body.type)) {
      return reply.code(400).send({ error: { message: "Unsupported agent job type" } });
    }

    const { job } = createJob(request.params.computerId, body.type, body.payload);

    try {
      return await jobDispatcher.dispatchAndWait(request.params.computerId, job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent job failed";
      const statusCode = message === "Computer is offline" ? 409 : message === "Agent job timed out" ? 504 : 500;
      return reply.code(statusCode).send({ jobId: job.jobId, error: { message } });
    }
  });

  app.addHook("onClose", async () => {
    agentWebSocketServer.close();
  });

  return app;
}
