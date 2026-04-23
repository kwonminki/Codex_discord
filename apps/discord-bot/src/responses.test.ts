import { describe, expect, it } from "vitest";

import {
  formatCodexAck,
  formatCodexResultUpdate,
  formatCommandAck,
  formatCommandResultUpdate,
  formatDeletePreview,
  formatDeleteResult,
  formatDenied,
  formatHelp,
  formatSyncAck,
  formatSyncResultUpdate,
} from "./responses.js";

describe("responses", () => {
  it("formats command acknowledgements as a Discord embed", () => {
    expect(
      formatCommandAck({
        computerDisplayName: "desk`one\n@everyone",
        workspaceDisplayName: "workspace\n`ops`",
        cwd: "/repo\n@here",
        command: "ls\n`rm -rf /`\n@channel",
      }),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        {
          title: "Command queued",
          color: 0xf1c40f,
          fields: [
            {
              name: "Target",
              value: "`desk'one [at]everyone` / `workspace 'ops'`",
              inline: false,
            },
            {
              name: "Working directory",
              value: "`/repo [at]here`",
              inline: false,
            },
            {
              name: "Command",
              value: "```bash\nls\n'rm -rf /'\n[at]channel\n```",
              inline: false,
            },
            {
              name: "Status",
              value: "`queued`",
              inline: true,
            },
          ],
        },
      ],
    });
  });

  it("formats command results with status color and readable output fields", () => {
    expect(
      formatCommandResultUpdate(
        {
          computerDisplayName: "Local Dev",
          workspaceDisplayName: "CodexDiscordConnecter",
          cwd: "/repo",
          command: "ls",
        },
        {
          result: {
            status: "completed",
            exitCode: 0,
            stdout: "README.md\napps\n",
            stderr: "",
            cwd: "/repo",
          },
        },
      ),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        {
          title: "Command completed",
          color: 0x2ecc71,
          fields: [
            {
              name: "Target",
              value: "`Local Dev` / `CodexDiscordConnecter`",
              inline: false,
            },
            {
              name: "Working directory",
              value: "`/repo`",
              inline: false,
            },
            {
              name: "Command",
              value: "```bash\nls\n```",
              inline: false,
            },
            {
              name: "Status",
              value: "`completed`",
              inline: true,
            },
            {
              name: "Exit code",
              value: "`0`",
              inline: true,
            },
            {
              name: "Output",
              value: "```text\nREADME.md\napps\n```",
              inline: false,
            },
          ],
        },
      ],
    });
  });

  it("sanitizes denied messages", () => {
    expect(formatDenied("use `backticks`\n@everyone")).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        {
          title: "Permission denied",
          color: 0xe74c3c,
          description: "`use 'backticks' [at]everyone`",
        },
      ],
    });
  });

  it("formats Codex prompts as Discord embeds", () => {
    expect(
      formatCodexAck({
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "CodexDiscordConnecter",
        cwd: "/repo",
        prompt: "README를 요약해줘",
      }),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        {
          title: "Codex is working",
          color: 0x3498db,
          fields: [
            {
              name: "Target",
              value: "`Local Dev` / `CodexDiscordConnecter`",
              inline: false,
            },
            {
              name: "Working directory",
              value: "`/repo`",
              inline: false,
            },
            {
              name: "Prompt",
              value: "```text\nREADME를 요약해줘\n```",
              inline: false,
            },
            {
              name: "Status",
              value: "`thinking`",
              inline: true,
            },
          ],
        },
      ],
    });
  });

  it("formats Codex answers as a readable Discord embed", () => {
    expect(
      formatCodexResultUpdate(
        {
          computerDisplayName: "Local Dev",
          workspaceDisplayName: "CodexDiscordConnecter",
          cwd: "/repo",
          prompt: "README를 요약해줘",
        },
        {
          result: {
            status: "completed",
            finalMessage: "README는 Discord와 Codex를 연결하는 프로젝트입니다.",
            sessionId: "session-1",
          },
        },
      ),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        {
          title: "Codex replied",
          color: 0x2ecc71,
          description: "README는 Discord와 Codex를 연결하는 프로젝트입니다.",
          fields: [
            {
              name: "Target",
              value: "`Local Dev` / `CodexDiscordConnecter`",
              inline: false,
            },
            {
              name: "Working directory",
              value: "`/repo`",
              inline: false,
            },
            {
              name: "Prompt",
              value: "```text\nREADME를 요약해줘\n```",
              inline: false,
            },
            {
              name: "Status",
              value: "`completed`",
              inline: true,
            },
            {
              name: "Session",
              value: "`session-1`",
              inline: true,
            },
          ],
        },
      ],
    });
  });

  it("formats a concise help card for shell-admin channels", () => {
    expect(formatHelp("shell-admin")).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "How to use this Codex channel",
          color: 0x95a5a6,
        }),
      ],
    });
  });

  it("formats sync progress and summary cards", () => {
    expect(formatSyncAck({ limit: 25 })).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Codex session sync started",
          color: 0x3498db,
        }),
      ],
    });
    expect(
      formatSyncResultUpdate({
        result: {
          createdCategories: 2,
          existingCategories: 1,
          createdChannels: 5,
          existingChannels: 3,
          skippedSessions: 10,
        },
      }),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Codex session sync complete",
          color: 0x2ecc71,
          fields: expect.arrayContaining([
            { name: "Created categories", value: "`2`", inline: true },
            { name: "Created channels", value: "`5`", inline: true },
            { name: "Skipped sessions", value: "`10`", inline: true },
          ]),
        }),
      ],
    });
  });

  it("formats synced channel delete preview and result cards", () => {
    expect(
      formatDeletePreview({
        mode: "all",
        channelCount: 2,
        categoryCount: 1,
        channelNames: ["build-bridge", "fix-sync"],
        categoryNames: ["repo"],
      }),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Synced channel delete preview",
          color: 0xf1c40f,
          fields: expect.arrayContaining([
            { name: "Channels", value: "`2`", inline: true },
            { name: "Categories", value: "`1`", inline: true },
          ]),
        }),
      ],
    });
    expect(
      formatDeleteResult({
        result: {
          mode: "all",
          deletedChannels: 2,
          deletedCategories: 1,
          missingChannels: 0,
          missingCategories: 0,
        },
      }),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Synced channels deleted",
          color: 0x2ecc71,
        }),
      ],
    });
  });
});
