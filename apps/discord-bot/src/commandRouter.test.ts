import { describe, expect, it } from "vitest";

import { routeDiscordMessage } from "./commandRouter.js";

describe("routeDiscordMessage", () => {
  it("routes a bare shell-admin command to execute-command", () => {
    expect(
      routeDiscordMessage({
        channelMode: "shell-admin",
        content: "ls",
        userRoleIds: ["role-operator"],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "execute-command",
      command: "ls",
    });
  });

  it("routes session-linked normal text to codex-chat", () => {
    expect(
      routeDiscordMessage({
        channelMode: "session-linked",
        content: "hello there",
        userRoleIds: [],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "codex-chat",
      content: "hello there",
    });
  });

  it("denies unauthorized shell-admin commands", () => {
    expect(
      routeDiscordMessage({
        channelMode: "shell-admin",
        content: "ls",
        userRoleIds: ["role-viewer"],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "denied",
      reason: "User does not have an allowed role",
    });
  });
});
