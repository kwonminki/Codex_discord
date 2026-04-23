import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "../../apps/control-api/src/agentRegistry.js";
import { createJob, dispatchJob } from "../../apps/control-api/src/jobs.js";

describe("mvp smoke flow", () => {
  it("dispatches an ls command to an online agent", async () => {
    const sent: unknown[] = [];
    const registry = createAgentRegistry();

    registry.register({
      computerId: "computer-1",
      displayName: "macbook-pro-01",
      capabilities: ["shell", "codex-import"],
      send: async (message) => {
        sent.push(message);
      },
    });

    const job = createJob("computer-1", "run-command", {
      workspaceRoot: "/repo",
      cwd: "/repo",
      command: "ls",
      timeoutMs: 3000,
      confirmedDangerous: false,
    }).job;

    await dispatchJob(registry, "computer-1", job);

    expect(sent).toEqual([job]);
  });
});
