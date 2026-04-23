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
  return [
    `Target: ${wrapDiscordText(input.computerDisplayName)} / ${wrapDiscordText(input.workspaceDisplayName)}`,
    `cwd: ${wrapDiscordText(input.cwd)}`,
    `command: ${wrapDiscordText(input.command)}`,
    "state: queued",
  ].join("\n");
}

export function formatDenied(reason: string): string {
  return `Permission denied: ${wrapDiscordText(reason)}`;
}
