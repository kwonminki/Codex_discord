import { describe, expect, it } from "vitest";

import { formatCommandAck, formatDenied } from "./responses.js";

describe("responses", () => {
  it("sanitizes command acknowledgements so dynamic text cannot forge extra lines", () => {
    expect(
      formatCommandAck({
        computerDisplayName: "desk`one\n@everyone",
        workspaceDisplayName: "workspace\n`ops`",
        cwd: "/repo\n@here",
        command: "ls\n`rm -rf /`\n@channel",
      }),
    ).toBe(
      [
        "Target: `desk'one [at]everyone` / `workspace 'ops'`",
        "cwd: `/repo [at]here`",
        "command: `ls 'rm -rf /' [at]channel`",
        "state: queued",
      ].join("\n"),
    );
  });

  it("sanitizes denied messages", () => {
    expect(formatDenied("use `backticks`\n@everyone")).toBe(
      "Permission denied: `use 'backticks' [at]everyone`",
    );
  });
});
