import { z } from "zod";

export const AGENT_RELAY_BLOCK_LANGUAGE = "agent-relay";
export const AGENT_RELAY_FILES_PREFIX = "agent-relay-files:";
export const AGENT_RELAY_PROMPT_ATTACHMENT_NAME = "agent-relay-prompt.txt";
export const AGENT_RELAY_REQUEST_PREFIX = "agent-relay-request:";
export const AGENT_RELAY_RESULT_PREFIX = "agent-relay-result:";

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

export function parseAgentRelayRequestMarker(content: string): string | null {
  const match = content.trim().match(/^agent-relay-request:(\d+)$/);
  return match?.[1] ?? null;
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
