export function formatCommandAck(input: {
  computerDisplayName: string;
  workspaceDisplayName: string;
  cwd: string;
  command: string;
}): string {
  return [
    `Target: ${input.computerDisplayName} / ${input.workspaceDisplayName}`,
    `cwd: ${input.cwd}`,
    `command: ${input.command}`,
    "state: queued",
  ].join("\n");
}

export function formatDenied(reason: string): string {
  return `Permission denied: ${reason}`;
}
