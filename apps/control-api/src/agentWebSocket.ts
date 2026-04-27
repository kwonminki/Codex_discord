import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import type { AgentRegistry, RegisteredAgent } from "./agentRegistry.js";
import type { AdvertisedWorkspace, ComputerPresenceService } from "./computerPresence.js";
import type {
  AgentJobProgressEnvelope,
  AgentJobResult,
  AgentJobResultEnvelope,
  createJobDispatcher,
} from "./jobs.js";

interface AgentHelloMessage {
  type: "agent-hello";
  computerId: string;
  displayName: string;
  hostname?: string;
  allowedRoleIds?: string[];
  capabilities: string[];
  workspaces?: AdvertisedWorkspace[];
}

function parseJson(raw: WebSocket.RawData): unknown {
  try {
    return JSON.parse(raw.toString()) as unknown;
  } catch {
    return null;
  }
}

function isAgentHelloMessage(message: unknown): message is AgentHelloMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const candidate = message as Partial<AgentHelloMessage>;
  return (
    candidate.type === "agent-hello" &&
    typeof candidate.computerId === "string" &&
    typeof candidate.displayName === "string" &&
    (candidate.hostname === undefined || typeof candidate.hostname === "string") &&
    (candidate.allowedRoleIds === undefined ||
      (Array.isArray(candidate.allowedRoleIds) &&
        candidate.allowedRoleIds.every((roleId) => typeof roleId === "string"))) &&
    Array.isArray(candidate.capabilities) &&
    candidate.capabilities.every((capability) => typeof capability === "string") &&
    (candidate.workspaces === undefined ||
      (Array.isArray(candidate.workspaces) &&
        candidate.workspaces.every(
          (workspace) =>
            typeof workspace.id === "string" &&
            typeof workspace.absolutePath === "string" &&
            typeof workspace.displayName === "string",
        )))
  );
}

function isAgentJobResultEnvelope(message: unknown): message is AgentJobResultEnvelope {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const candidate = message as {
    type?: unknown;
    jobId?: unknown;
    result?: unknown;
    error?: { message?: unknown } | null;
  };
  const hasResult = "result" in candidate;
  const hasError = typeof candidate.error?.message === "string";

  return candidate.type === "agent-job-result" && typeof candidate.jobId === "string" && (hasResult || hasError);
}

function isAgentJobProgressEnvelope(message: unknown): message is AgentJobProgressEnvelope {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const candidate = message as {
    type?: unknown;
    jobId?: unknown;
  };

  return candidate.type === "agent-job-progress" && typeof candidate.jobId === "string";
}

function toJobResult(envelope: AgentJobResultEnvelope): AgentJobResult {
  if ("result" in envelope) {
    return {
      jobId: envelope.jobId,
      result: envelope.result,
    };
  }

  return {
    jobId: envelope.jobId,
    error: envelope.error,
  };
}

function createSocketAgent(socket: WebSocket, hello: AgentHelloMessage): RegisteredAgent {
  return {
    computerId: hello.computerId,
    displayName: hello.displayName,
    capabilities: [...hello.capabilities],
    send(message) {
      return new Promise<void>((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) {
          reject(new Error("Agent websocket is not open"));
          return;
        }

        socket.send(JSON.stringify(message), (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

export function attachAgentWebSocketServer(input: {
  server: Server;
  agentRegistry: AgentRegistry;
  computerPresence?: ComputerPresenceService;
  jobDispatcher: ReturnType<typeof createJobDispatcher>;
}) {
  const webSocketServer = new WebSocketServer({ noServer: true });

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (pathname !== "/agents") {
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  };

  input.server.on("upgrade", onUpgrade);

  webSocketServer.on("connection", (socket) => {
    let registeredAgent: RegisteredAgent | null = null;

    socket.on("message", (raw) => {
      const message = parseJson(raw);

      if (!registeredAgent) {
        if (!isAgentHelloMessage(message)) {
          return;
        }

        void (async () => {
          await input.computerPresence?.upsertHeartbeat({
            id: message.computerId,
            displayName: message.displayName,
            hostname: message.hostname ?? message.computerId,
            allowedRoleIds: message.allowedRoleIds ?? [],
            capabilities: message.capabilities,
            workspaces: message.workspaces ?? [],
          });

          registeredAgent = createSocketAgent(socket, message);
          input.agentRegistry.register(registeredAgent);
        })().catch((error: unknown) => {
          console.error("control-api failed to persist agent hello", error);
        });
        return;
      }

      if (isAgentJobResultEnvelope(message)) {
        input.jobDispatcher.complete(toJobResult(message));
        return;
      }

      if (isAgentJobProgressEnvelope(message)) {
        input.jobDispatcher.progress(message.jobId, message.event);
      }
    });

    socket.on("close", () => {
      if (registeredAgent) {
        input.agentRegistry.unregister(registeredAgent.computerId, registeredAgent);
        void input.computerPresence?.markOffline(registeredAgent.computerId).catch((error: unknown) => {
          console.error("control-api failed to mark agent offline", error);
        });
      }
    });
  });

  return {
    close() {
      input.server.off("upgrade", onUpgrade);
      webSocketServer.close();
    },
  };
}
