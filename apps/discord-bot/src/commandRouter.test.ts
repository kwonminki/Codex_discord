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
      confirmedDangerous: false,
    });
  });

  it("routes explicit confirmation to a confirmed dangerous command", () => {
    expect(
      routeDiscordMessage({
        channelMode: "shell-admin",
        content: "confirm rm README.md",
        userRoleIds: ["role-operator"],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "execute-command",
      command: "rm README.md",
      confirmedDangerous: true,
    });
  });

  it("routes shell-admin codex-prefixed text to codex-chat", () => {
    expect(
      routeDiscordMessage({
        channelMode: "shell-admin",
        content: "codex explain this project",
        userRoleIds: ["role-operator"],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "codex-chat",
      content: "explain this project",
    });
  });

  it("routes session-linked normal text to codex-chat", () => {
    expect(
      routeDiscordMessage({
        channelMode: "session-linked",
        content: "hello there",
        userRoleIds: ["role-operator"],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "codex-chat",
      content: "hello there",
    });
  });

  it("routes help requests before shell execution", () => {
    expect(
      routeDiscordMessage({
        channelMode: "shell-admin",
        content: "help",
        userRoleIds: ["role-viewer"],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "bot-help",
    });
  });

  it("denies unauthorized session-linked chat", () => {
    expect(
      routeDiscordMessage({
        channelMode: "session-linked",
        content: "hello there",
        userRoleIds: ["role-viewer"],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "denied",
      reason: "User does not have an allowed role",
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
