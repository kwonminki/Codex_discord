import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatCodexAck,
  formatCodexVisibleProcessMessage,
  formatCollapsibleThoughtMessage,
  formatCodexProgressUpdate,
  formatCodexResultUpdate,
  formatBlockedCommand,
  formatChannelStatus,
  formatCommandAck,
  formatCommandResultUpdate,
  formatDeletePreview,
  formatDeleteResult,
  formatDenied,
  formatHelp,
  formatReloadAck,
  formatReloadConfirmation,
  formatReloadResult,
  formatSyncAck,
  formatSyncModeResult,
  formatSyncSelection,
  formatSyncStatus,
  formatSyncResultUpdate,
  formatScheduleResult,
  formatMaintenancePanel,
  getCodexThoughtView,
} from "./responses.js";

describe("responses", () => {
  function expectActionRowsWithinDiscordLimits(payload: { components?: Array<{ components: unknown[] }> }) {
    for (const row of payload.components ?? []) {
      expect(row.components.length).toBeLessThanOrEqual(5);
    }
  }

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
          workspaceDisplayName: "CodexDiscordConnector",
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
              value: "`Local Dev` / `CodexDiscordConnector`",
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
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:fs:up", label: "상위 폴더", style: 2 },
            { type: 2, custom_id: "cdc:fs:refresh", label: "새로고침", style: 1 },
            { type: 2, custom_id: "cdc:codex:ask", label: "Codex에게 요청", style: 3 },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "cdc:fs:open",
              placeholder: "항목 열기",
              min_values: 1,
              max_values: 1,
              options: [
                { label: "README.md", value: "README.md" },
                { label: "apps", value: "apps" },
              ],
            },
          ],
        },
      ],
    });
  });

  it("attaches full command output when Discord fields would truncate it", () => {
    const longOutput = Array.from({ length: 220 }, (_, index) => `line-${index + 1} ${"x".repeat(30)}`).join("\n");
    const payload = formatCommandResultUpdate(
      {
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "CodexDiscordConnector",
        cwd: "/repo",
        command: "pnpm test",
      },
      {
        result: {
          status: "completed",
          exitCode: 0,
          stdout: longOutput,
          stderr: "",
          cwd: "/repo",
        },
      },
    );

    expect(payload.embeds[0]?.fields).toContainEqual(
      expect.objectContaining({
        name: "Output preview",
        value: expect.stringContaining("전체 출력은 첨부 파일"),
      }),
    );
    expect(JSON.stringify(payload.embeds)).not.toContain("(truncated)");
    expect(payload.files).toEqual([
      expect.objectContaining({
        name: "command-output.txt",
        attachment: expect.any(Buffer),
      }),
    ]);
    expect(payload.files?.[0]?.attachment.toString()).toBe(longOutput);
  });

  it("formats structured file browser results with page actions and file actions", () => {
    expect(
      formatCommandResultUpdate(
        {
          computerDisplayName: "Local Dev",
          workspaceDisplayName: "CodexDiscordConnector",
          cwd: "/repo",
          command: "__cdc_ls 1",
        },
        {
          result: {
            status: "completed",
            exitCode: 0,
            stdout: "src/\nREADME.md\n",
            stderr: "",
            cwd: "/repo",
            ui: {
              kind: "file-browser",
              page: 1,
              pageSize: 25,
              totalEntries: 80,
              entries: [
                { name: "src", kind: "directory" },
                { name: "README.md", kind: "file" },
              ],
            },
          },
        },
      ),
    ).toEqual(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: "Command completed",
            fields: expect.arrayContaining([
              { name: "Browser page", value: "`2 / 4`", inline: true },
            ]),
          }),
        ],
        components: expect.arrayContaining([
          expect.objectContaining({
            components: expect.arrayContaining([
              { type: 2, custom_id: "cdc:fs:page:0", label: "이전 페이지", style: 2 },
              { type: 2, custom_id: "cdc:fs:page:2", label: "다음 페이지", style: 2 },
            ]),
          }),
        ]),
      }),
    );
  });

  it("adds Git and test workflow buttons to matching command results", () => {
    expect(
      formatCommandResultUpdate(
        {
          computerDisplayName: "Local Dev",
          workspaceDisplayName: "repo",
          cwd: "/repo",
          command: "git status --short",
        },
        {
          result: {
            status: "completed",
            exitCode: 0,
            stdout: " M README.md\n",
            stderr: "",
          },
        },
      ),
    ).toEqual(
      expect.objectContaining({
        components: expect.arrayContaining([
          expect.objectContaining({
            components: expect.arrayContaining([
              { type: 2, custom_id: "cdc:git:diff", label: "Diff 보기", style: 2 },
              { type: 2, custom_id: "cdc:git:review", label: "Codex 리뷰", style: 3 },
              { type: 2, custom_id: "cdc:test:run", label: "테스트 실행", style: 1 },
            ]),
          }),
        ]),
      }),
    );
  });

  it("keeps test repair buttons visible when a test command fails", () => {
    expect(
      formatCommandResultUpdate(
        {
          computerDisplayName: "Local Dev",
          workspaceDisplayName: "repo",
          cwd: "/repo",
          command: "pnpm test",
        },
        {
          result: {
            status: "failed",
            exitCode: 1,
            stdout: "1 failed\n",
            stderr: "",
          },
        },
      ),
    ).toEqual(
      expect.objectContaining({
        components: expect.arrayContaining([
          expect.objectContaining({
            components: expect.arrayContaining([
              { type: 2, custom_id: "cdc:test:run", label: "테스트 다시 실행", style: 1 },
              { type: 2, custom_id: "cdc:test:fix", label: "Codex에게 수정 요청", style: 3 },
            ]),
          }),
        ]),
      }),
    );
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

  it("formats blocked command guidance", () => {
    expect(
      formatBlockedCommand({
        reason: "main 채널은 운영 전용입니다.",
        guidance: "Codex와 대화하려면 /chat-new로 세션 채널을 만드세요.",
      }),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        {
          title: "이 채널에서는 실행할 수 없습니다",
          color: 0x95a5a6,
          description: "main 채널은 운영 전용입니다.",
          fields: [
            {
              name: "다음 단계",
              value: "Codex와 대화하려면 /chat-new로 세션 채널을 만드세요.",
              inline: false,
            },
          ],
        },
      ],
    });
  });

  it("formats Codex prompts as readable plain text progress", () => {
    expect(
      formatCodexAck({
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "CodexDiscordConnector",
        cwd: "/repo",
        prompt: "README를 요약해줘",
      }),
    ).toEqual(expect.objectContaining({
      allowedMentions: { parse: [] },
      content: expect.stringContaining("**Codex 작업 시작**"),
      embeds: [],
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:codex:thoughts:open", label: "생각 열기", style: 2 },
            { type: 2, custom_id: "cdc:codex:thoughts:send-process", label: "과정 보내기", style: 2 },
          ],
        },
      ],
    }));
  });

  it("formats Codex progress as Korean plain text instead of raw event names", () => {
    const payload = formatCodexProgressUpdate(
      {
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "CodexDiscordConnector",
        cwd: "/repo",
        prompt: "README를 요약해줘",
      },
      {
        status: "item.started",
        sessionId: "session-1",
        latestMessage: "중간 답변을 작성 중입니다.",
      },
      { expanded: true },
    );

    expect(payload).toEqual(expect.objectContaining({
      allowedMentions: { parse: [] },
      content: expect.stringContaining("진행: 작업 단계 실행 중"),
      embeds: [],
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:codex:thoughts:close", label: "생각 닫기", style: 2 },
            { type: 2, custom_id: "cdc:codex:thoughts:send-process", label: "과정 보내기", style: 2 },
          ],
        },
      ],
    }));
    expect(payload.content).toContain("**요청**");
    expect(payload.content).toContain("**생각 / 중간 출력**");
    expect(payload.content).toContain("중간 답변을 작성 중입니다.");
    expect(payload.content).not.toContain("대상:");
    expect(payload.content).not.toContain("위치:");
    expect(payload.content).not.toContain("세션:");
    expect(payload.content).not.toContain("item.started");
  });

  it("keeps Codex thought output collapsed until the progress toggle is opened", () => {
    const input = {
      computerDisplayName: "Local Dev",
      workspaceDisplayName: "CodexDiscordConnector",
      cwd: "/repo",
      prompt: "UI 진행 표시 개선해줘",
    };
    const progress = {
      status: "파일 탐색 중",
      latestMessage: "이제 두 가지를 바로 바꾸겠습니다.",
      recentEvents: ["생각중...", "12개의 파일 탐색중...", "탐색마침"],
    };

    const collapsed = formatCodexProgressUpdate(input, progress);
    const expanded = formatCodexProgressUpdate(input, progress, { expanded: true });

    expect(collapsed.content).toContain("진행: 파일 탐색 중");
    expect(collapsed.content).not.toContain("이제 두 가지를 바로 바꾸겠습니다.");
    expect(collapsed.components?.[0]?.components).toContainEqual({
      type: 2,
      custom_id: "cdc:codex:thoughts:open",
      label: "생각 열기",
      style: 2,
    });
    expect(collapsed.components?.[0]?.components).toContainEqual({
      type: 2,
      custom_id: "cdc:codex:thoughts:send-process",
      label: "과정 보내기",
      style: 2,
    });

    expect(expanded.content).toContain("**생각 / 중간 출력**");
    expect(expanded.content).toContain("이제 두 가지를 바로 바꾸겠습니다.");
    expect(expanded.content).toContain("12개의 파일 탐색중...");
    expect(expanded.components?.[0]?.components).toContainEqual({
      type: 2,
      custom_id: "cdc:codex:thoughts:close",
      label: "생각 닫기",
      style: 2,
    });
  });

  it("formats standalone thought messages collapsed by default with a toggle", () => {
    const collapsed = formatCollapsibleThoughtMessage({
      collapsedContent: "> 생각중...",
      expandedContent: "> 파일 탐색 중 · rg --files",
    });
    const expanded = formatCollapsibleThoughtMessage(
      {
        collapsedContent: "> 생각중...",
        expandedContent: "> 파일 탐색 중 · rg --files",
      },
      { expanded: true },
    );

    expect(collapsed).toEqual(
      expect.objectContaining({
        content: "> 생각중...",
        components: [
          {
            type: 1,
            components: [
              { type: 2, custom_id: "cdc:codex:thoughts:open", label: "생각 열기", style: 2 },
              { type: 2, custom_id: "cdc:codex:thoughts:send-process", label: "과정 보내기", style: 2 },
            ],
          },
        ],
      }),
    );
    expect(expanded).toEqual(
      expect.objectContaining({
        content: "> 파일 탐색 중 · rg --files",
        components: [
          {
            type: 1,
            components: [
              { type: 2, custom_id: "cdc:codex:thoughts:close", label: "생각 닫기", style: 2 },
              { type: 2, custom_id: "cdc:codex:thoughts:send-process", label: "과정 보내기", style: 2 },
            ],
          },
        ],
      }),
    );
  });

  it("sends detailed recent process events while dropping older events first", () => {
    const payload = formatCodexProgressUpdate(
      {
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "repo",
        cwd: "/repo",
        prompt: "검사해줘",
        agentLabel: "Claude Code",
      },
      {
        status: "Claude 도구 실행 완료",
        recentEvents: [
          `오래된 과정 · ${"x".repeat(1_850)}`,
          "Claude 도구 실행 중 · Read · 입력: {file_path:/repo/README.md}",
          "Claude 도구 실행 완료 · README title and setup steps",
        ],
      },
    );
    const view = getCodexThoughtView(payload);
    const processMessage = formatCodexVisibleProcessMessage(view!);

    expect(processMessage.content).toContain("**Claude Code 과정**");
    expect(processMessage.content).toContain("Claude 도구 실행 중");
    expect(processMessage.content).toContain("Claude 도구 실행 완료");
    expect(processMessage.content).toContain("이전 과정 일부 생략");
    expect(processMessage.content).not.toContain("오래된 과정");
    expect(processMessage.content?.length).toBeLessThanOrEqual(1_900);
  });

  it("renders file edit progress with filename-only diff stats", () => {
    const payload = formatCodexProgressUpdate(
      {
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "CodexDiscordConnector",
        cwd: "/repo",
        prompt: "수정해줘",
      },
      {
        status: "파일 수정 중",
        latestMessage: "편집함 /Users/me/project/src/n.ts +12 -3",
        recentEvents: ["편집함 /Users/me/project/src/n.ts +12 -3"],
      },
      { expanded: true },
    );

    expect(payload.content).toContain("편집함 `n.ts`");
    expect(payload.content).toContain("```diff\n+12\n-3\n```");
    expect(payload.content).not.toContain("/Users/me/project/src");
  });

  it("formats successful Codex answers as plain Discord messages", () => {
    expect(
      formatCodexResultUpdate(
        {
          computerDisplayName: "Local Dev",
          workspaceDisplayName: "CodexDiscordConnector",
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
      content: "README는 Discord와 Codex를 연결하는 프로젝트입니다.",
      embeds: [],
    });
  });

  it("adds an open-in-Codex button when a real session id is present", () => {
    const sessionId = "019db2be-b2b3-7e82-9e61-8c84b28ad287";
    const payload = formatCodexResultUpdate(
      {
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "CodexDiscordConnector",
        cwd: "/repo",
        prompt: "README를 요약해줘",
      },
      {
        result: {
          status: "completed",
          finalMessage: "README는 Discord와 Codex를 연결하는 프로젝트입니다.",
          sessionId,
        },
      },
    );

    expect(payload.components).toEqual([
      {
        type: 1,
        components: [
          { type: 2, custom_id: `cdc:codex:open:${sessionId}`, label: "Codex 앱에서 열기", style: 1 },
          { type: 2, custom_id: `cdc:codex:restart-open:${sessionId}`, label: "앱 재시작 후 열기", style: 4 },
        ],
      },
    ]);
  });

  it("attaches long Codex final answers instead of truncating them in Discord content", () => {
    const longFinalMessage = Array.from({ length: 160 }, (_, index) => `긴 답변 ${index + 1}: ${"내용 ".repeat(20)}`).join("\n");
    const payload = formatCodexResultUpdate(
      {
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "CodexDiscordConnector",
        cwd: "/repo",
        prompt: "긴 보고서 작성",
      },
      {
        result: {
          status: "completed",
          finalMessage: longFinalMessage,
          sessionId: "session-1",
        },
      },
    );

    expect(payload.content).toContain("전체 답변은 첨부 파일");
    expect(payload.content).not.toContain("(truncated)");
    expect(payload.files).toEqual([
      expect.objectContaining({
        name: "codex-final-message.txt",
        attachment: expect.any(Buffer),
      }),
    ]);
    expect(payload.files?.[0]?.attachment.toString()).toBe(longFinalMessage);
  });

  it("keeps Codex thoughts available after the final answer is rendered", () => {
    const sessionId = "019db2be-b2b3-7e82-9e61-8c84b28ad287";
    const payload = formatCodexResultUpdate(
      {
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "CodexDiscordConnector",
        cwd: "/repo",
        prompt: "README를 요약해줘",
      },
      {
        result: {
          status: "completed",
          finalMessage: "README는 Discord와 Codex를 연결하는 프로젝트입니다.",
          sessionId,
        },
      },
      {
        recentEvents: ["생각중...", "2개의 파일 탐색중..."],
      },
    );

    expect(payload).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("README는 Discord와 Codex를 연결하는 프로젝트입니다."),
        components: [
          {
            type: 1,
            components: [
              { type: 2, custom_id: "cdc:codex:thoughts:open", label: "생각 열기", style: 2 },
              { type: 2, custom_id: "cdc:codex:thoughts:send-process", label: "과정 보내기", style: 2 },
            ],
          },
          {
            type: 1,
            components: [
              { type: 2, custom_id: `cdc:codex:open:${sessionId}`, label: "Codex 앱에서 열기", style: 1 },
              { type: 2, custom_id: `cdc:codex:restart-open:${sessionId}`, label: "앱 재시작 후 열기", style: 4 },
            ],
          },
        ],
      }),
    );
    expect(payload.content).toContain("_생각과 중간 출력은 버튼으로 열 수 있습니다._");

    const expanded = formatCodexResultUpdate(
      {
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "CodexDiscordConnector",
        cwd: "/repo",
        prompt: "README를 요약해줘",
      },
      {
        result: {
          status: "completed",
          finalMessage: "README는 Discord와 Codex를 연결하는 프로젝트입니다.",
          sessionId,
        },
      },
      {
        recentEvents: ["생각중...", "2개의 파일 탐색중..."],
        expanded: true,
      },
    );
    expect(expanded.content).toContain("**생각 / 중간 출력**");
    expect(expanded.content).toContain("2개의 파일 탐색중...");
    expect(expanded.components).toEqual([
      {
        type: 1,
        components: [
          { type: 2, custom_id: "cdc:codex:thoughts:close", label: "생각 닫기", style: 2 },
          { type: 2, custom_id: "cdc:codex:thoughts:send-process", label: "과정 보내기", style: 2 },
        ],
      },
      {
        type: 1,
        components: [
          { type: 2, custom_id: `cdc:codex:open:${sessionId}`, label: "Codex 앱에서 열기", style: 1 },
          { type: 2, custom_id: `cdc:codex:restart-open:${sessionId}`, label: "앱 재시작 후 열기", style: 4 },
        ],
      },
    ]);
  });

  it("keeps failed Codex answers as diagnostic embeds", () => {
    expect(
      formatCodexResultUpdate(
        {
          computerDisplayName: "Local Dev",
          workspaceDisplayName: "CodexDiscordConnector",
          cwd: "/repo",
          prompt: "README를 요약해줘",
        },
        {
          error: { message: "Codex CLI exited with code 1" },
        },
      ),
    ).toEqual(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: "Codex failed",
            fields: expect.arrayContaining([
              { name: "Target", value: "`Local Dev` / `CodexDiscordConnector`", inline: false },
              { name: "Working directory", value: "`/repo`", inline: false },
              { name: "Status", value: "`failed`", inline: true },
            ]),
          }),
        ],
      }),
    );
  });

  it("shows Codex runner error codes on failed diagnostic embeds", () => {
    expect(
      formatCodexResultUpdate(
        {
          computerDisplayName: "Local Dev",
          workspaceDisplayName: "CodexDiscordConnector",
          cwd: "/repo",
          prompt: "README를 요약해줘",
        },
        {
          result: {
            status: "failed",
            finalMessage: "",
            stderr: "Codex CLI command was not found. Install Codex CLI or configure codexCommand.",
            sessionId: null,
            exitCode: null,
            errorCode: "CODEX_CLI_NOT_FOUND",
          },
        },
      ),
    ).toEqual(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: "Codex failed",
            description: "Codex CLI command was not found. Install Codex CLI or configure codexCommand.",
            fields: expect.arrayContaining([
              { name: "Error code", value: "`CODEX_CLI_NOT_FOUND`", inline: true },
            ]),
          }),
        ],
      }),
    );
  });

  it("attaches local images referenced by Codex final messages", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-discord-image-"));
    const imagePath = path.join(tempRoot, "result.png");

    try {
      await writeFile(imagePath, "fake image");

      expect(
        formatCodexResultUpdate(
          {
            computerDisplayName: "Local Dev",
            workspaceDisplayName: "CodexDiscordConnector",
            cwd: "/repo",
            prompt: "이미지 생성해줘",
          },
          {
            result: {
              status: "completed",
              finalMessage: `생성했습니다.\n\n![result](${imagePath})`,
              sessionId: "session-1",
            },
          },
        ),
      ).toEqual(
        expect.objectContaining({
          content: "생성했습니다.",
          embeds: [],
          files: [{ attachment: imagePath, name: "result.png" }],
        }),
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("attaches files from codex-discord-send blocks without showing the control block", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-discord-send-"));
    const videoPath = path.join(tempRoot, "demo.mp4");
    const audioPath = path.join(tempRoot, "tone.wav");

    try {
      await writeFile(videoPath, "fake video");
      await writeFile(audioPath, "fake audio");

      expect(
        formatCodexResultUpdate(
          {
            computerDisplayName: "Local Dev",
            workspaceDisplayName: "CodexDiscordConnector",
            cwd: "/repo",
            prompt: "동영상 보내줘",
          },
          {
            result: {
              status: "completed",
              finalMessage: [
                "완료했습니다.",
                "",
                "```codex-discord-send",
                JSON.stringify({
                  message: "동영상과 오디오를 첨부합니다.",
                  files: [
                    { path: videoPath, name: "preview.mp4" },
                    { path: audioPath, name: "tone.wav" },
                  ],
                }),
                "```",
              ].join("\n"),
              sessionId: "session-1",
            },
          },
        ),
      ).toEqual(
        expect.objectContaining({
          content: "완료했습니다.\n동영상과 오디오를 첨부합니다.",
          embeds: [],
          files: [
            { attachment: videoPath, name: "preview.mp4" },
            { attachment: audioPath, name: "tone.wav" },
          ],
        }),
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("attaches local media files referenced by markdown links", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-media-link-"));
    const videoPath = path.join(tempRoot, "sample.mp4");

    try {
      await writeFile(videoPath, "fake video");

      expect(
        formatCodexResultUpdate(
          {
            computerDisplayName: "Local Dev",
            workspaceDisplayName: "CodexDiscordConnector",
            cwd: "/repo",
            prompt: "샘플 영상 보내줘",
          },
          {
            result: {
              status: "completed",
              finalMessage: `확인용 영상입니다: [sample overlay](${videoPath})`,
              sessionId: "session-1",
            },
          },
        ),
      ).toEqual(
        expect.objectContaining({
          content: `확인용 영상입니다: [sample overlay](${videoPath})`,
          embeds: [],
          files: [{ attachment: videoPath, name: "sample.mp4" }],
        }),
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("warns when codex-discord-send files exceed the Discord upload limit", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-discord-send-large-"));
    const largePath = path.join(tempRoot, "large.bin");

    try {
      await writeFile(largePath, Buffer.alloc(10 * 1024 * 1024 + 1));

      const payload = formatCodexResultUpdate(
        {
          computerDisplayName: "Local Dev",
          workspaceDisplayName: "CodexDiscordConnector",
          cwd: "/repo",
          prompt: "큰 파일 보내줘",
        },
        {
          result: {
            status: "completed",
            finalMessage: [
              "완료했습니다.",
              "",
              "```codex-discord-send",
              JSON.stringify({
                message: "큰 파일 첨부를 시도했습니다.",
                files: [{ path: largePath, name: "large.bin" }],
              }),
              "```",
            ].join("\n"),
            sessionId: "session-1",
          },
        },
      );

      expect(payload).toEqual(
        expect.objectContaining({
          content: expect.stringContaining("최대 10MiB"),
          embeds: [],
        }),
      );
      expect(payload.files ?? []).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("formats a concise help card for shell-admin channels", () => {
    const payload = formatHelp("shell-admin");

    expectActionRowsWithinDiscordLimits(payload);
    expect(payload).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Codex 운영 콘솔 사용법",
          color: 0x95a5a6,
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: "Admin slash commands",
              value: expect.stringContaining("/sync-status"),
            }),
            expect.objectContaining({
              name: "Admin slash commands",
              value: expect.stringContaining("/sync-delete"),
            }),
            expect.objectContaining({
              name: "Channel boundary",
              value: expect.stringContaining("main/admin 채널은 운영 전용입니다."),
            }),
          ]),
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:chat:new:general", label: "새 일반 채팅", style: 1 },
            { type: 2, custom_id: "cdc:chat:new:current", label: "현재 폴더 채팅", style: 1 },
            { type: 2, custom_id: "cdc:sync:25", label: "세션 선택 동기화", style: 1 },
            { type: 2, custom_id: "cdc:fs:refresh", label: "파일 탐색", style: 2 },
            { type: 2, custom_id: "cdc:maintenance:panel", label: "유지보수", style: 2 },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:sync:all:25", label: "전체 동기화", style: 2 },
            { type: 2, custom_id: "cdc:delete:preview", label: "삭제 미리보기", style: 2 },
            { type: 2, custom_id: "cdc:reload:commands", label: "명령어 재등록", style: 2 },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "cdc:palette",
              placeholder: "작업 선택",
              min_values: 1,
              max_values: 1,
              options: expect.arrayContaining([
                { label: "파일 탐색", value: "browse" },
                { label: "Git 상태", value: "git-status" },
                { label: "Git 충돌 점검", value: "git-conflicts" },
                { label: "테스트 실행", value: "test" },
                { label: "동기화 상태", value: "sync-status" },
              ]),
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain("Codex 프로젝트 요약");
    expect(JSON.stringify(payload)).not.toContain("Codex에게 요청");
  });

  it("formats session-linked help with Codex, archive, and workspace actions", () => {
    const payload = formatHelp("session-linked");

    expectActionRowsWithinDiscordLimits(payload);
    expect(payload).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Codex 운영 콘솔 사용법",
          color: 0x95a5a6,
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: "Session slash commands",
              value: expect.stringContaining("/skill"),
            }),
            expect.objectContaining({
              name: "Session controls",
              value: expect.stringContaining("summarize 이번 채널"),
            }),
            expect.objectContaining({
              name: "Channel boundary",
              value: expect.stringContaining("session 채널은 Codex 대화 전용입니다."),
            }),
          ]),
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:codex:ask", label: "Codex에게 요청", style: 3 },
            { type: 2, custom_id: "cdc:fs:refresh", label: "파일 보기", style: 1 },
            { type: 2, custom_id: "cdc:git:status", label: "Git 상태", style: 2 },
            { type: 2, custom_id: "cdc:test:run", label: "테스트 실행", style: 1 },
            { type: 2, custom_id: "cdc:archive:current:confirm", label: "이 세션 보관", style: 4 },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:git:review", label: "Codex 리뷰", style: 3 },
            { type: 2, custom_id: "cdc:test:fix", label: "테스트 수정", style: 3 },
            { type: 2, custom_id: "cdc:git:conflicts", label: "충돌 점검", style: 2 },
            { type: 2, custom_id: "cdc:maintenance:panel", label: "유지보수", style: 2 },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "cdc:palette",
              placeholder: "작업 선택",
              min_values: 1,
              max_values: 1,
              options: expect.arrayContaining([
                { label: "파일 탐색", value: "browse" },
                { label: "Git 상태", value: "git-status" },
                { label: "Git 충돌 점검", value: "git-conflicts" },
                { label: "테스트 실행", value: "test" },
                { label: "Codex 프로젝트 요약", value: "codex-summary" },
                { label: "Codex 변경 리뷰", value: "codex-review" },
                { label: "Codex 테스트 수정", value: "fix-tests" },
              ]),
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain("동기화 상태");
    expect(JSON.stringify(payload)).not.toContain("봇 명령어 재등록");
  });

  it("formats Claude Code channel help without Codex-only actions", () => {
    const payload = formatHelp("claude-code");

    expectActionRowsWithinDiscordLimits(payload);
    expect(payload).toEqual(
      expect.objectContaining({
        allowedMentions: { parse: [] },
        embeds: [
          expect.objectContaining({
            title: "Codex 운영 콘솔 사용법",
            description: expect.stringContaining("Claude Code 전용"),
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: "Claude Code",
                value: expect.stringContaining("Claude Code headless"),
              }),
              expect.objectContaining({
                name: "Channel boundary",
                value: expect.stringContaining("Claude Code 전용"),
              }),
            ]),
          }),
        ],
        components: expect.any(Array),
      }),
    );
    expect(JSON.stringify(payload)).not.toContain("Codex에게 요청");
    expect(JSON.stringify(payload)).not.toContain("Codex 리뷰");
    expect(JSON.stringify(payload)).not.toContain("이 세션 보관");
  });

  it("formats a maintenance panel with button-first Git and test actions", () => {
    expect(formatMaintenancePanel("shell-admin")).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "유지보수 패널",
          description: expect.stringContaining("버튼으로 Git 상태"),
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:self:dev-chat", label: "봇 개발 채팅", style: 1 },
            { type: 2, custom_id: "cdc:git:status", label: "Git 상태", style: 1 },
            { type: 2, custom_id: "cdc:git:diff", label: "Diff 보기", style: 2 },
            { type: 2, custom_id: "cdc:git:conflicts", label: "충돌 점검", style: 2 },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:verify:typecheck", label: "타입체크", style: 1 },
            { type: 2, custom_id: "cdc:test:run", label: "테스트 실행", style: 1 },
            { type: 2, custom_id: "cdc:reload:commands", label: "명령어 재등록", style: 2 },
            { type: 2, custom_id: "cdc:reload:restart:confirm", label: "봇 재시작", style: 4 },
          ],
        },
      ],
    });

    expect(formatMaintenancePanel("session-linked").components?.[1]?.components).toContainEqual({
      type: 2,
      custom_id: "cdc:test:fix",
      label: "테스트 수정",
      style: 3,
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
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:sync:25", label: "세션 선택", style: 1 },
            { type: 2, custom_id: "cdc:sync:all:25", label: "전체 다시 동기화", style: 2 },
            { type: 2, custom_id: "cdc:delete:preview", label: "삭제 미리보기", style: 2 },
          ],
        },
      ],
    });
  });

  it("formats channel and sync status cards", () => {
    expect(
      formatChannelStatus({
        channelMode: "session-linked",
        computerDisplayName: "Local Dev",
        workspaceDisplayName: "repo",
        workspaceRoot: "/repo",
        cwd: "/repo/apps",
        codexSessionId: "session-1",
        timeoutMs: 300_000,
      }),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Current channel target",
          fields: expect.arrayContaining([
            { name: "Mode", value: "`session-linked`", inline: true },
            { name: "Target", value: "`Local Dev` / `repo`", inline: false },
            { name: "Working directory", value: "`/repo/apps`", inline: false },
            { name: "Codex session", value: "`session-1`", inline: false },
          ]),
        }),
      ],
      components: expect.any(Array),
    });

    expect(
      formatSyncStatus({
        workspaceCount: 2,
        sessionChannelCount: 5,
        archivedSessionCount: 3,
        contextPostedCount: 4,
        transcriptSyncMode: "realtime",
        transcriptSyncedChannelCount: 2,
      }),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Codex sync status",
          fields: expect.arrayContaining([
            { name: "Categories", value: "`2`", inline: true },
            { name: "Session channels", value: "`5`", inline: true },
            { name: "Archived sessions", value: "`3`", inline: true },
            { name: "Context previews posted", value: "`4`", inline: true },
            { name: "Transcript sync mode", value: "`realtime`", inline: true },
            { name: "Transcript markers", value: "`2`", inline: true },
          ]),
        }),
      ],
      components: expect.any(Array),
    });

    expect(formatSyncModeResult({ mode: "on-chat" })).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Transcript sync mode updated",
          fields: expect.arrayContaining([{ name: "Mode", value: "`on-chat`", inline: true }]),
        }),
      ],
      components: expect.any(Array),
    });
  });

  it("formats Claude Code channel status with a Claude session field", () => {
    const payload = formatChannelStatus({
      channelMode: "claude-code",
      computerDisplayName: "Local Dev",
      workspaceDisplayName: "repo",
      workspaceRoot: "/repo",
      cwd: "/repo/apps",
      claudeSessionId: "claude-session-1",
      timeoutMs: 300_000,
    });

    expect(payload).toEqual(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              { name: "Mode", value: "`claude-code`", inline: true },
              { name: "Claude session", value: "`claude-session-1`", inline: false },
            ]),
          }),
        ],
      }),
    );
    expect(JSON.stringify(payload)).not.toContain("Codex session");
    expect(JSON.stringify(payload)).not.toContain("Codex model");
  });

  it("formats bot reload confirmation and result cards", () => {
    expect(formatReloadConfirmation()).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Bot restart confirmation",
          color: 0xf1c40f,
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:reload:commands", label: "명령어만 재등록", style: 1 },
            { type: 2, custom_id: "cdc:reload:restart:confirm", label: "봇 재시작", style: 4 },
          ],
        },
      ],
    });

    expect(formatReloadAck({ mode: "commands" })).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Bot reload started",
          fields: expect.arrayContaining([{ name: "Mode", value: "`commands`", inline: true }]),
        }),
      ],
    });

    expect(
      formatReloadResult({
        result: {
          mode: "restart",
          commandCount: 18,
          restarting: true,
          startedAt: "2026-04-23T12:00:00.000Z",
        },
      }),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Bot reload complete",
          color: 0x2ecc71,
          fields: expect.arrayContaining([
            { name: "Mode", value: "`restart`", inline: true },
            { name: "Slash commands", value: "`18`", inline: true },
            { name: "Restarting", value: "`yes`", inline: true },
          ]),
        }),
      ],
    });
  });

  it("formats a multi-select Codex session picker for selective sync", () => {
    expect(
      formatSyncSelection({
        sessions: [
          {
            id: "019db2be-b2b3-7e82-9e61-8c84b28ad287",
            threadName: "Codex Discord sync design",
            updatedAt: "2026-04-23T10:00:00.000Z",
            workspaceDisplayName: "CodexDiscordConnector",
          },
          {
            id: "019db2be-b2b3-7e82-9e61-8c84b28ad288",
            threadName: "Direct mode setup",
            updatedAt: "2026-04-23T09:00:00.000Z",
            workspaceDisplayName: "CodexDiscordConnector",
          },
        ],
        totalAvailable: 2,
        limit: 25,
      }),
    ).toEqual({
      allowedMentions: { parse: [] },
      embeds: [
        expect.objectContaining({
          title: "Select Codex sessions to sync",
          color: 0x3498db,
          fields: expect.arrayContaining([
            { name: "Shown sessions", value: "`2 / 2`", inline: true },
            { name: "Selection limit", value: "`25`", inline: true },
          ]),
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "cdc:sync:selected",
              placeholder: "동기화할 Codex 세션 선택",
              min_values: 1,
              max_values: 2,
              options: [
                {
                  label: "Codex Discord sync design",
                  value: "019db2be-b2b3-7e82-9e61-8c84b28ad287",
                  description: "CodexDiscordConnector · 2026-04-23T10:00:00.000Z",
                },
                {
                  label: "Direct mode setup",
                  value: "019db2be-b2b3-7e82-9e61-8c84b28ad288",
                  description: "CodexDiscordConnector · 2026-04-23T09:00:00.000Z",
                },
              ],
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:sync:select:25", label: "목록 새로고침", style: 2 },
            { type: 2, custom_id: "cdc:sync:all:25", label: "전체 활성 세션 동기화", style: 1 },
          ],
        },
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
      channelOptions: [
        {
          sessionId: "session-1",
          channelName: "build-bridge",
          workspaceDisplayName: "repo",
          updatedAt: "2026-04-23T00:00:00.000Z",
        },
      ],
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
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: "cdc:delete:channels:confirm", label: "채널만 삭제", style: 4 },
            { type: 2, custom_id: "cdc:delete:all:confirm", label: "채널+카테고리 삭제", style: 4 },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "cdc:delete:session:selected",
              placeholder: "삭제할 채널 하나 선택",
              min_values: 1,
              max_values: 1,
              options: [
                {
                  label: "build-bridge",
                  value: "session-1",
                  description: "repo · 2026-04-23T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(
      formatDeletePreview({
        mode: "session",
        sessionId: "session-1",
        channelCount: 1,
        categoryCount: 0,
        channelNames: ["build-bridge"],
        categoryNames: [],
        channelOptions: [
          {
            sessionId: "session-1",
            channelName: "build-bridge",
            workspaceDisplayName: "repo",
            updatedAt: "2026-04-23T00:00:00.000Z",
          },
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        components: [
          {
            type: 1,
            components: [
              { type: 2, custom_id: "cdc:delete:session:session-1:confirm", label: "이 채널 삭제", style: 4 },
            ],
          },
        ],
      }),
    );
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

  it("formats schedule command results", () => {
    expect(
      formatScheduleResult({
        status: "created",
        schedule: {
          id: "sched-1",
          channelId: "channel-1",
          userId: "user-1",
          roleIds: ["role-operator"],
          command: "shell pwd",
          schedule: { type: "interval", everyMs: 600_000 },
          enabled: true,
          nextRunAt: "2026-04-24T01:10:00.000Z",
          createdAt: "2026-04-24T01:00:00.000Z",
          updatedAt: "2026-04-24T01:00:00.000Z",
          runCount: 0,
        },
      }),
    ).toEqual(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: "Schedule created",
            fields: expect.arrayContaining([
              { name: "ID", value: "`sched-1`", inline: true },
              { name: "Command", value: "```text\nshell pwd\n```", inline: false },
            ]),
          }),
        ],
      }),
    );
  });
});
