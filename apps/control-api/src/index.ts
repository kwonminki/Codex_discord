import { createAgentRegistry } from "./agentRegistry.js";
import { createServer } from "./server.js";

const host = process.env.CONTROL_API_HOST ?? "127.0.0.1";
const port = Number(process.env.CONTROL_API_PORT ?? 4317);

const agentRegistry = createAgentRegistry();
const app = createServer({ agentRegistry });

const url = await app.listen({ host, port });

console.info(`Control API listening at ${url}`);
