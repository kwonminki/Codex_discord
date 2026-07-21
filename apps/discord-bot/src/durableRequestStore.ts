import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DurableDiscordRequest {
  version: 1;
  requestId: string;
  channelId: string;
  userId: string;
  content: string;
  roleIds: string[];
  createdAt: string;
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

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function defaultDurableDiscordRequestRoot(): string {
  return path.resolve(process.env.CONNECT_DISCORD_QUEUE_ROOT ?? ".connect/discord-queue");
}

export function createDurableDiscordRequestStore(rootPath = defaultDurableDiscordRequestRoot()) {
  const root = path.resolve(rootPath);

  function requestPath(requestId: string): string {
    return path.join(root, `${validRequestId(requestId)}.json`);
  }

  return {
    rootPath: root,
    async enqueue(input: {
      requestId?: string;
      channelId: string;
      userId: string;
      content: string;
      roleIds: string[];
      createdAt?: string;
    }): Promise<DurableDiscordRequest> {
      const request: DurableDiscordRequest = {
        version: 1,
        requestId: validRequestId(input.requestId ?? randomUUID()),
        channelId: input.channelId,
        userId: input.userId,
        content: input.content,
        roleIds: [...input.roleIds],
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      const filePath = requestPath(request.requestId);

      try {
        const existing = JSON.parse(await readFile(filePath, "utf8")) as DurableDiscordRequest;
        return existing;
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }

      await writeJsonAtomic(filePath, request);
      return request;
    },
    async list(): Promise<DurableDiscordRequest[]> {
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
        try {
          return JSON.parse(await readFile(path.join(root, entry), "utf8")) as DurableDiscordRequest;
        } catch {
          return null;
        }
      }));

      return requests
        .filter((request): request is DurableDiscordRequest => Boolean(request?.requestId && request.channelId))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    async remove(requestId: string): Promise<void> {
      await rm(requestPath(requestId), { force: true });
    },
  };
}

export type DurableDiscordRequestStore = ReturnType<typeof createDurableDiscordRequestStore>;
