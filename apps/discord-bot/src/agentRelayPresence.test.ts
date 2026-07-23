import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createAgentRelayPresenceStore } from "./agentRelayPresence.js";

describe("agent relay presence store", () => {
  it("persists active/waiting threads and clears ended or expired conversations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "relay-presence-"));
    const filePath = path.join(root, ".connect", "presence.json");
    let clock = 1_000;
    const store = createAgentRelayPresenceStore(filePath, () => clock);

    try {
      await store.apply({
        conversationId: "d90bcf0b-e471-4f9f-a2cf-c279d14d53d0",
        status: "active",
        originThreadId: "thread-a",
        peerThreadId: "thread-b",
        activeThreadId: "thread-a",
        expiresAtMs: 2_000,
      });
      await expect(store.findByThread("thread-a")).resolves.toMatchObject({
        activeThreadId: "thread-a",
      });
      await expect(createAgentRelayPresenceStore(filePath, () => clock).findByThread("thread-b"))
        .resolves.toMatchObject({ activeThreadId: "thread-a" });

      await store.apply({
        conversationId: "d90bcf0b-e471-4f9f-a2cf-c279d14d53d0",
        status: "ended",
        originThreadId: "thread-a",
        peerThreadId: "thread-b",
        activeThreadId: null,
        expiresAtMs: 0,
      });
      await expect(store.findByThread("thread-a")).resolves.toBeNull();

      await store.apply({
        conversationId: "c90bcf0b-e471-4f9f-a2cf-c279d14d53d0",
        status: "active",
        originThreadId: "thread-c",
        peerThreadId: "thread-d",
        activeThreadId: "thread-d",
        expiresAtMs: 2_000,
      });
      clock = 2_001;
      await expect(store.findByThread("thread-c")).resolves.toBeNull();

      if (process.platform !== "win32") {
        expect((await stat(filePath)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
