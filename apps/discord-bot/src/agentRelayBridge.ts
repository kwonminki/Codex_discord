import {
  extractAgentRelayDecision,
  formatAgentRelayFilesMarker,
  formatAgentRelayResultMarker,
  type AgentRelayTurnResult,
} from "../../../packages/core/src/index.js";
import { extractAgentSurveyRequests } from "./agentSurvey.js";
import {
  extractCodexDiscordSendOutputs,
  getAgentResultContinuationMessages,
  type DiscordFilePayload,
  type DiscordMessagePayload,
} from "./responses.js";

const MAX_RELAY_FILES_PER_MESSAGE = 10;

function emptyPayload(content: string, files?: DiscordFilePayload[]): DiscordMessagePayload {
  return {
    allowedMentions: { parse: [] },
    content,
    embeds: [],
    ...(files && files.length > 0 ? { files } : {}),
  };
}

export function collectAgentResultFiles(payload: DiscordMessagePayload): DiscordFilePayload[] {
  return [payload, ...getAgentResultContinuationMessages(payload)]
    .flatMap((message) => message.files ?? []);
}

export function buildAgentRelayCallbackMessages(input: {
  requestMessageId: string;
  sourceThreadId: string;
  agentLabel: "Codex" | "Claude Code";
  status: "completed" | "failed";
  finalMessage: string;
  errorMessage?: string | null;
  files: DiscordFilePayload[];
  createdAt?: string;
}): DiscordMessagePayload[] {
  const relayOutput = extractAgentRelayDecision(input.finalMessage);
  const surveyOutput = extractAgentSurveyRequests(relayOutput.cleanedText);
  const discordSendOutput = extractCodexDiscordSendOutputs(surveyOutput.cleanedText);
  const cleanedFinalMessage = [
    discordSendOutput.cleanedText,
    ...discordSendOutput.messages,
  ].filter((value) => value.trim().length > 0).join("\n").trim();
  const decision = surveyOutput.surveys.length > 0
    ? {
        status: "blocked" as const,
        summary: "Agent가 Discord 설문으로 사용자 입력을 요청했습니다.",
      }
    : relayOutput.decision;
  const fileBatches: DiscordFilePayload[][] = [];

  for (let offset = 0; offset < input.files.length; offset += MAX_RELAY_FILES_PER_MESSAGE) {
    fileBatches.push(input.files.slice(offset, offset + MAX_RELAY_FILES_PER_MESSAGE));
  }

  const fileMessages = fileBatches.map((files, index) => emptyPayload(
    formatAgentRelayFilesMarker(input.requestMessageId, index + 1, fileBatches.length),
    files,
  ));
  const result: AgentRelayTurnResult = {
    version: 1,
    requestMessageId: input.requestMessageId,
    sourceThreadId: input.sourceThreadId,
    agentLabel: input.agentLabel,
    status: input.status,
    finalMessage: cleanedFinalMessage,
    decision,
    errorMessage: input.errorMessage?.trim() || null,
    fileCount: input.files.length,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const resultMessage = emptyPayload(formatAgentRelayResultMarker(input.requestMessageId), [{
    attachment: Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8"),
    name: "agent-relay-result.json",
  }]);

  return [...fileMessages, resultMessage];
}
