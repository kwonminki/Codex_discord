export const COMPONENT_IDS = {
  syncDefault: "cdc:sync:25",
  syncAllDefault: "cdc:sync:all:25",
  syncSelectDefault: "cdc:sync:select:25",
  syncSelected: "cdc:sync:selected",
  syncModeOnChat: "cdc:sync:mode:on-chat",
  syncModeRealtime: "cdc:sync:mode:realtime",
  newGeneralChat: "cdc:chat:new:general",
  newCurrentFolderChat: "cdc:chat:new:current",
  newHereChat: "cdc:chat:new:here",
  selfDevChat: "cdc:self:dev-chat",
  deletePreview: "cdc:delete:preview",
  deleteSessionSelected: "cdc:delete:session:selected",
  deleteChannelsConfirm: "cdc:delete:channels:confirm",
  deleteAllConfirm: "cdc:delete:all:confirm",
  archiveCurrentConfirm: "cdc:archive:current:confirm",
  fileSystemUp: "cdc:fs:up",
  fileSystemRefresh: "cdc:fs:refresh",
  fileSystemOpen: "cdc:fs:open",
  fileSystemView: "cdc:fs:view",
  fileSystemSummarize: "cdc:fs:summarize",
  fileSystemEdit: "cdc:fs:edit",
  palette: "cdc:palette",
  maintenancePanel: "cdc:maintenance:panel",
  codexAsk: "cdc:codex:ask",
  codexSubmit: "cdc:codex:submit",
  codexThoughtsOpen: "cdc:codex:thoughts:open",
  codexThoughtsClose: "cdc:codex:thoughts:close",
  codexOpenSessionPrefix: "cdc:codex:open:",
  gitDiff: "cdc:git:diff",
  gitStatus: "cdc:git:status",
  gitConflicts: "cdc:git:conflicts",
  gitReview: "cdc:git:review",
  testRun: "cdc:test:run",
  testFix: "cdc:test:fix",
  verifyTypecheck: "cdc:verify:typecheck",
  reloadCommands: "cdc:reload:commands",
  reloadRestartConfirm: "cdc:reload:restart:confirm",
} as const;

function componentShellCommand(command: string): string {
  return `__cdc_exec ${command}`;
}

function codexOpenShellCommand(sessionId: string): string {
  return `open 'codex://threads/${sessionId.toLowerCase()}'`;
}

function encodedNewChatCommand(input: {
  name: string | null;
  cwd: string | null;
  useCategory: boolean;
  initialPrompt: string | null;
}): string {
  return `__cdc_new_chat ${encodeURIComponent(JSON.stringify(input))}`;
}

function quoteShellToken(value: string): string | null {
  const normalized = value.replace(/\/$/, "").trim();

  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    /[\0\r\n`$;&|<>/]/.test(normalized)
  ) {
    return null;
  }

  if (/^[A-Za-z0-9._-]+$/.test(normalized)) {
    return normalized;
  }

  return `'${normalized.replace(/'/g, "'\\''")}'`;
}

function selectedSessionIds(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^[0-9a-f-]{32,36}$/i.test(value)),
    ),
  ];
}

export function routeDiscordComponent(customId: string, values: string[] = []): string | null {
  const codexOpenSessionMatch = customId.match(/^cdc:codex:open:([0-9a-f-]{32,36})$/i);

  if (codexOpenSessionMatch) {
    return componentShellCommand(codexOpenShellCommand(codexOpenSessionMatch[1] ?? ""));
  }

  const pageMatch = customId.match(/^cdc:fs:page:(\d+)$/);

  if (pageMatch) {
    return componentShellCommand(`__cdc_ls ${pageMatch[1]}`);
  }

  const deleteSessionConfirmMatch = customId.match(/^cdc:delete:session:([A-Za-z0-9._:-]{1,128}):confirm$/);

  if (deleteSessionConfirmMatch) {
    return `sync delete session ${deleteSessionConfirmMatch[1]} confirm`;
  }

  switch (customId) {
    case COMPONENT_IDS.syncDefault:
      return "sync select 25";
    case COMPONENT_IDS.syncAllDefault:
      return "sync all 25";
    case COMPONENT_IDS.syncSelectDefault:
      return "sync select 25";
    case COMPONENT_IDS.syncModeOnChat:
      return "sync mode on-chat";
    case COMPONENT_IDS.syncModeRealtime:
      return "sync mode realtime";
    case COMPONENT_IDS.newGeneralChat:
      return "chat new";
    case COMPONENT_IDS.newCurrentFolderChat:
      return "chat new current";
    case COMPONENT_IDS.newHereChat:
      return "chat new current";
    case COMPONENT_IDS.selfDevChat:
      return encodedNewChatCommand({
        name: "봇 유지보수",
        cwd: ".",
        useCategory: true,
        initialPrompt:
          "이 세션은 Codex Discord Connector 봇 자체를 Discord에서 유지보수하기 위한 세션입니다. 변경 전 Git 상태를 확인하고, 수정 후 pnpm typecheck와 pnpm test를 실행한 뒤, Discord에서 reload 또는 봇 재시작으로 반영할 수 있게 안내해줘.",
      });
    case COMPONENT_IDS.syncSelected: {
      const sessionIds = selectedSessionIds(values);
      return sessionIds.length > 0 ? `sync selected ${sessionIds.join(" ")}` : null;
    }
    case COMPONENT_IDS.deletePreview:
      return "sync delete preview";
    case COMPONENT_IDS.deleteSessionSelected: {
      const sessionId = values[0]?.trim();
      return sessionId && /^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)
        ? `sync delete session ${sessionId}`
        : null;
    }
    case COMPONENT_IDS.deleteChannelsConfirm:
      return "sync delete channels confirm";
    case COMPONENT_IDS.deleteAllConfirm:
      return "sync delete all confirm";
    case COMPONENT_IDS.archiveCurrentConfirm:
      return "archive confirm";
    case COMPONENT_IDS.maintenancePanel:
      return "maintenance";
    case COMPONENT_IDS.fileSystemUp:
      return componentShellCommand("cd ..");
    case COMPONENT_IDS.fileSystemRefresh:
      return componentShellCommand("__cdc_ls 0");
    case COMPONENT_IDS.fileSystemOpen: {
      const target = quoteShellToken(values[0] ?? "");
      return target ? componentShellCommand(`__cdc_open ${target}`) : null;
    }
    case COMPONENT_IDS.fileSystemView: {
      const target = quoteShellToken(values[0] ?? "");
      return target ? componentShellCommand(`__cdc_view ${target}`) : null;
    }
    case COMPONENT_IDS.fileSystemSummarize: {
      const target = quoteShellToken(values[0] ?? "");
      return target ? `codex 선택한 파일을 요약해줘: ${target}` : null;
    }
    case COMPONENT_IDS.fileSystemEdit: {
      const target = quoteShellToken(values[0] ?? "");
      return target ? `codex 선택한 파일을 개선하거나 수정해줘. 파일: ${target}` : null;
    }
    case COMPONENT_IDS.palette: {
      switch (values[0]) {
        case "browse":
          return componentShellCommand("__cdc_ls 0");
        case "where":
          return "where";
        case "sync-status":
          return "sync status";
        case "reload-commands":
          return "reload commands";
        case "git-status":
          return componentShellCommand("git status --short");
        case "git-diff":
          return componentShellCommand("git diff --stat");
        case "git-conflicts":
          return componentShellCommand("git diff --check");
        case "test":
          return componentShellCommand("pnpm test");
        case "codex-summary":
          return "codex 현재 프로젝트 상태를 요약하고 다음 액션을 제안해줘";
        case "codex-review":
          return "__cdc_codex_review 현재 변경사항을 리뷰하고 위험한 부분을 알려줘";
        case "fix-tests":
          return "codex 테스트를 실행하고 실패 원인을 분석한 뒤 수정해줘. 수정 후 테스트를 다시 실행해줘";
        default:
          return null;
      }
    }
    case COMPONENT_IDS.gitDiff:
      return componentShellCommand("git diff --stat");
    case COMPONENT_IDS.gitStatus:
      return componentShellCommand("git status --short");
    case COMPONENT_IDS.gitConflicts:
      return componentShellCommand("git diff --check");
    case COMPONENT_IDS.gitReview:
      return "__cdc_codex_review 현재 변경사항을 리뷰하고 위험한 부분을 알려줘";
    case COMPONENT_IDS.testRun:
      return componentShellCommand("pnpm test");
    case COMPONENT_IDS.testFix:
      return "codex 테스트 실패를 분석하고 수정해줘. 수정 후 테스트도 다시 실행해줘";
    case COMPONENT_IDS.verifyTypecheck:
      return componentShellCommand("pnpm typecheck");
    case COMPONENT_IDS.reloadCommands:
      return "reload commands";
    case COMPONENT_IDS.reloadRestartConfirm:
      return "reload restart confirm";
    default:
      return null;
  }
}
