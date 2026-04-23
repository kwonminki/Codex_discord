import { PrismaClient } from "@prisma/client";
import { createAgentRegistry } from "./agentRegistry.js";
import { createChannelContextService } from "./channelContexts.js";
import { createCommandAuditService } from "./commandAudit.js";
import { createComputerPresenceService } from "./computerPresence.js";
import { createServer } from "./server.js";
import { createWorkspaceMappingService } from "./workspaceMappings.js";

const host = process.env.CONTROL_API_HOST ?? "127.0.0.1";
const port = Number(process.env.CONTROL_API_PORT ?? 4317);
const jobTimeoutMs = Number(process.env.AGENT_JOB_TIMEOUT_MS ?? 30_000);

const agentRegistry = createAgentRegistry();
const prisma = new PrismaClient();
const app = createServer({
  agentRegistry,
  channelContexts: createChannelContextService(prisma, { defaultTimeoutMs: jobTimeoutMs }),
  commandAudit: createCommandAuditService(prisma),
  computerPresence: createComputerPresenceService(prisma),
  workspaceMappings: createWorkspaceMappingService(prisma),
  jobTimeoutMs,
});

app.addHook("onClose", async () => {
  await prisma.$disconnect();
});

const url = await app.listen({ host, port });

console.info(`Control API listening at ${url}`);
