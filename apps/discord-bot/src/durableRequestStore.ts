import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const DEFAULT_QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_QUEUE_MAX_REQUESTS = 1_000;
const DEFAULT_QUEUE_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_QUEUE_MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export const durableDiscordRequestSchema = z.object({
  version: z.literal(1),
  requestId: z.string().trim().regex(/^[a-zA-Z0-9._:-]{1,160}$/),
  channelId: z.string().min(1),
  userId: z.string().min(1),
  content: z.string(),
  roleIds: z.array(z.string()),
  authorBot: z.boolean().optional(),
  messageId: z.string().min(1).optional(),
  relayRequest: z.boolean().optional(),
  createdAt: z.string().datetime({ offset: true }),
}).passthrough();

export type DurableDiscordRequest = z.infer<typeof durableDiscordRequestSchema>;

export interface DurableDiscordRequestStoreOptions {
  ttlMs?: number;
  maxRequests?: number;
  maxBytes?: number;
  maxRequestBytes?: number;
  now?: () => number;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function validRequestId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(normalized)) {
    throw new Error("Durable Discord request ID contains unsupported characters.");
  }
  return normalized;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function ensurePrivateDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  await chmod(directoryPath, 0o700);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await ensurePrivateDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function defaultDurableDiscordRequestRoot(): string {
  return path.resolve(process.env.CONNECT_DISCORD_QUEUE_ROOT ?? ".connect/discord-queue");
}

export function createDurableDiscordRequestStore(
  rootPath = defaultDurableDiscordRequestRoot(),
  options: DurableDiscordRequestStoreOptions = {},
) {
  const root = path.resolve(rootPath);
  const deadLetterRoot = path.join(root, "dead-letter");
  const ttlMs = options.ttlMs ?? nonNegativeInteger(
    process.env.CONNECT_DISCORD_QUEUE_TTL_MS,
    DEFAULT_QUEUE_TTL_MS,
  );
  const maxRequests = options.maxRequests ?? nonNegativeInteger(
    process.env.CONNECT_DISCORD_QUEUE_MAX_REQUESTS,
    DEFAULT_QUEUE_MAX_REQUESTS,
  );
  const maxBytes = options.maxBytes ?? nonNegativeInteger(
    process.env.CONNECT_DISCORD_QUEUE_MAX_BYTES,
    DEFAULT_QUEUE_MAX_BYTES,
  );
  const maxRequestBytes = options.maxRequestBytes ?? nonNegativeInteger(
    process.env.CONNECT_DISCORD_QUEUE_MAX_REQUEST_BYTES,
    DEFAULT_QUEUE_MAX_REQUEST_BYTES,
  );
  const now = options.now ?? Date.now;

  function requestPath(requestId: string): string {
    return path.join(root, `${validRequestId(requestId)}.json`);
  }

  async function quarantineInvalidFile(filePath: string, error: unknown): Promise<void> {
    await ensurePrivateDirectory(deadLetterRoot);
    const destinationPath = path.join(
      deadLetterRoot,
      `${Date.now()}-${path.basename(filePath, ".json")}-${randomUUID()}.json`,
    );

    try {
      await rename(filePath, destinationPath);
    } catch (renameError) {
      if (isMissing(renameError)) {
        return;
      }
      throw renameError;
    }

    await chmod(destinationPath, 0o600);
    const message = error instanceof Error ? error.message : String(error);
    await writeJsonAtomic(`${destinationPath}.error.json`, {
      movedAt: new Date(now()).toISOString(),
      source: path.basename(filePath),
      error: message,
    });
    console.error(`Durable Discord request moved to dead-letter: ${path.basename(filePath)}: ${message}`);
  }

  async function listRequests(): Promise<DurableDiscordRequest[]> {
    await ensurePrivateDirectory(root);
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }

    const requests = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map(async (entry) => {
      const filePath = path.join(root, entry);
      try {
        const parsed = durableDiscordRequestSchema.safeParse(JSON.parse(await readFile(filePath, "utf8")));
        if (!parsed.success) {
          await quarantineInvalidFile(filePath, parsed.error);
          return null;
        }
        if (ttlMs > 0 && now() - Date.parse(parsed.data.createdAt) > ttlMs) {
          await rm(filePath, { force: true });
          console.warn(`Expired durable Discord request removed: ${parsed.data.requestId}`);
          return null;
        }
        await chmod(filePath, 0o600);
        return parsed.data;
      } catch (error) {
        await quarantineInvalidFile(filePath, error);
        return null;
      }
    }));

    return requests
      .filter((request): request is DurableDiscordRequest => request !== null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  return {
    rootPath: root,
    async enqueue(input: {
      requestId?: string;
      channelId: string;
      userId: string;
      content: string;
      roleIds: string[];
      authorBot?: boolean;
      messageId?: string;
      relayRequest?: boolean;
      createdAt?: string;
    }): Promise<DurableDiscordRequest> {
      await ensurePrivateDirectory(root);
      const request = durableDiscordRequestSchema.parse({
        version: 1,
        requestId: validRequestId(input.requestId ?? randomUUID()),
        channelId: input.channelId,
        userId: input.userId,
        content: input.content,
        roleIds: [...input.roleIds],
        ...(input.authorBot ? { authorBot: true } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
        ...(input.relayRequest ? { relayRequest: true } : {}),
        createdAt: input.createdAt ?? new Date(now()).toISOString(),
      });
      const filePath = requestPath(request.requestId);

      try {
        const existing = durableDiscordRequestSchema.safeParse(JSON.parse(await readFile(filePath, "utf8")));
        if (existing.success) {
          await chmod(filePath, 0o600);
          return existing.data;
        }
        await quarantineInvalidFile(filePath, existing.error);
      } catch (error) {
        if (!isMissing(error)) {
          await quarantineInvalidFile(filePath, error);
        }
      }

      const encodedRequest = `${JSON.stringify(request, null, 2)}\n`;
      const requestBytes = Buffer.byteLength(encodedRequest);
      if (maxRequestBytes > 0 && requestBytes > maxRequestBytes) {
        throw new Error(`Durable Discord request exceeds ${maxRequestBytes} bytes.`);
      }

      const existingRequests = await listRequests();
      if (maxRequests > 0 && existingRequests.length >= maxRequests) {
        throw new Error(`Durable Discord queue reached its ${maxRequests} request limit.`);
      }
      if (maxBytes > 0) {
        const sizes = await Promise.all(existingRequests.map(async (existing) =>
          (await stat(requestPath(existing.requestId))).size));
        const usedBytes = sizes.reduce((total, size) => total + size, 0);
        if (usedBytes + requestBytes > maxBytes) {
          throw new Error(`Durable Discord queue exceeds its ${maxBytes} byte limit.`);
        }
      }

      await writeJsonAtomic(filePath, request);
      return request;
    },
    list: listRequests,
    async remove(requestId: string): Promise<void> {
      await rm(requestPath(requestId), { force: true });
    },
  };
}

export type DurableDiscordRequestStore = ReturnType<typeof createDurableDiscordRequestStore>;
