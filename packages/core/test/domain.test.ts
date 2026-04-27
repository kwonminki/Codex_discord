import { describe, expect, it } from "vitest";
import {
  createManagedChannel,
  createWorkspaceCategoryName,
  linkCodexSession,
} from "../src/domain.js";

describe("domain mapping", () => {
  it("names workspace categories with computer context", () => {
    expect(createWorkspaceCategoryName("macbook-pro-01", "CodexDiscordConnector")).toBe(
      "macbook-pro-01 / CodexDiscordConnector",
    );
  });

  it("creates an unattached managed channel rooted at the workspace path", () => {
    const channel = createManagedChannel({
      channelId: "discord-channel-1",
      computerId: "computer-1",
      workspaceId: "workspace-1",
      workspaceRoot: "/Users/me/project",
      mode: "session-linked",
    });

    expect(channel.currentSessionLinkId).toBeNull();
    expect(channel.cwd).toBe("/Users/me/project");
    expect(channel.status).toBe("created");
  });

  it("links one active Codex session to a channel", () => {
    const channel = createManagedChannel({
      channelId: "discord-channel-1",
      computerId: "computer-1",
      workspaceId: "workspace-1",
      workspaceRoot: "/Users/me/project",
      mode: "session-linked",
    });

    const result = linkCodexSession(channel, {
      sessionLinkId: "link-1",
      codexSessionId: "019db2be-b2b3-7e82-9e61-8c84b28ad287",
      origin: "imported_native",
      threadNameSnapshot: "Codex Discord planning",
      attachedAt: "2026-04-23T00:00:00.000Z",
    });

    expect(result.channel.status).toBe("attached");
    expect(result.channel.currentSessionLinkId).toBe("link-1");
    expect(result.link.availabilityStatus).toBe("available");
  });
});
