import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import type { AgentRelayStateMarker } from "../../../packages/core/src/index.js";

const activeRelayPresenceSchema = z.object({
  conversationId: z.string().uuid(),
  originThreadId: z.string().min(1),
  peerThreadId: z.string().min(1),
  activeThreadId: z.string().min(1),
  expiresAtMs: z.number().int().nonnegative(),
});

const relayPresenceFileSchema = z.object({
  version: z.literal(1),
  conversations: z.array(activeRelayPresenceSchema),
});

export type ActiveRelayPresence = z.infer<typeof activeRelayPresenceSchema>;

export function defaultAgentRelayPresencePath(): string {
  return path.resolve(
    process.env.CONNECT_RELAY_PRESENCE_PATH ?? ".connect/agent-relay-presence.json",
  );
}

export function createAgentRelayPresenceStore(
  filePath = defaultAgentRelayPresencePath(),
  now: () => number = Date.now,
) {
  const resolvedPath = path.resolve(filePath);
  let mutationQueue: Promise<void> = Promise.resolve();
  let cachedConversations: ActiveRelayPresence[] | null = null;

  async function readAll(): Promise<ActiveRelayPresence[]> {
    try {
      const parsed = relayPresenceFileSchema.parse(JSON.parse(await readFile(resolvedPath, "utf8")));
      await chmod(resolvedPath, 0o600);
      return parsed.conversations;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async function writeAll(conversations: ActiveRelayPresence[]): Promise<void> {
    const directory = path.dirname(resolvedPath);
    const temporaryPath = `${resolvedPath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ version: 1, conversations }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await rename(temporaryPath, resolvedPath);
      await chmod(resolvedPath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function mutate(
    operation: (conversations: ActiveRelayPresence[]) => ActiveRelayPresence[],
  ): Promise<void> {
    const run = mutationQueue.then(async () => {
      const current = (
        cachedConversations ?? await readAll()
      ).filter((conversation) => conversation.expiresAtMs > now());
      cachedConversations = operation(current);
      await writeAll(cachedConversations);
    });
    mutationQueue = run.catch(() => undefined);
    await run;
  }

  return {
    filePath: resolvedPath,
    async apply(marker: AgentRelayStateMarker): Promise<void> {
      await mutate((conversations) => {
        const withoutConversation = conversations.filter(
          (conversation) => conversation.conversationId !== marker.conversationId,
        );
        if (marker.status === "ended" || !marker.activeThreadId || marker.expiresAtMs <= now()) {
          return withoutConversation;
        }
        const threadIds = new Set([marker.originThreadId, marker.peerThreadId]);
        return [
          ...withoutConversation.filter(
            (conversation) =>
              !threadIds.has(conversation.originThreadId) &&
              !threadIds.has(conversation.peerThreadId),
          ),
          activeRelayPresenceSchema.parse({
            conversationId: marker.conversationId,
            originThreadId: marker.originThreadId,
            peerThreadId: marker.peerThreadId,
            activeThreadId: marker.activeThreadId,
            expiresAtMs: marker.expiresAtMs,
          }),
        ];
      });
    },
    async findByThread(threadId: string): Promise<ActiveRelayPresence | null> {
      await mutationQueue;
      const current = cachedConversations ?? await readAll();
      const active = current.filter((conversation) => conversation.expiresAtMs > now());
      cachedConversations = active;
      return active.find(
        (conversation) =>
          conversation.originThreadId === threadId || conversation.peerThreadId === threadId,
      ) ?? null;
    },
  };
}

export type AgentRelayPresenceStore = ReturnType<typeof createAgentRelayPresenceStore>;
