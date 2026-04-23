const COLORS = {
  queued: 0xf1c40f,
  success: 0x2ecc71,
  failure: 0xe74c3c,
} as const;

const MAX_FIELD_VALUE_LENGTH = 1_024;

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
