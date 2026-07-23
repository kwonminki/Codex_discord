const DEFAULT_MESSAGE_CONTENT_LENGTH = 1_900;
const DEFAULT_SPLIT_CONTENT_LENGTH = 1_800;

function findNaturalMessageSplit(value: string, maxLength: number): number {
  const minimumUsefulSplit = Math.floor(maxLength * 0.4);
  const candidates = [
    value.lastIndexOf("\n\n", maxLength),
    value.lastIndexOf("\n", maxLength),
    value.lastIndexOf(" ", maxLength),
  ];

  return candidates.find((candidate) => candidate >= minimumUsefulSplit) ?? maxLength;
}

function splitRawDiscordContent(value: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = value.trim();

  while (remaining.length > maxLength) {
    const splitIndex = findNaturalMessageSplit(remaining, maxLength);
    const chunk = remaining.slice(0, splitIndex).trimEnd();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function nextFenceLanguage(value: string, currentLanguage: string | null): string | null {
  const fencePattern = /(?:^|\n)```([^\n`]*)/g;
  let nextLanguage = currentLanguage;

  for (const match of value.matchAll(fencePattern)) {
    nextLanguage = nextLanguage === null ? (match[1]?.trim().slice(0, 32) ?? "") : null;
  }

  return nextLanguage;
}

export function splitDiscordMessageContent(
  value: string,
  maxLength = DEFAULT_MESSAGE_CONTENT_LENGTH,
): string[] {
  const sanitized = value.replace(/@/g, "[at]").trim();

  if (sanitized.length <= maxLength) {
    return sanitized.length > 0 ? [sanitized] : [];
  }

  const rawChunkLength = Math.max(
    1,
    Math.min(DEFAULT_SPLIT_CONTENT_LENGTH, maxLength - 64),
  );
  const rawChunks = splitRawDiscordContent(sanitized, rawChunkLength);
  const chunks: string[] = [];
  let activeFenceLanguage: string | null = null;

  for (const rawChunk of rawChunks) {
    const openingFence = activeFenceLanguage === null ? "" : `\`\`\`${activeFenceLanguage}\n`;
    const nextLanguage = nextFenceLanguage(rawChunk, activeFenceLanguage);
    const closingFence = nextLanguage === null ? "" : "\n```";
    chunks.push(`${openingFence}${rawChunk}${closingFence}`);
    activeFenceLanguage = nextLanguage;
  }

  return chunks;
}
