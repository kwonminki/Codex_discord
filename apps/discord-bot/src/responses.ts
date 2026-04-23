const COLORS = {
  queued: 0xf1c40f,
  codex: 0x3498db,
  neutral: 0x95a5a6,
  success: 0x2ecc71,
  failure: 0xe74c3c,
} as const;

const MAX_FIELD_VALUE_LENGTH = 1_024;
const MAX_EMBED_DESCRIPTION_LENGTH = 4_096;

export interface DiscordEmbedFieldPayload {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedPayload {
  title: string;
  color: number;
  description?: string;
  fields?: DiscordEmbedFieldPayload[];
}

export interface DiscordMessagePayload {
  allowedMentions: {
    parse: [];
  };
  embeds: DiscordEmbedPayload[];
}

function sanitizeInlineDiscordText(value: string): string {
  return value.replace(/\r?\n+/g, " ").replace(/`/g, "'").replace(/@/g, "[at]");
}

function sanitizeBlockDiscordText(value: string): string {
  return value.replace(/```/g, "'''").replace(/`/g, "'").replace(/@/g, "[at]").trimEnd();
}

function sanitizeDiscordMarkdown(value: string): string {
  return value.replace(/@/g, "[at]").trimEnd();
}

function wrapDiscordText(value: string): string {
  return `\`${sanitizeInlineDiscordText(value)}\``;
}

function truncateFieldValue(value: string): string {
  if (value.length <= MAX_FIELD_VALUE_LENGTH) {
    return value;
  }

  const suffix = "\n... (truncated)";
  return `${value.slice(0, MAX_FIELD_VALUE_LENGTH - suffix.length)}${suffix}`;
}

function truncateDescription(value: string): string {
  if (value.length <= MAX_EMBED_DESCRIPTION_LENGTH) {
    return value;
  }

  const suffix = "\n\n... (truncated)";
  return `${value.slice(0, MAX_EMBED_DESCRIPTION_LENGTH - suffix.length)}${suffix}`;
}

function codeBlock(value: string, language: string): string {
  const sanitizedValue = sanitizeBlockDiscordText(value);
  const body = sanitizedValue.length > 0 ? sanitizedValue : "(no output)";
  const fence = `\`\`\`${language}\n`;
  const closingFence = "\n```";
  const availableBodyLength = MAX_FIELD_VALUE_LENGTH - fence.length - closingFence.length;
  const truncatedBody =
    body.length <= availableBodyLength
      ? body
      : `${body.slice(0, availableBodyLength - "\n... (truncated)".length)}\n... (truncated)`;

  return `${fence}${truncatedBody}${closingFence}`;
}

function messagePayload(embed: DiscordEmbedPayload): DiscordMessagePayload {
  return {
    allowedMentions: { parse: [] },
    embeds: [embed],
  };
}

export function formatCommandAck(input: {
  computerDisplayName: string;
  workspaceDisplayName: string;
  cwd: string;
  command: string;
}): DiscordMessagePayload {
  return messagePayload({
    title: "Command queued",
    color: COLORS.queued,
    fields: [
      ...formatCommandHeaderFields(input.cwd, input),
      {
        name: "Status",
        value: wrapDiscordText("queued"),
        inline: true,
      },
    ],
  });
}

function formatCommandHeaderFields(
  cwd: string,
  input: {
    computerDisplayName: string;
    workspaceDisplayName: string;
    command: string;
  },
): DiscordEmbedFieldPayload[] {
  return [
    {
      name: "Target",
      value: `${wrapDiscordText(input.computerDisplayName)} / ${wrapDiscordText(input.workspaceDisplayName)}`,
      inline: false,
    },
    {
      name: "Working directory",
      value: wrapDiscordText(cwd),
      inline: false,
    },
    {
      name: "Command",
      value: codeBlock(input.command, "bash"),
      inline: false,
    },
  ];
}

export function formatDenied(reason: string): DiscordMessagePayload {
  return messagePayload({
    title: "Permission denied",
    color: COLORS.failure,
    description: truncateFieldValue(wrapDiscordText(reason)),
  });
}

export function formatHelp(channelMode: "shell-admin" | "session-linked"): DiscordMessagePayload {
  const shellAdminFields: DiscordEmbedFieldPayload[] = [
    {
      name: "Sync Codex sessions",
      value: codeBlock("sync\ncodex sync 10\nsync delete preview\nsync delete all confirm", "text"),
      inline: false,
    },
    {
      name: "Ask Codex",
      value: codeBlock("codex 이 프로젝트 구조 설명해줘\ncodex README에 사용법 추가해줘", "text"),
      inline: false,
    },
    {
      name: "Run shell commands",
      value: codeBlock("ls\npwd\ncd apps\ncat README.md", "bash"),
      inline: false,
    },
    {
      name: "Dangerous commands",
      value: codeBlock("confirm rm path/to/file", "bash"),
      inline: false,
    },
  ];
  const sessionLinkedFields: DiscordEmbedFieldPayload[] = [
    {
      name: "Ask Codex",
      value: codeBlock("그 파일 구조 설명해줘\n이 버그 고쳐줘\n테스트까지 돌려줘", "text"),
      inline: false,
    },
    {
      name: "Run shell commands",
      value: codeBlock("!ls\n!pwd\n!cd apps\n!cat README.md", "bash"),
      inline: false,
    },
  ];

  return messagePayload({
    title: "How to use this Codex channel",
    color: COLORS.neutral,
    description:
      channelMode === "shell-admin"
        ? "이 채널은 shell 명령과 Codex 요청을 같이 받을 수 있습니다."
        : "이 채널은 자연어를 Codex로 보내고, shell 명령은 `!` 접두어로 실행합니다.",
    fields: channelMode === "shell-admin" ? shellAdminFields : sessionLinkedFields,
  });
}

export function formatSyncAck(input: { limit: number }): DiscordMessagePayload {
  return messagePayload({
    title: "Codex session sync started",
    color: COLORS.codex,
    description: "Codex 세션을 읽고 Discord 카테고리/채널을 생성하는 중입니다.",
    fields: [
      {
        name: "Session limit",
        value: wrapDiscordText(String(input.limit)),
        inline: true,
      },
    ],
  });
}

export function formatSyncResultUpdate(response: {
  result?: {
    createdCategories: number;
    existingCategories: number;
    createdChannels: number;
    existingChannels: number;
    skippedSessions: number;
  };
  error?: { message: string };
}): DiscordMessagePayload {
  if (response.error || !response.result) {
    return messagePayload({
      title: "Codex session sync failed",
      color: COLORS.failure,
      description: truncateDescription(wrapDiscordText(response.error?.message ?? "Unknown sync failure")),
    });
  }

  return messagePayload({
    title: "Codex session sync complete",
    color: COLORS.success,
    description: "Codex 폴더는 Discord 카테고리로, Codex 세션은 Discord 채널로 매핑되었습니다.",
    fields: [
      {
        name: "Created categories",
        value: wrapDiscordText(String(response.result.createdCategories)),
        inline: true,
      },
      {
        name: "Existing categories",
        value: wrapDiscordText(String(response.result.existingCategories)),
        inline: true,
      },
      {
        name: "Created channels",
        value: wrapDiscordText(String(response.result.createdChannels)),
        inline: true,
      },
      {
        name: "Existing channels",
        value: wrapDiscordText(String(response.result.existingChannels)),
        inline: true,
      },
      {
        name: "Skipped sessions",
        value: wrapDiscordText(String(response.result.skippedSessions)),
        inline: true,
      },
    ],
  });
}

export function formatDeletePreview(input: {
  mode: "all" | "channels";
  channelCount: number;
  categoryCount: number;
  channelNames: string[];
  categoryNames: string[];
}): DiscordMessagePayload {
  const command = input.mode === "channels" ? "sync delete channels confirm" : "sync delete all confirm";

  return messagePayload({
    title: "Synced channel delete preview",
    color: COLORS.queued,
    description: `삭제될 Discord 리소스를 확인하세요. 실제 삭제는 \`${command}\` 명령이 필요합니다. Codex 세션 파일은 삭제하지 않습니다.`,
    fields: [
      {
        name: "Channels",
        value: wrapDiscordText(String(input.channelCount)),
        inline: true,
      },
      {
        name: "Categories",
        value: wrapDiscordText(String(input.categoryCount)),
        inline: true,
      },
      {
        name: "Channel names",
        value: codeBlock(input.channelNames.slice(0, 25).join("\n") || "(none)", "text"),
        inline: false,
      },
      {
        name: "Category names",
        value: codeBlock(input.categoryNames.slice(0, 25).join("\n") || "(none)", "text"),
        inline: false,
      },
    ],
  });
}

export function formatDeleteResult(response: {
  result?: {
    mode: "all" | "channels";
    deletedChannels: number;
    deletedCategories: number;
    missingChannels: number;
    missingCategories: number;
  };
  error?: { message: string };
}): DiscordMessagePayload {
  if (response.error || !response.result) {
    return messagePayload({
      title: "Synced channel delete failed",
      color: COLORS.failure,
      description: truncateDescription(wrapDiscordText(response.error?.message ?? "Unknown delete failure")),
    });
  }

  return messagePayload({
    title: "Synced channels deleted",
    color: COLORS.success,
    description: "Discord에 생성했던 동기화 채널을 삭제했습니다. 로컬 Codex 세션 파일은 그대로 유지됩니다.",
    fields: [
      {
        name: "Deleted channels",
        value: wrapDiscordText(String(response.result.deletedChannels)),
        inline: true,
      },
      {
        name: "Deleted categories",
        value: wrapDiscordText(String(response.result.deletedCategories)),
        inline: true,
      },
      {
        name: "Already missing channels",
        value: wrapDiscordText(String(response.result.missingChannels)),
        inline: true,
      },
      {
        name: "Already missing categories",
        value: wrapDiscordText(String(response.result.missingCategories)),
        inline: true,
      },
    ],
  });
}

export function formatDeleteAck(input: { mode: "all" | "channels" }): DiscordMessagePayload {
  return messagePayload({
    title: "Deleting synced channels",
    color: COLORS.queued,
    description:
      input.mode === "all"
        ? "동기화로 생성된 Discord 채널과 카테고리를 삭제하는 중입니다. Codex 세션 파일은 삭제하지 않습니다."
        : "동기화로 생성된 Discord 채널만 삭제하는 중입니다. 카테고리와 Codex 세션 파일은 유지합니다.",
    fields: [
      {
        name: "Mode",
        value: wrapDiscordText(input.mode),
        inline: true,
      },
    ],
  });
}

export function formatCodexAck(input: {
  computerDisplayName: string;
  workspaceDisplayName: string;
  cwd: string;
  prompt: string;
}): DiscordMessagePayload {
  return messagePayload({
    title: "Codex is working",
    color: COLORS.codex,
    fields: [
      {
        name: "Target",
        value: `${wrapDiscordText(input.computerDisplayName)} / ${wrapDiscordText(input.workspaceDisplayName)}`,
        inline: false,
      },
      {
        name: "Working directory",
        value: wrapDiscordText(input.cwd),
        inline: false,
      },
      {
        name: "Prompt",
        value: codeBlock(input.prompt, "text"),
        inline: false,
      },
      {
        name: "Status",
        value: wrapDiscordText("thinking"),
        inline: true,
      },
    ],
  });
}

function getResultDetails(response: {
  result?: unknown;
  error?: { message: string };
}): {
  title: string;
  color: number;
  status: string;
  exitCode: string;
  stdout: string;
  stderr: string;
  cwd: string | null;
} {
  if (response.error) {
    return {
      title: "Command failed",
      color: COLORS.failure,
      status: "failed",
      exitCode: "",
      stdout: "",
      stderr: response.error.message,
      cwd: null,
    };
  }

  const result = response.result as {
    status?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
    cwd?: unknown;
  };
  const status = String(result.status ?? "unknown");
  const exitCode = String(result.exitCode ?? "");
  const failed = status === "failed" || (typeof result.exitCode === "number" && result.exitCode !== 0);

  return {
    title: failed ? "Command failed" : "Command completed",
    color: failed ? COLORS.failure : COLORS.success,
    status,
    exitCode,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    cwd: typeof result.cwd === "string" && result.cwd.length > 0 ? result.cwd : null,
  };
}

export function formatCommandResultUpdate(
  input: {
    computerDisplayName: string;
    workspaceDisplayName: string;
    cwd: string;
    command: string;
  },
  response: {
    result?: unknown;
    error?: { message: string };
  },
): DiscordMessagePayload {
  const result = getResultDetails(response);
  const outputFields: DiscordEmbedFieldPayload[] = [];

  if (result.stdout.trimEnd().length > 0) {
    outputFields.push({
      name: "Output",
      value: codeBlock(result.stdout, "text"),
      inline: false,
    });
  } else if (result.stderr.trimEnd().length === 0) {
    outputFields.push({
      name: "Output",
      value: wrapDiscordText("No output"),
      inline: false,
    });
  }

  if (result.stderr.trimEnd().length > 0) {
    outputFields.push({
      name: "Errors",
      value: codeBlock(result.stderr, "text"),
      inline: false,
    });
  }

  return messagePayload({
    title: result.title,
    color: result.color,
    fields: [
      ...formatCommandHeaderFields(result.cwd ?? input.cwd, input),
      {
        name: "Status",
        value: wrapDiscordText(result.status),
        inline: true,
      },
      {
        name: "Exit code",
        value: wrapDiscordText(result.exitCode),
        inline: true,
      },
      ...outputFields,
    ],
  });
}

export function formatCommandResult(response: {
  result?: unknown;
  error?: { message: string };
}): DiscordMessagePayload {
  return formatCommandResultUpdate(
    {
      computerDisplayName: "Unknown computer",
      workspaceDisplayName: "Unknown workspace",
      cwd: "Unknown directory",
      command: "Unknown command",
    },
    response,
  );
}

export function formatCodexResultUpdate(
  input: {
    computerDisplayName: string;
    workspaceDisplayName: string;
    cwd: string;
    prompt: string;
  },
  response: {
    result?: unknown;
    error?: { message: string };
  },
): DiscordMessagePayload {
  const result = response.result as {
    status?: unknown;
    finalMessage?: unknown;
    sessionId?: unknown;
    stderr?: unknown;
  } | undefined;
  const failed = Boolean(response.error) || result?.status === "failed";
  const finalMessage = response.error?.message ?? String(result?.finalMessage ?? result?.stderr ?? "Codex did not return a final message.");
  const sessionId = typeof result?.sessionId === "string" && result.sessionId.length > 0 ? result.sessionId : null;
  const fields: DiscordEmbedFieldPayload[] = [
    {
      name: "Target",
      value: `${wrapDiscordText(input.computerDisplayName)} / ${wrapDiscordText(input.workspaceDisplayName)}`,
      inline: false,
    },
    {
      name: "Working directory",
      value: wrapDiscordText(input.cwd),
      inline: false,
    },
    {
      name: "Prompt",
      value: codeBlock(input.prompt, "text"),
      inline: false,
    },
    {
      name: "Status",
      value: wrapDiscordText(failed ? "failed" : String(result?.status ?? "completed")),
      inline: true,
    },
  ];

  if (sessionId) {
    fields.push({
      name: "Session",
      value: wrapDiscordText(sessionId),
      inline: true,
    });
  }

  return messagePayload({
    title: failed ? "Codex failed" : "Codex replied",
    color: failed ? COLORS.failure : COLORS.success,
    description: truncateDescription(sanitizeDiscordMarkdown(finalMessage)),
    fields,
  });
}
