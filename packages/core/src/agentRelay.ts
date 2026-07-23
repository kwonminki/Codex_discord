import { z } from "zod";

export const AGENT_RELAY_BLOCK_LANGUAGE = "agent-relay";
export const AGENT_RELAY_CANCEL_PREFIX = "agent-relay-cancel:";
export const AGENT_RELAY_FILES_PREFIX = "agent-relay-files:";
export const AGENT_RELAY_PROMPT_ATTACHMENT_NAME = "agent-relay-prompt.txt";
export const AGENT_RELAY_REQUEST_PREFIX = "agent-relay-request:";
export const AGENT_RELAY_RESULT_PREFIX = "agent-relay-result:";
export const AGENT_RELAY_STATE_PREFIX = "agent-relay-state:";

export const agentRelayDecisionSchema = z.object({
  status: z.enum(["continue", "done", "extend", "blocked"]),
  summary: z.string().transform((value) => value.slice(0, 500)).optional(),
}).passthrough();

export type AgentRelayDecision = z.infer<typeof agentRelayDecisionSchema>;

export const agentRelayTurnResultSchema = z.object({
  version: z.literal(1),
  requestMessageId: z.string().min(1),
  sourceThreadId: z.string().min(1),
  agentLabel: z.enum(["Codex", "Claude Code"]),
  status: z.enum(["completed", "failed"]),
  finalMessage: z.string(),
  decision: agentRelayDecisionSchema.nullable(),
  errorMessage: z.string().nullable(),
  fileCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
}).passthrough();

export type AgentRelayTurnResult = z.infer<typeof agentRelayTurnResultSchema>;

export interface AgentRelayStateMarker {
  conversationId: string;
  status: "active" | "ended";
  originThreadId: string;
  peerThreadId: string;
  activeThreadId: string | null;
  expiresAtMs: number;
}

export function extractAgentRelayDecision(text: string): {
  cleanedText: string;
  decision: AgentRelayDecision | null;
  hadBlock: boolean;
} {
  const pattern = /```agent-relay\s*([\s\S]*?)```/gi;
  const blocks = [...text.matchAll(pattern)];
  let decision: AgentRelayDecision | null = null;

  for (const block of blocks) {
    try {
      const parsed = agentRelayDecisionSchema.safeParse(JSON.parse((block[1] ?? "").trim()));
      if (parsed.success) {
        decision = parsed.data;
      }
    } catch {
      // A malformed relay block remains non-fatal; the coordinator applies its hard limits.
    }
  }

  return {
    cleanedText: text.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim(),
    decision,
    hadBlock: blocks.length > 0,
  };
}

export function formatAgentRelayFilesMarker(requestMessageId: string, batch: number, total: number): string {
  return `${AGENT_RELAY_FILES_PREFIX}${requestMessageId}:${batch}/${total}`;
}

export function formatAgentRelayRequestMarker(targetThreadId: string): string {
  return `${AGENT_RELAY_REQUEST_PREFIX}${targetThreadId}`;
}

export function formatAgentRelayCancelMarker(
  targetThreadId: string,
  requestMessageId: string,
): string {
  return `${AGENT_RELAY_CANCEL_PREFIX}${targetThreadId}:${requestMessageId}`;
}

export function parseAgentRelayRequestMarker(content: string): string | null {
  const match = content.trim().match(/^agent-relay-request:(\d+)$/);
  return match?.[1] ?? null;
}

export function parseAgentRelayCancelMarker(content: string): {
  targetThreadId: string;
  requestMessageId: string;
} | null {
  const match = content.trim().match(/^agent-relay-cancel:(\d+):([^:\s]+)$/);
  return match
    ? {
        targetThreadId: match[1] ?? "",
        requestMessageId: match[2] ?? "",
      }
    : null;
}

export function formatAgentRelayStateMarker(input: AgentRelayStateMarker): string {
  return [
    AGENT_RELAY_STATE_PREFIX.slice(0, -1),
    input.conversationId,
    input.status,
    input.originThreadId,
    input.peerThreadId,
    input.activeThreadId ?? "-",
    input.expiresAtMs,
  ].join(":");
}

export function parseAgentRelayStateMarker(content: string): AgentRelayStateMarker | null {
  const match = content.trim().match(
    /^agent-relay-state:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(active|ended):(\d+):(\d+):(\d+|-):(\d+)$/i,
  );
  if (!match) {
    return null;
  }
  const expiresAtMs = Number.parseInt(match[6] ?? "", 10);
  const activeThreadId = match[5] === "-" ? null : match[5] ?? null;
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs < 0 ||
    (match[2] === "active" && !activeThreadId) ||
    (match[2] === "ended" && activeThreadId)
  ) {
    return null;
  }
  return {
    conversationId: (match[1] ?? "").toLowerCase(),
    status: match[2] as "active" | "ended",
    originThreadId: match[3] ?? "",
    peerThreadId: match[4] ?? "",
    activeThreadId,
    expiresAtMs,
  };
}

export function parseAgentRelayFilesMarker(content: string): {
  requestMessageId: string;
  batch: number;
  total: number;
} | null {
  const match = content.trim().match(/^agent-relay-files:([^:\s]+):(\d+)\/(\d+)$/);
  if (!match) {
    return null;
  }

  const batch = Number.parseInt(match[2] ?? "", 10);
  const total = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isFinite(batch) || !Number.isFinite(total) || batch < 1 || total < batch) {
    return null;
  }

  return { requestMessageId: match[1] ?? "", batch, total };
}

export function formatAgentRelayResultMarker(requestMessageId: string): string {
  return `${AGENT_RELAY_RESULT_PREFIX}${requestMessageId}`;
}

export function parseAgentRelayResultMarker(content: string): string | null {
  const match = content.trim().match(/^agent-relay-result:([^:\s]+)$/);
  return match?.[1] ?? null;
}
