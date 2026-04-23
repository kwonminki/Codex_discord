import { describe, expect, it } from "vitest";
import { createAgentHelloMessage, handleAgentJob } from "./agentClient.js";

describe("agent client", () => {
  it("creates a hello message for registration", () => {
    expect(
      createAgentHelloMessage({
        computerId: "local-dev",
        displayName: "Local Dev",
        capabilities: ["shell", "codex-import"],
      }),
    ).toEqual({
      type: "agent-hello",
      computerId: "local-dev",
      displayName: "Local Dev",
      capabilities: ["shell", "codex-import"],
    });
  });

  it("rejects unknown jobs", async () => {
    await expect(
      handleAgentJob({
        jobId: "job-1",
        type: "unknown",
        payload: {},
      }),
    ).rejects.toThrow("Unsupported agent job type");
  });
});
