import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createAnswerCopyStore } from "./answerCopyStore.js";

describe("answer copy store", () => {
  it("stores full answers under deterministic opaque ids", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "answer-copy-store-"));
    const store = createAnswerCopyStore(tempRoot);

    try {
      const firstId = await store.save("첫 줄\n둘째 줄\n");
      const secondId = await store.save("첫 줄\n둘째 줄");

      expect(firstId).toMatch(/^[a-f0-9]{32}$/);
      expect(secondId).toBe(firstId);
      await expect(store.read(firstId)).resolves.toBe("첫 줄\n둘째 줄");
      await expect(store.read("../not-valid")).resolves.toBeNull();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
