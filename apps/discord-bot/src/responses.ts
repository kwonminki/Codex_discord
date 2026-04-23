function sanitizeDiscordText(value: string): string {
  return value.replace(/\r?\n+/g, " ").replace(/`/g, "'").replace(/@/g, "[at]");
}

function wrapDiscordText(value: string): string {
  return `\`${sanitizeDiscordText(value)}\``;
}

export function formatCommandAck(input: {
  computerDisplayName: string;
  workspaceDisplayName: string;
  cwd: string;
  command: string;
}): string {
  return [...formatCommandHeader(input), "state: queued"].join("\n");
}

function formatCommandHeader(input: {
  computerDisplayName: string;
  workspaceDisplayName: string;
  cwd: string;
  command: string;
}): string[] {
  return [
    `Target: ${wrapDiscordText(input.computerDisplayName)} / ${wrapDiscordText(input.workspaceDisplayName)}`,
    `cwd: ${wrapDiscordText(input.cwd)}`,
    `command: ${wrapDiscordText(input.command)}`,
  ];
}

export function formatDenied(reason: string): string {
  return `Permission denied: ${wrapDiscordText(reason)}`;
}

export function formatCommandResult(response: {
  result?: unknown;
  error?: { message: string };
}): string {
  if (response.error) {
    return `Command failed: ${wrapDiscordText(response.error.message)}`;
  }

  const result = response.result as {
    status?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
  };

  return [
    `state: ${wrapDiscordText(String(result.status ?? "unknown"))}`,
    `exit: ${wrapDiscordText(String(result.exitCode ?? ""))}`,
    `stdout: ${wrapDiscordText(String(result.stdout ?? ""))}`,
    `stderr: ${wrapDiscordText(String(result.stderr ?? ""))}`,
  ].join("\n");
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
): string {
  return [...formatCommandHeader(input), formatCommandResult(response)].join("\n");
}
