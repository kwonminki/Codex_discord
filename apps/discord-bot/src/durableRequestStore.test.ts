import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createDurableDiscordRequestStore } from "./durableRequestStore.js";

describe("durable Discord request store", () => {
  it("persists requests in creation order and removes them only after delivery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "discord-durable-"));
    const store = createDurableDiscordRequestStore(root);

    try {
      await store.enqueue({
        requestId: "request-2",
        channelId: "thread-1",
        userId: "user-1",
        content: "second",
        roleIds: ["role-1"],
        createdAt: "2026-07-21T00:00:02.000Z",
      });
      await store.enqueue({
        requestId: "request-1",
        channelId: "thread-1",
        userId: "user-1",
        content: "first",
        roleIds: ["role-1"],
        createdAt: "2026-07-21T00:00:01.000Z",
      });

      await expect(store.list()).resolves.toMatchObject([
        { requestId: "request-1", content: "first" },
        { requestId: "request-2", content: "second" },
      ]);
      await store.remove("request-1");
      await expect(store.list()).resolves.toMatchObject([{ requestId: "request-2" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
