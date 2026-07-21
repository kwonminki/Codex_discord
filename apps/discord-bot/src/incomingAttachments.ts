import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_INCOMING_ATTACHMENT_MAX_FILES = 10;
export const DEFAULT_INCOMING_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
export const DEFAULT_INCOMING_ATTACHMENT_TOTAL_MAX_BYTES = 250 * 1024 * 1024;
export const DEFAULT_INCOMING_ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const ALLOWED_DISCORD_ATTACHMENT_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);

export interface DiscordIncomingAttachment {
  id: string;
  name: string;
  url: string;
  contentType: string | null;
  size: number;
}

export interface MaterializedDiscordAttachment {
  name: string;
  localPath: string;
  contentType: string | null;
  size: number;
}

export interface IncomingAttachmentStoreOptions {
  rootPath?: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function environmentInteger(name: string): number | undefined {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function safePathSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
  return normalized && normalized !== "." && normalized !== ".." ? normalized : fallback;
}

function safeAttachmentName(value: string): string {
  const baseName = path.basename(value.trim() || "attachment");
  const sanitized = baseName
    .replace(/[\u0000-\u001f\u007f/\\:]/g, "_")
    .replace(/^\.+$/, "attachment")
    .slice(0, 180);

  return sanitized || "attachment";
}

function discordAttachmentUrl(value: string): URL {
  const url = new URL(value);

  if (url.protocol !== "https:" || !ALLOWED_DISCORD_ATTACHMENT_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Discord attachment URL uses an unsupported host.");
  }

  return url;
}

export function defaultIncomingAttachmentRoot(): string {
  const configuredRoot = process.env.CONNECT_INCOMING_ATTACHMENT_ROOT?.trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  const queueRoot = path.resolve(process.env.CONNECT_DISCORD_QUEUE_ROOT ?? ".connect/discord-queue");
  return path.join(path.dirname(queueRoot), "incoming-attachments");
}

export function appendDiscordAttachmentsToPrompt(
  content: string,
  attachments: MaterializedDiscordAttachment[],
): string {
  if (attachments.length === 0) {
    return content;
  }

  const prompt = content.trim() || "첨부된 파일을 확인해 주세요.";
  const metadata = attachments.map((attachment) => ({
    name: attachment.name,
    localPath: attachment.localPath,
    contentType: attachment.contentType,
    sizeBytes: attachment.size,
  }));

  return [
    prompt,
    "",
    "Discord 사용자가 첨부한 파일을 이 컴퓨터에 저장했습니다.",
    "아래 localPath의 파일을 직접 열어 확인하고, 원래 파일명과 MIME type을 참고하세요.",
    JSON.stringify(metadata, null, 2),
  ].join("\n");
}

export function createIncomingAttachmentStore(options: IncomingAttachmentStoreOptions = {}) {
  const rootPath = path.resolve(options.rootPath ?? defaultIncomingAttachmentRoot());
  const maxFiles = positiveInteger(
    options.maxFiles ?? environmentInteger("CONNECT_INCOMING_ATTACHMENT_MAX_FILES"),
    DEFAULT_INCOMING_ATTACHMENT_MAX_FILES,
  );
  const maxBytesPerFile = positiveInteger(
    options.maxBytesPerFile ?? environmentInteger("CONNECT_INCOMING_ATTACHMENT_MAX_BYTES"),
    DEFAULT_INCOMING_ATTACHMENT_MAX_BYTES,
  );
  const maxTotalBytes = positiveInteger(
    options.maxTotalBytes ?? environmentInteger("CONNECT_INCOMING_ATTACHMENT_TOTAL_MAX_BYTES"),
    DEFAULT_INCOMING_ATTACHMENT_TOTAL_MAX_BYTES,
  );
  const ttlMs = positiveInteger(
    options.ttlMs ?? environmentInteger("CONNECT_INCOMING_ATTACHMENT_TTL_MS"),
    DEFAULT_INCOMING_ATTACHMENT_TTL_MS,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let lastCleanupAt = 0;

  async function cleanupExpired(): Promise<void> {
    const currentTime = now();
    if (currentTime - lastCleanupAt < Math.min(ttlMs, 60 * 60 * 1_000)) {
      return;
    }
    lastCleanupAt = currentTime;

    let entries;
    try {
      entries = await readdir(rootPath, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const directoryPath = path.join(rootPath, entry.name);
      const directoryStat = await stat(directoryPath);
      if (currentTime - directoryStat.mtimeMs >= ttlMs) {
        await rm(directoryPath, { recursive: true, force: true });
      }
    }));
  }

  async function downloadOne(
    directoryPath: string,
    attachment: DiscordIncomingAttachment,
    alreadyDownloadedBytes: number,
  ): Promise<MaterializedDiscordAttachment> {
    if (!Number.isFinite(attachment.size) || attachment.size < 0) {
      throw new Error(`첨부파일 크기가 올바르지 않습니다: ${attachment.name}`);
    }
    if (attachment.size > maxBytesPerFile) {
      throw new Error(`첨부파일이 개별 크기 제한을 초과했습니다: ${attachment.name}`);
    }
    if (alreadyDownloadedBytes + attachment.size > maxTotalBytes) {
      throw new Error("첨부파일 총용량 제한을 초과했습니다.");
    }

    const url = discordAttachmentUrl(attachment.url);
    const safeName = safeAttachmentName(attachment.name);
    const attachmentId = safePathSegment(attachment.id, randomUUID());
    const filePath = path.join(directoryPath, `${attachmentId}-${safeName}`);

    try {
      const existing = await stat(filePath);
      if (existing.isFile()) {
        if (existing.size > maxBytesPerFile) {
          throw new Error(`첨부파일이 개별 크기 제한을 초과했습니다: ${attachment.name}`);
        }
        if (alreadyDownloadedBytes + existing.size > maxTotalBytes) {
          throw new Error("첨부파일 총용량 제한을 초과했습니다.");
        }
        return {
          name: attachment.name || safeName,
          localPath: filePath,
          contentType: attachment.contentType,
          size: existing.size,
        };
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }

    const response = await fetchImpl(url, { redirect: "error" });
    if (!response.ok || !response.body) {
      throw new Error(`Discord 첨부파일 다운로드에 실패했습니다: ${attachment.name} (HTTP ${response.status})`);
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytesPerFile) {
      throw new Error(`첨부파일이 개별 크기 제한을 초과했습니다: ${attachment.name}`);
    }
    if (Number.isFinite(contentLength) && alreadyDownloadedBytes + contentLength > maxTotalBytes) {
      throw new Error("첨부파일 총용량 제한을 초과했습니다.");
    }

    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const file = await open(temporaryPath, "wx", 0o600);
    let downloadedBytes = 0;

    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        downloadedBytes += chunk.byteLength;
        if (downloadedBytes > maxBytesPerFile) {
          throw new Error(`첨부파일이 개별 크기 제한을 초과했습니다: ${attachment.name}`);
        }
        if (alreadyDownloadedBytes + downloadedBytes > maxTotalBytes) {
          throw new Error("첨부파일 총용량 제한을 초과했습니다.");
        }
        let offset = 0;
        while (offset < chunk.byteLength) {
          const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset, null);
          if (bytesWritten <= 0) {
            throw new Error(`첨부파일 저장이 중단되었습니다: ${attachment.name}`);
          }
          offset += bytesWritten;
        }
      }
      await file.close();
      await rename(temporaryPath, filePath);
    } catch (error) {
      await file.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      name: attachment.name || safeName,
      localPath: filePath,
      contentType: attachment.contentType,
      size: downloadedBytes,
    };
  }

  return {
    rootPath,
    async materialize(input: {
      messageId: string;
      attachments: DiscordIncomingAttachment[];
    }): Promise<MaterializedDiscordAttachment[]> {
      if (input.attachments.length === 0) {
        return [];
      }
      if (input.attachments.length > maxFiles) {
        throw new Error(`한 메시지에서 첨부할 수 있는 파일은 최대 ${maxFiles}개입니다.`);
      }

      await cleanupExpired();
      const messageDirectory = safePathSegment(input.messageId, randomUUID());
      const directoryPath = path.join(rootPath, messageDirectory);
      await mkdir(directoryPath, { recursive: true, mode: 0o700 });
      await chmod(directoryPath, 0o700);

      const materialized: MaterializedDiscordAttachment[] = [];
      let totalBytes = 0;
      for (const attachment of input.attachments) {
        const downloaded = await downloadOne(directoryPath, attachment, totalBytes);
        totalBytes += downloaded.size;
        if (totalBytes > maxTotalBytes) {
          throw new Error("첨부파일 총용량 제한을 초과했습니다.");
        }
        materialized.push(downloaded);
      }

      return materialized;
    },
  };
}

export type IncomingAttachmentStore = ReturnType<typeof createIncomingAttachmentStore>;
