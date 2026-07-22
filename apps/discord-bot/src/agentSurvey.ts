const MAX_AGENT_SURVEYS = 5;
const MAX_SURVEY_OPTIONS = 25;
const MAX_SURVEY_LABEL_LENGTH = 90;
const MAX_SURVEY_DESCRIPTION_LENGTH = 100;

export interface AgentSurveyOption {
  label: string;
  description?: string;
}

export interface AgentSurveyRequest {
  question: string;
  message: string | null;
  files: unknown[];
  options: AgentSurveyOption[];
  multiple: boolean;
}

export interface ExtractAgentSurveyResult {
  cleanedText: string;
  surveys: AgentSurveyRequest[];
  notices: string[];
  hadBlocks: boolean;
}

function fileReferences(record: Record<string, unknown>): unknown[] {
  const values = [record.files, record.attachments, record.file].filter((value) => value !== undefined);
  return values.flatMap((value) => Array.isArray(value) ? value : [value]);
}

function normalizeSurveyOptions(value: unknown): AgentSurveyOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const options: AgentSurveyOption[] = [];
  const labels = new Set<string>();

  for (const item of value) {
    const record = item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : null;
    const rawLabel = typeof item === "string" ? item : record?.label;

    if (typeof rawLabel !== "string") {
      continue;
    }

    const label = rawLabel.replace(/\s+/g, " ").trim().slice(0, MAX_SURVEY_LABEL_LENGTH);
    if (!label || labels.has(label)) {
      continue;
    }

    labels.add(label);
    const rawDescription = record?.description;
    const description = typeof rawDescription === "string"
      ? rawDescription.replace(/\s+/g, " ").trim().slice(0, MAX_SURVEY_DESCRIPTION_LENGTH)
      : "";
    options.push({ label, ...(description ? { description } : {}) });

    if (options.length >= MAX_SURVEY_OPTIONS) {
      break;
    }
  }

  return options;
}

function normalizedText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function extractAgentSurveyRequests(
  text: string,
  input: { fallbackOptions?: AgentSurveyOption[]; fallbackQuestion?: string } = {},
): ExtractAgentSurveyResult {
  const blockPattern = /```(?:codex-discord-survey|discord-survey)\s*([\s\S]*?)```/gi;
  const rawRecords: Record<string, unknown>[] = [];
  const notices: string[] = [];
  let blockCount = 0;

  for (const match of text.matchAll(blockPattern)) {
    blockCount += 1;

    if (blockCount > MAX_AGENT_SURVEYS) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse((match[1] ?? "").trim());
    } catch {
      notices.push("codex-discord-survey 블록의 JSON을 읽지 못했습니다.");
      continue;
    }

    const records = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of records) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        notices.push("codex-discord-survey 항목은 JSON object여야 합니다.");
        continue;
      }

      if (rawRecords.length < MAX_AGENT_SURVEYS) {
        rawRecords.push(item as Record<string, unknown>);
      }
    }
  }

  if (blockCount > MAX_AGENT_SURVEYS) {
    notices.push(`설문은 답변당 최대 ${MAX_AGENT_SURVEYS}개까지 표시합니다.`);
  }

  const cleanedText = text.replace(blockPattern, "").replace(/\n{3,}/g, "\n\n").trim();
  const fallbackOptions = normalizeSurveyOptions(input.fallbackOptions ?? []);
  const fallbackQuestion = normalizedText(input.fallbackQuestion) ?? normalizedText(cleanedText);
  const surveys: AgentSurveyRequest[] = [];

  for (const record of rawRecords) {
    const options = normalizeSurveyOptions(record.options);
    const resolvedOptions = options.length >= 2 ? options : fallbackOptions;

    if (resolvedOptions.length < 2) {
      notices.push("설문에는 서로 다른 선택지가 최소 2개 필요합니다.");
      continue;
    }

    const question = normalizedText(record.question) ?? fallbackQuestion ?? "선택해주세요.";
    const message = normalizedText(record.message);
    const multiple = record.multiple === true || record.allowMultiple === true || record.allow_multiselect === true;

    surveys.push({
      question,
      message,
      files: fileReferences(record),
      options: resolvedOptions,
      multiple,
    });
  }

  return {
    cleanedText,
    surveys,
    notices,
    hadBlocks: blockCount > 0,
  };
}
