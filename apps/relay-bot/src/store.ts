import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const MAX_RELAY_ROUNDS = 100;

export const relayConversationStatusSchema = z.enum([
  "running",
  "extension-requested",
  "completed",
  "max-rounds",
  "blocked",
  "failed",
  "stopped",
  "timed-out",
]);

export type RelayConversationStatus = z.infer<typeof relayConversationStatusSchema>;

export const relayConversationSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  guildId: z.string().min(1),
  originThreadId: z.string().min(1),
  peerThreadId: z.string().min(1),
  operatorUserId: z.string().min(1),
  operatorRoleIds: z.array(z.string()),
  goal: z.string().min(1),
  maxRounds: z.number().int().min(1).max(MAX_RELAY_ROUNDS),
  timeoutAt: z.string().datetime({ offset: true }),
  status: relayConversationStatusSchema,
  currentThreadId: z.string().min(1),
  turnCount: z.number().int().nonnegative(),
  pendingRequestMessageId: z.string().nullable(),
  lastDoneThreadId: z.string().nullable(),
  lastResponse: z.string(),
  lastAgentLabel: z.string().nullable(),
  statusDetail: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  finalNoticeSentAt: z.string().datetime({ offset: true }).nullable().default(null),
});

export type RelayConversation = z.infer<typeof relayConversationSchema>;

const relayConversationFileSchema = z.object({
  version: z.literal(1),
  conversations: z.array(relayConversationSchema),
});

function occupiesRelayThreads(conversation: RelayConversation): boolean {
  return conversation.status === "running" || conversation.status === "extension-requested";
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

export function defaultRelayConversationRoot(): string {
  return path.resolve(process.env.RELAY_STATE_ROOT ?? ".connect/agent-relay");
}

export function createRelayConversationStore(rootPath = defaultRelayConversationRoot()) {
  const root = path.resolve(rootPath);
  const filePath = path.join(root, "conversations.json");
  let mutationQueue: Promise<void> = Promise.resolve();

  async function readAll(): Promise<RelayConversation[]> {
    await ensurePrivateDirectory(root);

    try {
      const parsed = relayConversationFileSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
      await chmod(filePath, 0o600);
      return parsed.conversations;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async function mutate<T>(operation: (conversations: RelayConversation[]) => Promise<{
    conversations: RelayConversation[];
    result: T;
  }> | {
    conversations: RelayConversation[];
    result: T;
  }): Promise<T> {
    let operationResult: T | undefined;
    const run = mutationQueue.then(async () => {
      const current = await readAll();
      const next = await operation(current);
      await writeJsonAtomic(filePath, { version: 1, conversations: next.conversations });
      operationResult = next.result;
    });
    mutationQueue = run.catch(() => undefined);
    await run;
    return operationResult as T;
  }

  return {
    rootPath: root,
    async list(): Promise<RelayConversation[]> {
      await mutationQueue;
      return readAll();
    },
    async create(input: Omit<RelayConversation, "version" | "id" | "createdAt" | "updatedAt">): Promise<RelayConversation> {
      return mutate((conversations) => {
        const threadIds = new Set([input.originThreadId, input.peerThreadId]);
        const overlapping = conversations.find((conversation) =>
          occupiesRelayThreads(conversation) &&
          (threadIds.has(conversation.originThreadId) || threadIds.has(conversation.peerThreadId)));
        if (overlapping) {
          throw new Error(`Agent relay thread is already active in conversation ${overlapping.id}.`);
        }
        const now = new Date().toISOString();
        const conversation = relayConversationSchema.parse({
          version: 1,
          id: randomUUID(),
          ...input,
          createdAt: now,
          updatedAt: now,
        });
        return { conversations: [...conversations, conversation], result: conversation };
      });
    },
    async update(
      conversationId: string,
      patch: Partial<Omit<RelayConversation, "version" | "id" | "createdAt">>,
    ): Promise<RelayConversation> {
      return mutate((conversations) => {
        const index = conversations.findIndex((conversation) => conversation.id === conversationId);
        if (index < 0) {
          throw new Error(`Relay conversation not found: ${conversationId}`);
        }
        const updated = relayConversationSchema.parse({
          ...conversations[index],
          ...patch,
          updatedAt: new Date().toISOString(),
        });
        const next = [...conversations];
        next[index] = updated;
        return { conversations: next, result: updated };
      });
    },
    async findActiveByThread(threadId: string): Promise<RelayConversation | null> {
      return (await this.list()).find((conversation) =>
        occupiesRelayThreads(conversation) &&
        (conversation.originThreadId === threadId || conversation.peerThreadId === threadId)) ?? null;
    },
    async claimExtension(
      conversationId: string,
      additionalRounds: number,
      minimumTimeoutAt: string,
    ): Promise<RelayConversation> {
      return mutate((conversations) => {
        const index = conversations.findIndex((conversation) => conversation.id === conversationId);
        const conversation = conversations[index];
        if (!conversation || conversation.status !== "extension-requested") {
          throw new Error("이 대화는 현재 추가 왕복 승인을 기다리고 있지 않습니다.");
        }
        const nextMaxRounds = conversation.maxRounds + additionalRounds;
        if (nextMaxRounds > MAX_RELAY_ROUNDS) {
          throw new Error(`대화당 최대 ${MAX_RELAY_ROUNDS} 왕복을 넘길 수 없습니다.`);
        }
        const updated = relayConversationSchema.parse({
          ...conversation,
          status: "running",
          statusDetail: null,
          maxRounds: nextMaxRounds,
          pendingRequestMessageId: null,
          lastDoneThreadId: null,
          completedAt: null,
          timeoutAt: new Date(Math.max(
            Date.parse(conversation.timeoutAt),
            Date.parse(minimumTimeoutAt),
          )).toISOString(),
          updatedAt: new Date().toISOString(),
        });
        const next = [...conversations];
        next[index] = updated;
        return { conversations: next, result: updated };
      });
    },
    async findLatestByThread(threadId: string): Promise<RelayConversation | null> {
      return (await this.list())
        .filter((conversation) =>
          conversation.originThreadId === threadId || conversation.peerThreadId === threadId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
    },
    async findPendingByRequest(requestMessageId: string): Promise<RelayConversation | null> {
      return (await this.list()).find((conversation) =>
        conversation.status === "running" && conversation.pendingRequestMessageId === requestMessageId) ?? null;
    },
    async listPendingFinalNotices(): Promise<RelayConversation[]> {
      return (await this.list()).filter((conversation) =>
        conversation.status !== "running" && conversation.finalNoticeSentAt === null);
    },
  };
}

export type RelayConversationStore = ReturnType<typeof createRelayConversationStore>;
