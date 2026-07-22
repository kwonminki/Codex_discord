import {
  extractCodexDiscordSendOutputs,
  extractLocalMediaLinkOutputs,
  formatAgentSurveyMessages,
  type DiscordFilePayload,
  type DiscordMessagePayload,
} from "./responses.js";
import { extractAgentSurveyRequests } from "./agentSurvey.js";

const DEFAULT_MAX_PREVIEW_CHARS = 3_800;

function sanitizeDiscordText(value: string): string {
  return value.replace(/@/g, "[at]").trimEnd();
}

export interface AgentCompletionAnswer {
  answer: string;
  description: string;
  files: DiscordFilePayload[];
  surveyMessages: DiscordMessagePayload[];
  clipped: boolean;
}

export function prepareAgentCompletionAnswer(input: {
  answer: string;
  agent: "codex" | "claude";
  attachmentName: string;
  maxPreviewChars?: number;
}): AgentCompletionAnswer {
  const surveyOutputs = extractAgentSurveyRequests(input.answer);
  const discordSendOutputs = extractCodexDiscordSendOutputs(surveyOutputs.cleanedText);
  const mediaLinkOutputs = extractLocalMediaLinkOutputs(discordSendOutputs.cleanedText);
  const extractedFiles = [...discordSendOutputs.attachments, ...mediaLinkOutputs.attachments];
  const answer = !surveyOutputs.hadBlocks && !discordSendOutputs.hadBlocks && mediaLinkOutputs.notices.length === 0
    ? input.answer
    : [
        discordSendOutputs.cleanedText,
        ...surveyOutputs.notices.map((notice) => `주의: ${notice}`),
        ...discordSendOutputs.messages,
        ...discordSendOutputs.notices.map((notice) => `주의: ${notice}`),
        ...mediaLinkOutputs.notices.map((notice) => `주의: ${notice}`),
      ]
        .filter((line) => line.trim().length > 0)
        .join("\n") || (
          surveyOutputs.surveys.length > 0
            ? "아래 설문에서 선택해주세요."
            : extractedFiles.length > 0
              ? "첨부 파일을 보냈습니다."
              : input.answer
        );
  const sanitizedAnswer = sanitizeDiscordText(answer);
  const maxPreviewChars = input.maxPreviewChars ?? DEFAULT_MAX_PREVIEW_CHARS;
  const suffix = `\n\n... (전체 답변은 첨부 파일 \`${input.attachmentName}\`에서 확인하세요.)`;
  const clipped = sanitizedAnswer.length > maxPreviewChars;
  const previewBodyChars = Math.max(0, maxPreviewChars - suffix.length);
  const description = clipped
    ? `${sanitizedAnswer.slice(0, previewBodyChars).trimEnd()}${suffix}`
    : sanitizedAnswer;
  const files = [
    ...(clipped
      ? [{ attachment: Buffer.from(answer, "utf8"), name: input.attachmentName }]
      : []),
    ...extractedFiles,
  ];
  const surveyMessages = surveyOutputs.surveys.flatMap((survey) =>
    formatAgentSurveyMessages({
      agent: input.agent,
      survey,
      response: { kind: "followup" },
    }),
  );

  return { answer, description, files, surveyMessages, clipped };
}
