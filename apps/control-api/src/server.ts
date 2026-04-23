import Fastify from "fastify";
import type { AgentRegistry } from "./agentRegistry.js";
import { attachAgentWebSocketServer } from "./agentWebSocket.js";
import type { ChannelContextService } from "./channelContexts.js";
import type { ComputerPresenceService } from "./computerPresence.js";
import { createJob, createJobDispatcher, type AgentJob } from "./jobs.js";
import type { WorkspaceMappingService } from "./workspaceMappings.js";

export interface CreateServerInput {
  agentRegistry: AgentRegistry;
  channelContexts?: ChannelContextService;
  computerPresence?: ComputerPresenceService;
  workspaceMappings?: WorkspaceMappingService;
  jobTimeoutMs?: number;
}

function isAgentJobType(value: unknown): value is AgentJob["type"] {
  return value === "run-command" || value === "list-codex-sessions";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(body: Record<string, unknown>, fieldName: string): string | null {
  const value = body[fieldName];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isChannelMode(value: unknown): value is "shell-admin" | "session-linked" {
  return value === "shell-admin" || value === "session-linked";
}

export function createServer({
  agentRegistry,
  channelContexts,
  computerPresence,
  workspaceMappings,
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
  app.post<{
    Params: { workspaceId: string };
    Body: unknown;
  }>("/workspaces/:workspaceId/category-mappings", async (request, reply) => {
    if (!workspaceMappings) {
      return reply.code(503).send({ error: { message: "Workspace mapping service is not configured" } });
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({ error: { message: "Invalid category mapping request" } });
    }

    const id = stringField(request.body, "id");
    const discordCategoryId = stringField(request.body, "discordCategoryId");
    const computerId = stringField(request.body, "computerId");

    if (!id || !discordCategoryId || !computerId) {
      return reply.code(400).send({ error: { message: "Invalid category mapping request" } });
    }

    try {
      const category = await workspaceMappings.createCategoryMapping({
        id,
        discordCategoryId,
        computerId,
        workspaceId: request.params.workspaceId,
      });

      return reply.code(201).send(category);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create category mapping";
      return reply.code(message.includes("does not exist") ? 404 : 400).send({ error: { message } });
    }
  });
  app.post<{
    Params: { workspaceId: string };
    Body: unknown;
  }>("/workspaces/:workspaceId/channels", async (request, reply) => {
    if (!workspaceMappings) {
      return reply.code(503).send({ error: { message: "Workspace mapping service is not configured" } });
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({ error: { message: "Invalid managed channel request" } });
    }

    const id = stringField(request.body, "id");
    const discordChannelId = stringField(request.body, "discordChannelId");
    const computerId = stringField(request.body, "computerId");

    if (!id || !discordChannelId || !computerId || !isChannelMode(request.body.channelMode)) {
      return reply.code(400).send({ error: { message: "Invalid managed channel request" } });
    }

    try {
      const channel = await workspaceMappings.createManagedChannel({
        id,
        discordChannelId,
        computerId,
        workspaceId: request.params.workspaceId,
        channelMode: request.body.channelMode,
      });

      return reply.code(201).send(channel);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create managed channel";
      return reply.code(message.includes("does not exist") ? 404 : 400).send({ error: { message } });
    }
  });
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
