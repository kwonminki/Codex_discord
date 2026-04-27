import Fastify from "fastify";
import type { AgentRegistry } from "./agentRegistry.js";
import { attachAgentWebSocketServer } from "./agentWebSocket.js";
import type { ChannelContextService } from "./channelContexts.js";
import type { CommandAuditService } from "./commandAudit.js";
import type { ComputerPresenceService } from "./computerPresence.js";
import type { InventoryService } from "./inventory.js";
import { createJob, createJobDispatcher, type AgentJob } from "./jobs.js";
import type { SessionLinkService } from "./sessionLinks.js";
import type { WorkspaceMappingService } from "./workspaceMappings.js";

export interface CreateServerInput {
  agentRegistry: AgentRegistry;
  channelContexts?: ChannelContextService;
  commandAudit?: CommandAuditService;
  computerPresence?: ComputerPresenceService;
  inventory?: InventoryService;
  sessionLinks?: SessionLinkService;
  workspaceMappings?: WorkspaceMappingService;
  jobTimeoutMs?: number;
}

function isAgentJobType(value: unknown): value is AgentJob["type"] {
  return value === "run-command" || value === "list-codex-sessions" || value === "run-codex-prompt";
}

function acceptsNdjson(value: string | undefined): boolean {
  return Boolean(value?.split(",").some((part) => part.trim().startsWith("application/x-ndjson")));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(body: Record<string, unknown>, fieldName: string): string | null {
  const value = body[fieldName];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanField(body: Record<string, unknown>, fieldName: string): boolean | undefined {
  const value = body[fieldName];
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayField(body: Record<string, unknown>, fieldName: string): string[] | undefined {
  const value = body[fieldName];

  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function isChannelMode(value: unknown): value is "shell-admin" | "session-linked" {
  return value === "shell-admin" || value === "session-linked";
}

function isSessionOrigin(value: unknown): value is "managed_new" | "imported_native" {
  return value === "managed_new" || value === "imported_native";
}

export function createServer({
  agentRegistry,
  channelContexts,
  commandAudit,
  computerPresence,
  inventory,
  sessionLinks,
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
  app.get("/inventory", async (request, reply) => {
    if (!inventory) {
      return reply.code(503).send({ error: { message: "Inventory service is not configured" } });
    }

    return inventory.listComputers();
  });
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
  app.patch<{
    Params: { discordChannelId: string };
    Body: unknown;
  }>("/discord/channels/:discordChannelId/context", async (request, reply) => {
    if (!channelContexts) {
      return reply.code(503).send({ error: { message: "Channel context service is not configured" } });
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({ error: { message: "Invalid channel context update request" } });
    }

    const cwd = stringField(request.body, "cwd");

    if (!cwd) {
      return reply.code(400).send({ error: { message: "Invalid channel context update request" } });
    }

    try {
      const result = await channelContexts.updateCwdByDiscordChannelId(
        request.params.discordChannelId,
        cwd,
      );

      if (!result) {
        return reply.code(404).send({ error: { message: "Discord channel is not managed" } });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update channel context";
      return reply.code(400).send({ error: { message } });
    }
  });
  app.post<{
    Params: { discordChannelId: string };
    Body: unknown;
  }>("/discord/channels/:discordChannelId/audit-events", async (request, reply) => {
    if (!commandAudit) {
      return reply.code(503).send({ error: { message: "Command audit service is not configured" } });
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({ error: { message: "Invalid command audit request" } });
    }

    const userId = stringField(request.body, "userId");
    const rawCommand = stringField(request.body, "rawCommand");
    const tier = stringField(request.body, "tier");
    const resultStatus = stringField(request.body, "resultStatus");
    const cwd = typeof request.body.cwd === "string" ? request.body.cwd : null;

    if (!userId || !rawCommand || !tier || !resultStatus) {
      return reply.code(400).send({ error: { message: "Invalid command audit request" } });
    }

    const auditEvent = await commandAudit.recordForDiscordChannel({
      discordChannelId: request.params.discordChannelId,
      userId,
      cwd,
      rawCommand,
      tier,
      resultStatus,
    });

    if (!auditEvent) {
      return reply.code(404).send({ error: { message: "Discord channel is not managed" } });
    }

    return reply.code(201).send(auditEvent);
  });
  app.post<{
    Params: { discordChannelId: string };
    Body: unknown;
  }>("/discord/channels/:discordChannelId/session-links", async (request, reply) => {
    if (!sessionLinks) {
      return reply.code(503).send({ error: { message: "Session link service is not configured" } });
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({ error: { message: "Invalid session link request" } });
    }

    const id = stringField(request.body, "id");
    const codexSessionId = stringField(request.body, "codexSessionId");
    const threadNameSnapshot = stringField(request.body, "threadNameSnapshot");

    if (!id || !codexSessionId || !threadNameSnapshot || !isSessionOrigin(request.body.origin)) {
      return reply.code(400).send({ error: { message: "Invalid session link request" } });
    }

    const link = await sessionLinks.linkCodexSessionToDiscordChannel({
      discordChannelId: request.params.discordChannelId,
      id,
      codexSessionId,
      origin: request.body.origin,
      threadNameSnapshot,
    });

    if (!link) {
      return reply.code(404).send({ error: { message: "Discord channel is not managed" } });
    }

    return reply.code(201).send(link);
  });
  app.post<{
    Params: { computerId: string };
    Body: unknown;
  }>("/computers/:computerId/codex-sessions", async (request, reply) => {
    if (!isRecord(request.body)) {
      return reply.code(400).send({ error: { message: "Invalid Codex session listing request" } });
    }

    const codexHome = stringField(request.body, "codexHome");

    if (!codexHome) {
      return reply.code(400).send({ error: { message: "Invalid Codex session listing request" } });
    }

    const { job } = createJob(request.params.computerId, "list-codex-sessions", {
      codexHome,
      activeOnly: booleanField(request.body, "activeOnly"),
      includeExecSessions: booleanField(request.body, "includeExecSessions"),
      includeSessionIds: stringArrayField(request.body, "includeSessionIds"),
    });

    try {
      return await jobDispatcher.dispatchAndWait(request.params.computerId, job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent job failed";
      const statusCode = message === "Computer is offline" ? 409 : message === "Agent job timed out" ? 504 : 500;
      return reply.code(statusCode).send({ jobId: job.jobId, error: { message } });
    }
  });
  app.post<{
    Params: { computerId: string };
    Body: { type?: unknown; payload?: unknown; streamProgress?: unknown } | undefined;
  }>("/computers/:computerId/jobs", async (request, reply) => {
    const body = request.body ?? {};

    if (!isAgentJobType(body.type)) {
      return reply.code(400).send({ error: { message: "Unsupported agent job type" } });
    }

    const { job } = createJob(request.params.computerId, body.type, body.payload);

    if (body.streamProgress === true && acceptsNdjson(request.headers.accept)) {
      reply.hijack();
      reply.raw.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });

      const writeLine = (value: unknown) => {
        reply.raw.write(`${JSON.stringify(value)}\n`);
      };

      try {
        const result = await jobDispatcher.dispatchAndWait(request.params.computerId, job, {
          onProgress: (event) => {
            writeLine({ type: "progress", event });
          },
        });
        writeLine({ type: "result", ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent job failed";
        writeLine({ type: "result", jobId: job.jobId, error: { message } });
      } finally {
        reply.raw.end();
      }

      return reply;
    }

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
