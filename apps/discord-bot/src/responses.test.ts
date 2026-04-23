import { describe, expect, it } from "vitest";

import { formatCommandAck, formatCommandResultUpdate, formatDenied } from "./responses.js";

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
});
