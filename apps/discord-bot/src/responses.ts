import { existsSync } from "node:fs";
import path from "node:path";
import { COMPONENT_IDS } from "./componentRouter.js";
import type { ScheduledCommandState, TranscriptSyncMode } from "./directState.js";
import type { ScheduleCommandResult } from "./scheduler.js";

const COLORS = {
  queued: 0xf1c40f,
  codex: 0x3498db,
  neutral: 0x95a5a6,
  success: 0x2ecc71,
  failure: 0xe74c3c,
} as const;

const BUTTON_STYLES = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
} as const;

const MAX_FIELD_VALUE_LENGTH = 1_024;
const MAX_EMBED_DESCRIPTION_LENGTH = 4_096;
const MAX_MESSAGE_CONTENT_LENGTH = 1_900;
const ATTACH_TEXT_THRESHOLD = 1_000;
const CODEX_PROGRESS_EVENT_LIMIT = 8;

type ChannelMode = "shell-admin" | "session-linked";

export interface DiscordEmbedFieldPayload {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedPayload {
  title: string;
  color: number;
  description?: string;
  fields?: DiscordEmbedFieldPayload[];
}

export interface DiscordMessagePayload {
  allowedMentions: {
    parse: [];
  };
  content?: string;
  ephemeral?: boolean;
  embeds: DiscordEmbedPayload[];
  components?: DiscordActionRowPayload[];
  files?: DiscordFilePayload[];
}

export interface CodexProgressMessageInput {
  computerDisplayName: string;
  workspaceDisplayName: string;
  cwd: string;
  prompt: string;
}

export interface CodexProgressState {
  status: string;
  sessionId?: string | null;
  latestMessage?: string | null;
  recentEvents?: string[];
}

export interface CodexProgressRenderOptions {
  expanded?: boolean;
  actionRows?: DiscordActionRowPayload[];
}

export interface CodexProgressView {
  input: CodexProgressMessageInput;
  progress: CodexProgressState;
  expanded: boolean;
}

export interface CollapsibleThoughtView {
  collapsedContent: string;
  expandedContent: string;
  expanded: boolean;
  actionRows?: DiscordActionRowPayload[];
}

export type CodexThoughtView =
  | { kind: "progress"; view: CodexProgressView }
  | { kind: "collapsible"; view: CollapsibleThoughtView };

const codexProgressViews = new WeakMap<DiscordMessagePayload, CodexProgressView>();
const collapsibleThoughtViews = new WeakMap<DiscordMessagePayload, CollapsibleThoughtView>();

export interface DiscordFilePayload {
  attachment: string | Buffer;
  name?: string;
}

export interface DiscordButtonPayload {
  type: 2;
  custom_id: string;
  label: string;
  style: number;
}

export interface DiscordSelectOptionPayload {
  label: string;
  value: string;
  description?: string;
}

export interface DiscordSelectMenuPayload {
  type: 3;
  custom_id: string;
  placeholder: string;
  min_values: number;
  max_values: number;
  options: DiscordSelectOptionPayload[];
}

export interface DiscordActionRowPayload {
  type: 1;
  components: Array<DiscordButtonPayload | DiscordSelectMenuPayload>;
}

interface FileBrowserUiPayload {
  kind: "file-browser";
  page: number;
  pageSize: number;
  totalEntries: number;
  entries: Array<{
    name: string;
    kind: "directory" | "file" | "other";
  }>;
}

interface FileCardUiPayload {
  kind: "file-card";
  path: string;
  preview: string;
}

type CommandUiPayload = FileBrowserUiPayload | FileCardUiPayload;

function sanitizeInlineDiscordText(value: string): string {
  return value.replace(/\r?\n+/g, " ").replace(/`/g, "'").replace(/@/g, "[at]");
}

function sanitizeBlockDiscordText(value: string): string {
  return value.replace(/```/g, "'''").replace(/`/g, "'").replace(/@/g, "[at]").trimEnd();
}

function sanitizeDiscordMarkdown(value: string): string {
  return value.replace(/@/g, "[at]").trimEnd();
}

function wrapDiscordText(value: string): string {
  return `\`${sanitizeInlineDiscordText(value)}\``;
}

function truncateFieldValue(value: string): string {
  if (value.length <= MAX_FIELD_VALUE_LENGTH) {
    return value;
  }

  const suffix = "\n... (일부만 표시)";
  return `${value.slice(0, MAX_FIELD_VALUE_LENGTH - suffix.length)}${suffix}`;
}

function truncateDescription(value: string): string {
  if (value.length <= MAX_EMBED_DESCRIPTION_LENGTH) {
    return value;
  }

  const suffix = "\n\n... (일부만 표시)";
  return `${value.slice(0, MAX_EMBED_DESCRIPTION_LENGTH - suffix.length)}${suffix}`;
}

function truncateMessageContent(value: string): string {
  if (value.length <= MAX_MESSAGE_CONTENT_LENGTH) {
    return value;
  }

  const suffix = "\n\n... (일부만 표시)";
  return `${value.slice(0, MAX_MESSAGE_CONTENT_LENGTH - suffix.length)}${suffix}`;
}

function codeBlock(value: string, language: string): string {
  const sanitizedValue = sanitizeBlockDiscordText(value);
  const body = sanitizedValue.length > 0 ? sanitizedValue : "(no output)";
  const fence = `\`\`\`${language}\n`;
  const closingFence = "\n```";
  const availableBodyLength = MAX_FIELD_VALUE_LENGTH - fence.length - closingFence.length;
  const clippedBody =
    body.length <= availableBodyLength
      ? body
      : `${body.slice(0, availableBodyLength - "\n... (일부만 표시)".length)}\n... (일부만 표시)`;

  return `${fence}${clippedBody}${closingFence}`;
}

function textAttachment(name: string, content: string): DiscordFilePayload {
  return {
    attachment: Buffer.from(content, "utf8"),
    name,
  };
}

function previewCodeBlockWithAttachmentNotice(input: {
  value: string;
  language: string;
  attachmentName: string;
  label: string;
}): string {
  const notice = `\n${input.label}은 첨부 파일 \`${input.attachmentName}\`에서 확인하세요.`;
  const sanitizedValue = sanitizeBlockDiscordText(input.value);
  const fence = `\`\`\`${input.language}\n`;
  const closingFence = "\n```";
  const maxBodyLength = Math.max(0, MAX_FIELD_VALUE_LENGTH - fence.length - closingFence.length - notice.length);
  const previewBody = sanitizedValue.length <= maxBodyLength ? sanitizedValue : sanitizedValue.slice(0, maxBodyLength).trimEnd();

  return `${fence}${previewBody || "(no output)"}${closingFence}${notice}`;
}

function previewMessageWithAttachment(input: {
  content: string;
  attachmentName: string;
  notice: string;
}): string {
  const sanitized = sanitizeDiscordMarkdown(input.content);
  const suffix = `\n\n${input.notice} \`${input.attachmentName}\`에서 확인하세요.`;
  const maxPreviewLength = Math.max(0, MAX_MESSAGE_CONTENT_LENGTH - suffix.length);
  const preview = sanitized.length <= maxPreviewLength ? sanitized : sanitized.slice(0, maxPreviewLength).trimEnd();

  return `${preview}${suffix}`;
}

function messagePayload(embed: DiscordEmbedPayload, components?: DiscordActionRowPayload[]): DiscordMessagePayload {
  const payload: DiscordMessagePayload = {
    allowedMentions: { parse: [] },
    embeds: [embed],
  };

  if (components && components.length > 0) {
    payload.components = components;
  }

  return payload;
}

function isImageReference(value: string): boolean {
  return /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(value);
}

function normalizeLocalImagePath(reference: string): string | null {
  if (reference.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(reference).pathname);
    } catch {
      return null;
    }
  }

  return path.isAbsolute(reference) ? reference : null;
}

function extractImageOutputs(text: string): { attachments: DiscordFilePayload[]; remoteUrls: string[] } {
  const attachments: DiscordFilePayload[] = [];
  const remoteUrls: string[] = [];
  const seenReferences = new Set<string>();
  const markdownImagePattern = /!\[[^\]]*]\(([^)]+)\)/g;

  for (const match of text.matchAll(markdownImagePattern)) {
    const rawReference = (match[1] ?? "").trim().replace(/^<|>$/g, "");

    if (!rawReference || seenReferences.has(rawReference) || !isImageReference(rawReference)) {
      continue;
    }

    seenReferences.add(rawReference);

    if (/^https?:\/\//i.test(rawReference)) {
      remoteUrls.push(rawReference);
      continue;
    }

    const localPath = normalizeLocalImagePath(rawReference);

    if (localPath && existsSync(localPath)) {
      attachments.push({
        attachment: localPath,
        name: path.basename(localPath) || "codex-image.png",
      });
    }
  }

  return { attachments, remoteUrls };
}

function stripAttachedLocalImageMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*]\(([^)]+)\)/g, (match, reference: string) => {
      const rawReference = String(reference ?? "").trim().replace(/^<|>$/g, "");

      if (/^https?:\/\//i.test(rawReference)) {
        return match;
      }

      const localPath = normalizeLocalImagePath(rawReference);
      return localPath && existsSync(localPath) ? "" : match;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textPayload(content: string): DiscordMessagePayload {
  return {
    allowedMentions: { parse: [] },
    content: truncateMessageContent(sanitizeDiscordMarkdown(content)),
    embeds: [],
  };
}

function button(input: { customId: string; label: string; style: number }): DiscordButtonPayload {
  return {
    type: 2,
    custom_id: input.customId,
    label: input.label,
    style: input.style,
  };
}

function truncateSelectText(value: string, limit = 100): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function selectMenu(input: {
  customId: string;
  placeholder: string;
  options: DiscordSelectOptionPayload[];
  minValues?: number;
  maxValues?: number;
}): DiscordSelectMenuPayload {
  return {
    type: 3,
    custom_id: input.customId,
    placeholder: input.placeholder,
    min_values: input.minValues ?? 1,
    max_values: input.maxValues ?? 1,
    options: input.options,
  };
}

function actionRow(components: Array<DiscordButtonPayload | DiscordSelectMenuPayload>): DiscordActionRowPayload {
  return {
    type: 1,
    components,
  };
}

function commandPaletteActions(channelMode: ChannelMode): DiscordActionRowPayload {
  const adminOptions: DiscordSelectOptionPayload[] = [
    { label: "현재 채널 상태", value: "where" },
    { label: "파일 탐색", value: "browse" },
    { label: "동기화 상태", value: "sync-status" },
    { label: "봇 명령어 재등록", value: "reload-commands" },
    { label: "Git 상태", value: "git-status" },
    { label: "Git 변경 요약", value: "git-diff" },
    { label: "Git 충돌 점검", value: "git-conflicts" },
    { label: "테스트 실행", value: "test" },
  ];
  const sessionOptions: DiscordSelectOptionPayload[] = [
    { label: "현재 채널 상태", value: "where" },
    { label: "파일 탐색", value: "browse" },
    { label: "Git 상태", value: "git-status" },
    { label: "Git 변경 요약", value: "git-diff" },
    { label: "Git 충돌 점검", value: "git-conflicts" },
    { label: "테스트 실행", value: "test" },
    { label: "Codex 프로젝트 요약", value: "codex-summary" },
    { label: "Codex 변경 리뷰", value: "codex-review" },
    { label: "Codex 테스트 수정", value: "fix-tests" },
  ];

  return actionRow([
    selectMenu({
      customId: COMPONENT_IDS.palette,
      placeholder: "작업 선택",
      options: channelMode === "shell-admin" ? adminOptions : sessionOptions,
    }),
  ]);
}

function adminQuickActions(): DiscordActionRowPayload[] {
  return [
    actionRow([
      button({
        customId: COMPONENT_IDS.newGeneralChat,
        label: "새 일반 채팅",
        style: BUTTON_STYLES.primary,
      }),
      button({
        customId: COMPONENT_IDS.newCurrentFolderChat,
        label: "현재 폴더 채팅",
        style: BUTTON_STYLES.primary,
      }),
      button({
        customId: COMPONENT_IDS.syncDefault,
        label: "세션 선택 동기화",
        style: BUTTON_STYLES.primary,
      }),
      button({
        customId: COMPONENT_IDS.fileSystemRefresh,
        label: "파일 탐색",
        style: BUTTON_STYLES.secondary,
      }),
      button({
        customId: COMPONENT_IDS.maintenancePanel,
        label: "유지보수",
        style: BUTTON_STYLES.secondary,
      }),
    ]),
    actionRow([
      button({
        customId: COMPONENT_IDS.syncAllDefault,
        label: "전체 동기화",
        style: BUTTON_STYLES.secondary,
      }),
      button({
        customId: COMPONENT_IDS.deletePreview,
        label: "삭제 미리보기",
        style: BUTTON_STYLES.secondary,
      }),
      button({
        customId: COMPONENT_IDS.reloadCommands,
        label: "명령어 재등록",
        style: BUTTON_STYLES.secondary,
      }),
    ]),
    commandPaletteActions("shell-admin"),
  ];
}

function syncResultActions(): DiscordActionRowPayload[] {
  return [
    actionRow([
      button({
        customId: COMPONENT_IDS.syncDefault,
        label: "세션 선택",
        style: BUTTON_STYLES.primary,
      }),
      button({
        customId: COMPONENT_IDS.syncAllDefault,
        label: "전체 다시 동기화",
        style: BUTTON_STYLES.secondary,
      }),
      button({
        customId: COMPONENT_IDS.deletePreview,
        label: "삭제 미리보기",
        style: BUTTON_STYLES.secondary,
      }),
    ]),
  ];
}

function transcriptSyncModeActions(): DiscordActionRowPayload {
  return actionRow([
    button({
      customId: COMPONENT_IDS.syncModeOnChat,
      label: "채팅 시작 시 동기화",
      style: BUTTON_STYLES.primary,
    }),
    button({
      customId: COMPONENT_IDS.syncModeRealtime,
      label: "실시간 동기화",
      style: BUTTON_STYLES.success,
    }),
  ]);
}

function deletePreviewActions(input?: {
  mode?: "all" | "channels" | "session";
  sessionId?: string | null;
  channelOptions?: Array<{
    sessionId: string;
    channelName: string;
    workspaceDisplayName: string;
    updatedAt: string;
  }>;
}): DiscordActionRowPayload[] {
  if (input?.mode === "session" && input.sessionId) {
    return [
      actionRow([
        button({
          customId: `cdc:delete:session:${input.sessionId}:confirm`,
          label: "이 채널 삭제",
          style: BUTTON_STYLES.danger,
        }),
      ]),
    ];
  }

  const actions: DiscordActionRowPayload[] = [
    actionRow([
      button({
        customId: COMPONENT_IDS.deleteChannelsConfirm,
        label: "채널만 삭제",
        style: BUTTON_STYLES.danger,
      }),
      button({
        customId: COMPONENT_IDS.deleteAllConfirm,
        label: "채널+카테고리 삭제",
        style: BUTTON_STYLES.danger,
      }),
    ]),
  ];
  const options =
    input?.channelOptions?.slice(0, 25).map((channel) => ({
      label: truncateSelectText(channel.channelName),
      value: channel.sessionId,
      description: truncateSelectText(`${channel.workspaceDisplayName} · ${channel.updatedAt}`, 100),
    })) ?? [];

  if (options.length > 0) {
    actions.push(
      actionRow([
        selectMenu({
          customId: COMPONENT_IDS.deleteSessionSelected,
          placeholder: "삭제할 채널 하나 선택",
          minValues: 1,
          maxValues: 1,
          options,
        }),
      ]),
    );
  }

  return actions;
}

function archiveSessionActions(): DiscordActionRowPayload[] {
  return [
    actionRow([
      button({
        customId: COMPONENT_IDS.archiveCurrentConfirm,
        label: "이 세션 보관",
        style: BUTTON_STYLES.danger,
      }),
    ]),
  ];
}

function sessionHelpActions(): DiscordActionRowPayload[] {
  return [
    actionRow([
      button({
        customId: COMPONENT_IDS.codexAsk,
        label: "Codex에게 요청",
        style: BUTTON_STYLES.success,
      }),
      button({
        customId: COMPONENT_IDS.fileSystemRefresh,
        label: "파일 보기",
        style: BUTTON_STYLES.primary,
      }),
      button({
        customId: COMPONENT_IDS.gitStatus,
        label: "Git 상태",
        style: BUTTON_STYLES.secondary,
      }),
      button({
        customId: COMPONENT_IDS.testRun,
        label: "테스트 실행",
        style: BUTTON_STYLES.primary,
      }),
      button({
        customId: COMPONENT_IDS.archiveCurrentConfirm,
        label: "이 세션 보관",
        style: BUTTON_STYLES.danger,
      }),
    ]),
    actionRow([
      button({
        customId: COMPONENT_IDS.gitReview,
        label: "Codex 리뷰",
        style: BUTTON_STYLES.success,
      }),
      button({
        customId: COMPONENT_IDS.testFix,
        label: "테스트 수정",
        style: BUTTON_STYLES.success,
      }),
      button({
        customId: COMPONENT_IDS.gitConflicts,
        label: "충돌 점검",
        style: BUTTON_STYLES.secondary,
      }),
      button({
        customId: COMPONENT_IDS.maintenancePanel,
        label: "유지보수",
        style: BUTTON_STYLES.secondary,
      }),
    ]),
    commandPaletteActions("session-linked"),
  ];
}

function isLikelyFileSystemListCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed === "ls" || trimmed.startsWith("ls ") || trimmed.startsWith("__cdc_ls");
}

function parseFileSystemOptions(stdout: string): DiscordSelectOptionPayload[] {
  const seen = new Set<string>();
  const options: DiscordSelectOptionPayload[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const value = rawLine.trim();

    if (
      value.length === 0 ||
      value.length > 100 ||
      value === "." ||
      value === ".." ||
      /[\0\r\n`$;&|<>/]/.test(value.replace(/\/$/, ""))
    ) {
      continue;
    }

    const normalizedValue = value.replace(/\/$/, "");

    if (seen.has(normalizedValue)) {
      continue;
    }

    seen.add(normalizedValue);
    options.push({
      label: value.slice(0, 100),
      value: normalizedValue,
    });

    if (options.length >= 25) {
      break;
    }
  }

  return options;
}

function fileBrowserOptions(ui: FileBrowserUiPayload): DiscordSelectOptionPayload[] {
  return ui.entries.slice(0, 25).map((entry) => ({
    label: `${entry.name}${entry.kind === "directory" ? "/" : ""}`.slice(0, 100),
    value: entry.name.slice(0, 100),
  }));
}

function fileBrowserPaginationActions(ui: FileBrowserUiPayload): DiscordActionRowPayload | null {
  const totalPages = Math.max(1, Math.ceil(ui.totalEntries / Math.max(1, ui.pageSize)));
  const buttons: DiscordButtonPayload[] = [];

  if (ui.page > 0) {
    buttons.push(
      button({
        customId: `cdc:fs:page:${ui.page - 1}`,
        label: "이전 페이지",
        style: BUTTON_STYLES.secondary,
      }),
    );
  }

  if (ui.page < totalPages - 1) {
    buttons.push(
      button({
        customId: `cdc:fs:page:${ui.page + 1}`,
        label: "다음 페이지",
        style: BUTTON_STYLES.secondary,
      }),
    );
  }

  return buttons.length > 0 ? actionRow(buttons) : null;
}

function fileCardActions(ui: FileCardUiPayload, channelMode: ChannelMode): DiscordActionRowPayload[] {
  const navigationButtons: DiscordButtonPayload[] = [
    button({
      customId: COMPONENT_IDS.newHereChat,
      label: "여기서 새 채팅",
      style: BUTTON_STYLES.primary,
    }),
    button({
      customId: COMPONENT_IDS.fileSystemUp,
      label: "상위 폴더",
      style: BUTTON_STYLES.secondary,
    }),
    button({
      customId: COMPONENT_IDS.fileSystemRefresh,
      label: "목록으로",
      style: BUTTON_STYLES.primary,
    }),
  ];

  if (channelMode === "session-linked") {
    navigationButtons.push(
      button({
        customId: COMPONENT_IDS.codexAsk,
        label: "Codex에게 요청",
        style: BUTTON_STYLES.success,
      }),
    );
  }

  const rows: DiscordActionRowPayload[] = [actionRow(navigationButtons)];

  if (channelMode === "shell-admin") {
    return rows;
  }

  return [
    ...rows,
    actionRow([
      selectMenu({
        customId: COMPONENT_IDS.fileSystemSummarize,
        placeholder: "이 파일을 Codex로 요약",
        options: [{ label: ui.path.slice(0, 100), value: ui.path.slice(0, 100) }],
      }),
    ]),
    actionRow([
      selectMenu({
        customId: COMPONENT_IDS.fileSystemEdit,
        placeholder: "이 파일을 Codex로 개선/수정",
        options: [{ label: ui.path.slice(0, 100), value: ui.path.slice(0, 100) }],
      }),
    ]),
  ];
}

function fileSystemActions(input: {
  command: string;
  stdout: string;
  failed: boolean;
  ui: CommandUiPayload | null;
  channelMode: ChannelMode;
}): DiscordActionRowPayload[] | undefined {
  if (input.failed) {
    return undefined;
  }

  if (input.ui?.kind === "file-card") {
    return fileCardActions(input.ui, input.channelMode);
  }

  if (!input.ui && !isLikelyFileSystemListCommand(input.command)) {
    return undefined;
  }

  const options = input.ui?.kind === "file-browser" ? fileBrowserOptions(input.ui) : parseFileSystemOptions(input.stdout);
  const navigationButtons: DiscordButtonPayload[] = [
    button({
      customId: COMPONENT_IDS.fileSystemUp,
      label: "상위 폴더",
      style: BUTTON_STYLES.secondary,
    }),
    button({
      customId: COMPONENT_IDS.fileSystemRefresh,
      label: "새로고침",
      style: BUTTON_STYLES.primary,
    }),
  ];

  if (input.channelMode === "session-linked") {
    navigationButtons.push(
      button({
        customId: COMPONENT_IDS.codexAsk,
        label: "Codex에게 요청",
        style: BUTTON_STYLES.success,
      }),
    );
  }

  const rows: DiscordActionRowPayload[] = [actionRow(navigationButtons)];
  const paginationRow = input.ui?.kind === "file-browser" ? fileBrowserPaginationActions(input.ui) : null;

  if (paginationRow) {
    rows.push(paginationRow);
  }

  if (options.length > 0) {
    rows.push(
      actionRow([
        selectMenu({
          customId: COMPONENT_IDS.fileSystemOpen,
          placeholder: "항목 열기",
          options,
        }),
      ]),
    );
  }

  return rows;
}

function commandWorkflowActions(command: string, failed: boolean, channelMode: ChannelMode): DiscordActionRowPayload[] | undefined {
  const normalizedCommand = command.trim();
  const isTestCommand = /^(?:pnpm|npm|yarn|bun)\s+(?:test|vitest)(?:\s|$)/.test(normalizedCommand);

  if (!failed && /^git\s+status(?:\s+--short)?$/.test(normalizedCommand)) {
    const buttons = [
      button({
        customId: COMPONENT_IDS.gitDiff,
        label: "Diff 보기",
        style: BUTTON_STYLES.secondary,
      }),
      button({
        customId: COMPONENT_IDS.testRun,
        label: "테스트 실행",
        style: BUTTON_STYLES.primary,
      }),
    ];

    if (channelMode === "session-linked") {
      buttons.splice(
        1,
        0,
        button({
          customId: COMPONENT_IDS.gitReview,
          label: "Codex 리뷰",
          style: BUTTON_STYLES.success,
        }),
      );
    }

    return [actionRow(buttons)];
  }

  if (isTestCommand) {
    const buttons = [
      button({
        customId: COMPONENT_IDS.testRun,
        label: "테스트 다시 실행",
        style: BUTTON_STYLES.primary,
      }),
    ];

    if (channelMode === "session-linked") {
      buttons.push(
        button({
          customId: COMPONENT_IDS.testFix,
          label: "Codex에게 수정 요청",
          style: BUTTON_STYLES.success,
        }),
      );
    }

    return [actionRow(buttons)];
  }

  return undefined;
}

function normalizeCommandUi(ui: unknown): CommandUiPayload | null {
  if (typeof ui !== "object" || ui === null || !("kind" in ui)) {
    return null;
  }

  const maybeUi = ui as {
    kind?: unknown;
    page?: unknown;
    pageSize?: unknown;
    totalEntries?: unknown;
    entries?: unknown;
    path?: unknown;
    preview?: unknown;
  };

  if (
    maybeUi.kind === "file-browser" &&
    typeof maybeUi.page === "number" &&
    typeof maybeUi.pageSize === "number" &&
    typeof maybeUi.totalEntries === "number" &&
    Array.isArray(maybeUi.entries)
  ) {
    const entries = maybeUi.entries
      .map((entry) => {
        if (typeof entry !== "object" || entry === null) {
          return null;
        }

        const candidate = entry as { name?: unknown; kind?: unknown };

        if (
          typeof candidate.name !== "string" ||
          (candidate.kind !== "directory" && candidate.kind !== "file" && candidate.kind !== "other")
        ) {
          return null;
        }

        return {
          name: candidate.name,
          kind: candidate.kind,
        };
      })
      .filter((entry): entry is FileBrowserUiPayload["entries"][number] => entry !== null);

    return {
      kind: "file-browser",
      page: maybeUi.page,
      pageSize: maybeUi.pageSize,
      totalEntries: maybeUi.totalEntries,
      entries,
    };
  }

  if (maybeUi.kind === "file-card" && typeof maybeUi.path === "string" && typeof maybeUi.preview === "string") {
    return {
      kind: "file-card",
      path: maybeUi.path,
      preview: maybeUi.preview,
    };
  }

  return null;
}

export function formatCommandAck(input: {
  computerDisplayName: string;
  workspaceDisplayName: string;
  cwd: string;
  command: string;
}): DiscordMessagePayload {
  return messagePayload({
    title: "Command queued",
    color: COLORS.queued,
    fields: [
      ...formatCommandHeaderFields(input.cwd, input),
      {
        name: "Status",
        value: wrapDiscordText("queued"),
        inline: true,
      },
    ],
  });
}

function formatCommandHeaderFields(
  cwd: string,
  input: {
    computerDisplayName: string;
    workspaceDisplayName: string;
    command: string;
  },
): DiscordEmbedFieldPayload[] {
  return [
    {
      name: "Target",
      value: `${wrapDiscordText(input.computerDisplayName)} / ${wrapDiscordText(input.workspaceDisplayName)}`,
      inline: false,
    },
    {
      name: "Working directory",
      value: wrapDiscordText(cwd),
      inline: false,
    },
    {
      name: "Command",
      value: codeBlock(input.command, "bash"),
      inline: false,
    },
  ];
}

export function formatDenied(reason: string): DiscordMessagePayload {
  return messagePayload({
    title: "Permission denied",
    color: COLORS.failure,
    description: truncateFieldValue(wrapDiscordText(reason)),
  });
}

export function formatBlockedCommand(input: { reason: string; guidance: string }): DiscordMessagePayload {
  return messagePayload({
    title: "이 채널에서는 실행할 수 없습니다",
    color: COLORS.neutral,
    description: input.reason,
    fields: [
      {
        name: "다음 단계",
        value: input.guidance,
        inline: false,
      },
    ],
  });
}

export function formatHelp(channelMode: ChannelMode): DiscordMessagePayload {
  const adminSlashCommandField: DiscordEmbedFieldPayload = {
    name: "Admin slash commands",
    value: codeBlock(
      "/where 또는 /status\n/browse\n/shell command:pwd\n/diff\n/schedule action:create mode:every every:10m command:shell pwd\n/schedule action:list\n/schedule action:delete id:<id>\n/sync limit:25\n/sync-select limit:25\n/sync-all limit:25\n/sync-status\n/sync-mode mode:realtime\n/sync-delete mode:preview\n/sync-delete mode:session session_id:<id> confirm:true\n/sync-archive session_id:<id> confirm:true\n/chat-new name:새 작업 cwd:/path/to/project category:true\n/reload mode:commands",
      "text",
    ),
    inline: false,
  };
  const sessionSlashCommandField: DiscordEmbedFieldPayload = {
    name: "Session slash commands",
    value: codeBlock(
      "/codex prompt:README 요약해줘\n/review prompt:보안 위험 위주\n/fix-tests\n/summarize target:현재 채널\n/compact prompt:이번 작업 맥락 정리\n/skill name:frontend-design prompt:UI 개선해줘\n/model model:gpt-5.4\n/fast\n/task\n/codex-mode mode:default\n/schedule action:create mode:daily at:09:30 command:codex 오늘 계획 정리\n/archive\n/where 또는 /status\n/browse\n/shell command:pwd\n/diff",
      "text",
    ),
    inline: false,
  };
  const shellAdminFields: DiscordEmbedFieldPayload[] = [
    {
      name: "Start here",
      value: codeBlock(
        "where\nbrowse\nchat new name:새 작업\nsync\nsync status",
        "text",
      ),
      inline: false,
    },
    {
      name: "Codex chat workflow",
      value: codeBlock(
        "chat new name:README 정리\n새 채팅 채널에서: README에 사용법 추가해줘\nsync 또는 sync all 25",
        "text",
      ),
      inline: false,
    },
    {
      name: "Workspace operations",
      value: codeBlock("ls\npwd\ncd apps\ncat README.md\ngit status --short\npnpm test", "bash"),
      inline: false,
    },
    adminSlashCommandField,
    {
      name: "Careful operations",
      value: codeBlock(
        "schedule list\nschedule every 10m command:shell pwd\nschedule daily at 09:30 command:codex 오늘 계획 정리\nschedule weekly mon,wed,fri at 09:30 command:shell pnpm test\nschedule delete <id>\nsync all 25\nsync delete preview\nsync delete session <session-id>\nsync delete session <session-id> confirm\nsync delete all confirm\nreload restart confirm\nconfirm rm path/to/file",
        "text",
      ),
      inline: false,
    },
    {
      name: "Channel boundary",
      value: "main/admin 채널은 운영 전용입니다. Codex 대화, 리뷰, 테스트 수정, 모델 설정은 새 채팅 또는 동기화된 session 채널에서 실행하세요.",
      inline: false,
    },
  ];
  const sessionLinkedFields: DiscordEmbedFieldPayload[] = [
    {
      name: "Primary flow",
      value: codeBlock("그 파일 구조 설명해줘\n이 버그 고쳐줘\n테스트까지 돌려줘", "text"),
      inline: false,
    },
    {
      name: "Shell in this session",
      value: codeBlock("!ls\n!pwd\n!cd apps\n!cat README.md", "bash"),
      inline: false,
    },
    sessionSlashCommandField,
    {
      name: "Session controls",
      value: codeBlock(
        "model gpt-5.4\nfast\ntask\nmode default\nreview 보안 위험 위주\nfix-tests\nsummarize 이번 채널\ncompact 이번 작업 맥락 정리\nskill frontend-design UI 개선해줘\nschedule list\nschedule every 10m command:shell pwd\nschedule daily at 09:30 command:codex 오늘 계획 정리\narchive\narchive confirm\nstatus\ndiff\nbrowse\nshell pwd\ncodex-command mcp list",
        "text",
      ),
      inline: false,
    },
    {
      name: "Channel boundary",
      value: "session 채널은 Codex 대화 전용입니다. 세션 동기화, 새 채팅 생성, 봇 재등록/재시작은 main/admin 채널에서 실행하세요.",
      inline: false,
    },
  ];

  return messagePayload(
    {
      title: "Codex 운영 콘솔 사용법",
      color: COLORS.neutral,
      description:
        channelMode === "shell-admin"
          ? "main/admin 채널은 운영 전용입니다. 파일 탐색, 세션 생성/동기화, 봇 관리만 수행하고 Codex 대화는 session 채널에서 진행합니다."
          : "이 채널은 Codex 세션과 연결되어 있습니다. 자연어는 Codex로 보내고, shell 명령은 `!` 접두어를 붙입니다.",
      fields: channelMode === "shell-admin" ? shellAdminFields : sessionLinkedFields,
    },
    channelMode === "shell-admin" ? adminQuickActions() : sessionHelpActions(),
  );
}

export function formatMaintenancePanel(channelMode: ChannelMode): DiscordMessagePayload {
  const secondRow: DiscordButtonPayload[] =
    channelMode === "session-linked"
      ? [
          button({
            customId: COMPONENT_IDS.gitReview,
            label: "Codex 리뷰",
            style: BUTTON_STYLES.success,
          }),
          button({
            customId: COMPONENT_IDS.testFix,
            label: "테스트 수정",
            style: BUTTON_STYLES.success,
          }),
        ]
      : [
          button({
            customId: COMPONENT_IDS.reloadCommands,
            label: "명령어 재등록",
            style: BUTTON_STYLES.secondary,
          }),
          button({
            customId: COMPONENT_IDS.reloadRestartConfirm,
            label: "봇 재시작",
            style: BUTTON_STYLES.danger,
          }),
        ];

  return messagePayload(
    {
      title: "유지보수 패널",
      color: COLORS.neutral,
      description:
        channelMode === "session-linked"
          ? "버튼으로 Git 상태, Diff, 충돌 점검, 테스트 실행, Codex 리뷰와 테스트 수정을 이어갑니다."
          : "버튼으로 Git 상태, Diff, 충돌 점검, 테스트 실행, 명령어 재등록과 봇 재시작을 처리합니다.",
      fields: [
        {
          name: "권장 순서",
          value:
            channelMode === "session-linked"
              ? "Git 상태 → 충돌 점검 → 테스트 실행 → Codex 리뷰/수정"
              : "Git 상태 → 충돌 점검 → 테스트 실행 → 필요 시 명령어 재등록",
          inline: false,
        },
      ],
    },
    [
      actionRow([
        ...(channelMode === "shell-admin"
          ? [
              button({
                customId: COMPONENT_IDS.selfDevChat,
                label: "봇 개발 채팅",
                style: BUTTON_STYLES.primary,
              }),
            ]
          : []),
        button({
          customId: COMPONENT_IDS.gitStatus,
          label: "Git 상태",
          style: BUTTON_STYLES.primary,
        }),
        button({
          customId: COMPONENT_IDS.gitDiff,
          label: "Diff 보기",
          style: BUTTON_STYLES.secondary,
        }),
        button({
          customId: COMPONENT_IDS.gitConflicts,
          label: "충돌 점검",
          style: BUTTON_STYLES.secondary,
        }),
      ]),
      actionRow([
        button({
          customId: COMPONENT_IDS.verifyTypecheck,
          label: "타입체크",
          style: BUTTON_STYLES.primary,
        }),
        button({
          customId: COMPONENT_IDS.testRun,
          label: "테스트 실행",
          style: BUTTON_STYLES.primary,
        }),
        ...secondRow,
      ].slice(0, 5)),
    ],
  );
}

export function formatChannelStatus(input: {
  channelMode: string;
  computerDisplayName: string;
  workspaceDisplayName: string;
  workspaceRoot: string;
  cwd: string;
  codexSessionId?: string | null;
  codexModel?: string | null;
  timeoutMs: number;
}): DiscordMessagePayload {
  return messagePayload(
    {
      title: "Current channel target",
      color: COLORS.neutral,
      description: "이 Discord 채널이 현재 어디에 연결되어 있는지 보여줍니다.",
      fields: [
        {
          name: "Mode",
          value: wrapDiscordText(input.channelMode),
          inline: true,
        },
        {
          name: "Timeout",
          value: wrapDiscordText(`${Math.round(input.timeoutMs / 1_000)}s`),
          inline: true,
        },
        {
          name: "Target",
          value: `${wrapDiscordText(input.computerDisplayName)} / ${wrapDiscordText(input.workspaceDisplayName)}`,
          inline: false,
        },
        {
          name: "Workspace root",
          value: wrapDiscordText(input.workspaceRoot),
          inline: false,
        },
        {
          name: "Working directory",
          value: wrapDiscordText(input.cwd),
          inline: false,
        },
        {
          name: "Codex session",
          value: wrapDiscordText(input.codexSessionId ?? "(not linked yet)"),
          inline: false,
        },
        {
          name: "Codex model",
          value: wrapDiscordText(input.codexModel ?? "default"),
          inline: true,
        },
      ],
    },
    [
      actionRow([
        button({
          customId: COMPONENT_IDS.fileSystemRefresh,
          label: "파일 보기",
          style: BUTTON_STYLES.primary,
        }),
        button({
          customId: COMPONENT_IDS.codexAsk,
          label: "Codex에게 요청",
          style: BUTTON_STYLES.success,
        }),
      ]),
    ],
  );
}

export function formatCodexModelResult(input: { model: string }): DiscordMessagePayload {
  return messagePayload({
    title: "Codex model updated",
    color: COLORS.success,
    description: "이 Discord 채널의 이후 Codex 요청에 선택한 모델을 사용합니다. 봇이 재시작되면 기본 모델로 돌아갑니다.",
    fields: [
      {
        name: "Model",
        value: wrapDiscordText(input.model),
        inline: true,
      },
    ],
  });
}

export function formatCodexRunModeResult(input: {
  mode: "default" | "fast" | "task";
  reasoningEffort: "low" | "xhigh" | null;
}): DiscordMessagePayload {
  return messagePayload({
    title: "Codex mode updated",
    color: COLORS.success,
    description:
      input.mode === "default"
        ? "이 Discord 채널의 Codex 실행 모드를 기본 설정으로 되돌렸습니다."
        : "이 Discord 채널의 이후 Codex 요청에 선택한 실행 모드를 사용합니다. 봇이 재시작되면 기본 모드로 돌아갑니다.",
    fields: [
      {
        name: "Mode",
        value: wrapDiscordText(input.mode),
        inline: true,
      },
      {
        name: "Reasoning",
        value: wrapDiscordText(input.reasoningEffort ?? "config default"),
        inline: true,
      },
    ],
  });
}

export function formatSyncStatus(input: {
  workspaceCount: number;
  sessionChannelCount: number;
  archivedSessionCount: number;
  contextPostedCount: number;
  transcriptSyncMode: TranscriptSyncMode;
  transcriptSyncedChannelCount: number;
}): DiscordMessagePayload {
  return messagePayload(
    {
      title: "Codex sync status",
      color: COLORS.neutral,
      description: "현재 브리지 상태 파일에 기록된 동기화 요약입니다.",
      fields: [
        {
          name: "Categories",
          value: wrapDiscordText(String(input.workspaceCount)),
          inline: true,
        },
        {
          name: "Session channels",
          value: wrapDiscordText(String(input.sessionChannelCount)),
          inline: true,
        },
        {
          name: "Archived sessions",
          value: wrapDiscordText(String(input.archivedSessionCount)),
          inline: true,
        },
        {
          name: "Context previews posted",
          value: wrapDiscordText(String(input.contextPostedCount)),
          inline: true,
        },
        {
          name: "Transcript sync mode",
          value: wrapDiscordText(input.transcriptSyncMode),
          inline: true,
        },
        {
          name: "Transcript markers",
          value: wrapDiscordText(String(input.transcriptSyncedChannelCount)),
          inline: true,
        },
      ],
    },
    [
      actionRow([
        button({
          customId: COMPONENT_IDS.syncSelectDefault,
          label: "세션 선택 동기화",
          style: BUTTON_STYLES.secondary,
        }),
        button({
          customId: COMPONENT_IDS.syncAllDefault,
          label: "전체 동기화",
          style: BUTTON_STYLES.primary,
        }),
        button({
          customId: COMPONENT_IDS.deletePreview,
          label: "삭제 미리보기",
          style: BUTTON_STYLES.secondary,
        }),
      ]),
      transcriptSyncModeActions(),
    ],
  );
}

export function formatSyncModeResult(input: { mode: TranscriptSyncMode }): DiscordMessagePayload {
  return messagePayload(
    {
      title: "Transcript sync mode updated",
      color: COLORS.success,
      description:
        input.mode === "realtime"
          ? "동기화된 Codex 세션 채널을 주기적으로 확인해 새 desktop 대화 내용을 Discord에 반영합니다."
          : "실시간 폴링은 끄고, 동기화된 세션 채널에서 다시 채팅을 시작할 때 최신 desktop 대화 내용을 먼저 반영합니다.",
      fields: [
        {
          name: "Mode",
          value: wrapDiscordText(input.mode),
          inline: true,
        },
      ],
    },
    [transcriptSyncModeActions()],
  );
}

export function formatReloadConfirmation(): DiscordMessagePayload {
  return messagePayload(
    {
      title: "Bot restart confirmation",
      color: COLORS.queued,
      description:
        "봇 프로세스 재시작은 현재 응답을 보낸 뒤 연결을 잠시 끊습니다. `pnpm connect start`로 실행 중이면 자동으로 다시 올라오고, 직접 `pnpm dev:bot`로 실행 중이면 터미널에서 다시 시작해야 합니다.",
      fields: [
        {
          name: "Safer option",
          value: codeBlock("reload commands", "text"),
          inline: false,
        },
        {
          name: "Restart command",
          value: codeBlock("reload restart confirm", "text"),
          inline: false,
        },
      ],
    },
    [
      actionRow([
        button({
          customId: COMPONENT_IDS.reloadCommands,
          label: "명령어만 재등록",
          style: BUTTON_STYLES.primary,
        }),
        button({
          customId: COMPONENT_IDS.reloadRestartConfirm,
          label: "봇 재시작",
          style: BUTTON_STYLES.danger,
        }),
      ]),
    ],
  );
}

export function formatReloadAck(input: { mode: "commands" | "restart" }): DiscordMessagePayload {
  return messagePayload({
    title: "Bot reload started",
    color: COLORS.queued,
    description:
      input.mode === "restart"
        ? "Discord slash command를 재등록한 뒤 봇 재시작을 예약합니다."
        : "Discord slash command를 현재 실행 중인 봇 코드 기준으로 다시 등록합니다.",
    fields: [
      {
        name: "Mode",
        value: wrapDiscordText(input.mode),
        inline: true,
      },
    ],
  });
}

export function formatReloadResult(response: {
  result?: {
    mode: "commands" | "restart";
    commandCount: number;
    restarting: boolean;
    startedAt: string;
  };
  error?: { message: string };
}): DiscordMessagePayload {
  if (response.error || !response.result) {
    return messagePayload({
      title: "Bot reload failed",
      color: COLORS.failure,
      description: truncateDescription(wrapDiscordText(response.error?.message ?? "Unknown reload failure")),
    });
  }

  return messagePayload({
    title: "Bot reload complete",
    color: COLORS.success,
    description: response.result.restarting
      ? "재시작 요청을 보냈습니다. `pnpm connect start`로 실행 중이면 곧 새 프로세스로 돌아옵니다."
      : "Discord slash command 재등록이 완료되었습니다.",
    fields: [
      {
        name: "Mode",
        value: wrapDiscordText(response.result.mode),
        inline: true,
      },
      {
        name: "Slash commands",
        value: wrapDiscordText(String(response.result.commandCount)),
        inline: true,
      },
      {
        name: "Restarting",
        value: wrapDiscordText(response.result.restarting ? "yes" : "no"),
        inline: true,
      },
      {
        name: "Process started",
        value: wrapDiscordText(response.result.startedAt),
        inline: false,
      },
    ],
  });
}

export function formatClearResult(response: {
  result?: {
    deletedCount: number;
    requestedCount?: number | null;
  };
  error?: { message: string };
}): DiscordMessagePayload {
  if (response.error || !response.result) {
    return messagePayload({
      title: "Message clear failed",
      color: COLORS.failure,
      description: truncateDescription(wrapDiscordText(response.error?.message ?? "Unknown message deletion failure")),
    });
  }

  return messagePayload({
    title: "Messages cleared",
    color: COLORS.success,
    fields: [
      {
        name: "Deleted",
        value: wrapDiscordText(String(response.result.deletedCount)),
        inline: true,
      },
      {
        name: "Requested",
        value: wrapDiscordText(
          response.result.requestedCount === null || response.result.requestedCount === undefined
            ? "all available"
            : String(response.result.requestedCount),
        ),
        inline: true,
      },
    ],
  });
}

export function formatClearConfirmation(): DiscordMessagePayload {
  return messagePayload({
    title: "Clear confirmation required",
    color: COLORS.queued,
    description: "관리자 채널의 가능한 최근 메시지를 모두 삭제하려면 확인 명령을 다시 실행하세요.",
    fields: [
      {
        name: "Confirm command",
        value: codeBlock("clear all confirm", "text"),
        inline: false,
      },
    ],
  });
}

export function formatNewChatAck(input: {
  name: string | null;
  cwd: string | null;
  useCategory: boolean;
  initialPrompt: string | null;
}): DiscordMessagePayload {
  return messagePayload({
    title: "Creating Codex chat",
    color: COLORS.codex,
    description:
      input.cwd || input.useCategory
        ? "지정한 작업 위치에 연결된 새 Codex 채널을 만드는 중입니다."
        : "카테고리 없는 일반 Codex 채팅 채널을 만드는 중입니다.",
    fields: [
      {
        name: "Name",
        value: wrapDiscordText(input.name ?? "(auto)"),
        inline: true,
      },
      {
        name: "Category",
        value: wrapDiscordText(input.useCategory ? "folder category" : "none"),
        inline: true,
      },
      {
        name: "Working directory",
        value: wrapDiscordText(input.cwd ?? "(default workspace)"),
        inline: false,
      },
      {
        name: "Initial prompt",
        value: wrapDiscordText(input.initialPrompt ? "provided" : "none"),
        inline: true,
      },
    ],
  });
}

export function formatNewChatResult(response: {
  result?: {
    discordChannelId: string;
    discordCategoryId: string | null;
    channelName: string;
    threadName: string;
    cwd: string;
    workspaceRoot: string;
    workspaceDisplayName: string;
    pendingSession: boolean;
    initialPrompt: string | null;
  };
  error?: { message: string };
}): DiscordMessagePayload {
  if (response.error || !response.result) {
    return messagePayload({
      title: "Codex chat channel creation failed",
      color: COLORS.failure,
      description: truncateDescription(wrapDiscordText(response.error?.message ?? "Unknown new chat failure")),
    });
  }

  return messagePayload(
    {
      title: "Codex chat channel ready",
      color: COLORS.success,
      description:
        "새 Discord 채널이 Codex 대기 세션으로 연결되었습니다. 그 채널에서 바로 메시지를 보내면 첫 응답 때 실제 Codex 세션 ID가 자동으로 붙습니다.",
      fields: [
        {
          name: "Channel",
          value: `<#${response.result.discordChannelId}>`,
          inline: true,
        },
        {
          name: "Category",
          value: wrapDiscordText(response.result.discordCategoryId ?? "none"),
          inline: true,
        },
        {
          name: "Name",
          value: wrapDiscordText(response.result.channelName),
          inline: true,
        },
        {
          name: "Workspace",
          value: wrapDiscordText(response.result.workspaceDisplayName),
          inline: true,
        },
        {
          name: "Working directory",
          value: wrapDiscordText(response.result.cwd),
          inline: false,
        },
        {
          name: "Next step",
          value: response.result.initialPrompt
            ? codeBlock(response.result.initialPrompt, "text")
            : codeBlock("새 채널에서 자연어로 바로 대화하세요. 예: 이 프로젝트 구조 설명해줘", "text"),
          inline: false,
        },
      ],
    },
    [
      actionRow([
        button({
          customId: COMPONENT_IDS.newGeneralChat,
          label: "일반 채팅 하나 더",
          style: BUTTON_STYLES.secondary,
        }),
        button({
          customId: COMPONENT_IDS.syncSelectDefault,
          label: "기존 세션 선택",
          style: BUTTON_STYLES.primary,
        }),
      ]),
    ],
  );
}

export function formatSyncAck(input: { limit: number }): DiscordMessagePayload {
  return messagePayload({
    title: "Codex session sync started",
    color: COLORS.codex,
    description: "Codex 세션을 읽고 Discord 카테고리/채널을 생성하는 중입니다.",
    fields: [
      {
        name: "Session limit",
        value: wrapDiscordText(String(input.limit)),
        inline: true,
      },
    ],
  });
}

export function formatSyncSelectionAck(input: { limit: number }): DiscordMessagePayload {
  return messagePayload({
    title: "Loading Codex session picker",
    color: COLORS.codex,
    description: "동기화할 Codex 세션 목록을 불러오는 중입니다.",
    fields: [
      {
        name: "Selection limit",
        value: wrapDiscordText(String(input.limit)),
        inline: true,
      },
    ],
  });
}

export interface SelectableCodexSession {
  id: string;
  threadName: string;
  updatedAt: string;
  workspaceDisplayName: string;
}

function truncateOptionText(value: string, fallback: string): string {
  const normalizedValue = value.trim() || fallback;
  return normalizedValue.slice(0, 100);
}

function sessionSelectionOptions(sessions: SelectableCodexSession[]): DiscordSelectOptionPayload[] {
  return sessions.slice(0, 25).map((session) => ({
    label: truncateOptionText(session.threadName, "Codex session"),
    value: session.id,
    description: truncateOptionText(`${session.workspaceDisplayName} · ${session.updatedAt}`, session.updatedAt),
  }));
}

function syncSelectionActions(sessions: SelectableCodexSession[]): DiscordActionRowPayload[] | undefined {
  const options = sessionSelectionOptions(sessions);

  if (options.length === 0) {
    return [
      actionRow([
        button({
          customId: COMPONENT_IDS.syncSelectDefault,
          label: "목록 새로고침",
          style: BUTTON_STYLES.secondary,
        }),
      ]),
    ];
  }

  return [
    actionRow([
      selectMenu({
        customId: COMPONENT_IDS.syncSelected,
        placeholder: "동기화할 Codex 세션 선택",
        minValues: 1,
        maxValues: options.length,
        options,
      }),
    ]),
    actionRow([
      button({
        customId: COMPONENT_IDS.syncSelectDefault,
        label: "목록 새로고침",
        style: BUTTON_STYLES.secondary,
      }),
      button({
        customId: COMPONENT_IDS.syncAllDefault,
        label: "전체 활성 세션 동기화",
        style: BUTTON_STYLES.primary,
      }),
    ]),
  ];
}

export function formatSyncSelection(input: {
  sessions: SelectableCodexSession[];
  totalAvailable: number;
  limit: number;
}): DiscordMessagePayload {
  return messagePayload(
    {
      title: "Select Codex sessions to sync",
      color: COLORS.codex,
      description:
        input.sessions.length > 0
          ? "드롭다운에서 가져올 Codex 세션을 여러 개 선택하세요. 선택한 세션만 Discord 채널로 생성됩니다."
          : "동기화할 활성 Codex 세션이 없습니다.",
      fields: [
        {
          name: "Shown sessions",
          value: wrapDiscordText(`${input.sessions.length} / ${input.totalAvailable}`),
          inline: true,
        },
        {
          name: "Selection limit",
          value: wrapDiscordText(String(input.limit)),
          inline: true,
        },
      ],
    },
    syncSelectionActions(input.sessions),
  );
}

export function formatSyncResultUpdate(response: {
  result?: {
    createdCategories: number;
    existingCategories: number;
    createdChannels: number;
    existingChannels: number;
    skippedSessions: number;
  };
  error?: { message: string };
}): DiscordMessagePayload {
  if (response.error || !response.result) {
    return messagePayload({
      title: "Codex session sync failed",
      color: COLORS.failure,
      description: truncateDescription(wrapDiscordText(response.error?.message ?? "Unknown sync failure")),
    });
  }

  return messagePayload(
    {
      title: "Codex session sync complete",
      color: COLORS.success,
      description: "Codex 폴더는 Discord 카테고리로, Codex 세션은 Discord 채널로 매핑되었습니다.",
      fields: [
        {
          name: "Created categories",
          value: wrapDiscordText(String(response.result.createdCategories)),
          inline: true,
        },
        {
          name: "Existing categories",
          value: wrapDiscordText(String(response.result.existingCategories)),
          inline: true,
        },
        {
          name: "Created channels",
          value: wrapDiscordText(String(response.result.createdChannels)),
          inline: true,
        },
        {
          name: "Existing channels",
          value: wrapDiscordText(String(response.result.existingChannels)),
          inline: true,
        },
        {
          name: "Skipped sessions",
          value: wrapDiscordText(String(response.result.skippedSessions)),
          inline: true,
        },
      ],
    },
    syncResultActions(),
  );
}

export function formatSyncProgressUpdate(progress: {
  phase: "syncing" | "complete";
  processedSessions: number;
  totalSessions: number;
  filteredSessions: number;
  currentSessionName?: string;
  createdCategories: number;
  existingCategories: number;
  createdChannels: number;
  existingChannels: number;
  skippedSessions: number;
}): DiscordMessagePayload {
  const fields: DiscordEmbedFieldPayload[] = [
    {
      name: "Progress",
      value: wrapDiscordText(`${progress.processedSessions} / ${progress.totalSessions}`),
      inline: true,
    },
    {
      name: "Filtered out",
      value: wrapDiscordText(String(progress.filteredSessions)),
      inline: true,
    },
    {
      name: "Created channels",
      value: wrapDiscordText(String(progress.createdChannels)),
      inline: true,
    },
    {
      name: "Existing channels",
      value: wrapDiscordText(String(progress.existingChannels)),
      inline: true,
    },
  ];

  if (progress.currentSessionName) {
    fields.push({
      name: "Current session",
      value: wrapDiscordText(progress.currentSessionName),
      inline: false,
    });
  }

  return messagePayload({
    title: "Codex session sync in progress",
    color: COLORS.codex,
    description: "활성 Codex 세션만 Discord 채널로 동기화하는 중입니다.",
    fields,
  });
}

export function formatDeletePreview(input: {
  mode: "all" | "channels" | "session";
  sessionId?: string | null;
  channelCount: number;
  categoryCount: number;
  channelNames: string[];
  categoryNames: string[];
  channelOptions?: Array<{
    sessionId: string;
    channelName: string;
    workspaceDisplayName: string;
    updatedAt: string;
  }>;
}): DiscordMessagePayload {
  const command =
    input.mode === "session" && input.sessionId
      ? `sync delete session ${input.sessionId} confirm`
      : input.mode === "channels"
        ? "sync delete channels confirm"
        : "sync delete all confirm";

  return messagePayload(
    {
      title: "Synced channel delete preview",
      color: COLORS.queued,
      description: `삭제될 Discord 리소스를 확인하세요. 아래 버튼으로 확정할 수 있습니다. Codex 세션 파일은 삭제하지 않습니다. 텍스트 명령은 \`${command}\` 입니다.`,
      fields: [
        {
          name: "Channels",
          value: wrapDiscordText(String(input.channelCount)),
          inline: true,
        },
        {
          name: "Categories",
          value: wrapDiscordText(String(input.categoryCount)),
          inline: true,
        },
        {
          name: "Channel names",
          value: codeBlock(input.channelNames.slice(0, 25).join("\n") || "(none)", "text"),
          inline: false,
        },
        {
          name: "Category names",
          value: codeBlock(input.categoryNames.slice(0, 25).join("\n") || "(none)", "text"),
          inline: false,
        },
      ],
    },
    deletePreviewActions(input),
  );
}

export function formatDeleteResult(response: {
  result?: {
    mode: "all" | "channels" | "session";
    sessionId?: string | null;
    deletedChannels: number;
    deletedCategories: number;
    missingChannels: number;
    missingCategories: number;
  };
  error?: { message: string };
}): DiscordMessagePayload {
  if (response.error || !response.result) {
    return messagePayload({
      title: "Synced channel delete failed",
      color: COLORS.failure,
      description: truncateDescription(wrapDiscordText(response.error?.message ?? "Unknown delete failure")),
    });
  }

  return messagePayload({
    title: "Synced channels deleted",
    color: COLORS.success,
    description: "Discord에 생성했던 동기화 채널을 삭제했습니다. 로컬 Codex 세션 파일은 그대로 유지됩니다.",
    fields: [
      {
        name: "Deleted channels",
        value: wrapDiscordText(String(response.result.deletedChannels)),
        inline: true,
      },
      {
        name: "Deleted categories",
        value: wrapDiscordText(String(response.result.deletedCategories)),
        inline: true,
      },
      {
        name: "Already missing channels",
        value: wrapDiscordText(String(response.result.missingChannels)),
        inline: true,
      },
      {
        name: "Already missing categories",
        value: wrapDiscordText(String(response.result.missingCategories)),
        inline: true,
      },
    ],
  });
}

export function formatDeleteAck(input: { mode: "all" | "channels" | "session" }): DiscordMessagePayload {
  return messagePayload({
    title: "Deleting synced channels",
    color: COLORS.queued,
    description:
      input.mode === "all"
        ? "동기화로 생성된 Discord 채널과 카테고리를 삭제하는 중입니다. Codex 세션 파일은 삭제하지 않습니다."
        : input.mode === "session"
          ? "선택한 동기화 세션 채널만 삭제하는 중입니다. 카테고리와 Codex 세션 파일은 유지합니다."
          : "동기화로 생성된 Discord 채널만 삭제하는 중입니다. 카테고리와 Codex 세션 파일은 유지합니다.",
    fields: [
      {
        name: "Mode",
        value: wrapDiscordText(input.mode),
        inline: true,
      },
    ],
  });
}

export function formatArchiveAck(input: { confirmed: boolean; sessionId?: string | null }): DiscordMessagePayload {
  return messagePayload(
    {
      title: input.confirmed ? "Archiving Codex session" : "Archive confirmation required",
      color: input.confirmed ? COLORS.queued : COLORS.neutral,
      description: input.confirmed
        ? "이 세션을 브리지 보관 목록에 추가하고 연결된 Discord 채널 매핑을 정리하는 중입니다. 로컬 Codex 세션 파일은 건드리지 않습니다."
        : "정말 보관하려면 아래 버튼을 누르거나 `archive confirm` 또는 `sync archive <session-id> confirm`을 사용하세요. 보관은 브리지 상태에 기록되어 다음 sync부터 제외됩니다.",
      fields: input.sessionId
        ? [
            {
              name: "Session",
              value: wrapDiscordText(input.sessionId),
              inline: true,
            },
          ]
        : [],
    },
    input.confirmed ? undefined : archiveSessionActions(),
  );
}

export function formatArchiveResult(response: {
  result?: {
    codexSessionId: string;
    deletedChannel: boolean;
    removedChannelMapping: boolean;
    wasAlreadyArchived: boolean;
  };
  error?: { message: string };
}): DiscordMessagePayload {
  if (response.error || !response.result) {
    return messagePayload({
      title: "Archive failed",
      color: COLORS.failure,
      description: truncateDescription(wrapDiscordText(response.error?.message ?? "Unknown archive failure")),
    });
  }

  return messagePayload({
    title: "Codex session archived",
    color: COLORS.success,
    description: "이 세션은 다음 동기화부터 제외됩니다. 로컬 Codex 원본 세션 파일은 이동하거나 삭제하지 않았습니다.",
    fields: [
      {
        name: "Session",
        value: wrapDiscordText(response.result.codexSessionId),
        inline: true,
      },
      {
        name: "Discord channel deleted",
        value: wrapDiscordText(String(response.result.deletedChannel)),
        inline: true,
      },
      {
        name: "Already archived",
        value: wrapDiscordText(String(response.result.wasAlreadyArchived)),
        inline: true,
      },
    ],
  });
}

export function formatCodexAck(input: {
  computerDisplayName: string;
  workspaceDisplayName: string;
  cwd: string;
  prompt: string;
}): DiscordMessagePayload {
  const progress = { status: "thinking" };
  const payload = textPayload(codexProgressText(input, progress, {}, "Codex 작업 시작"));
  payload.components = codexProgressActions(false);
  codexProgressViews.set(payload, { input, progress, expanded: false });
  return payload;
}

function codexStatusLabel(status: string): string {
  switch (status) {
    case "thinking":
      return "요청 접수됨";
    case "session opened":
    case "thread.started":
      return "세션 연결됨";
    case "writing answer":
      return "답변 작성 중";
    case "turn.started":
    case "response.started":
      return "요청 분석 중";
    case "item.started":
      return "작업 단계 실행 중";
    case "item.completed":
      return "작업 단계 완료";
    case "turn.completed":
    case "response.completed":
      return "응답 정리 중";
    case "error":
      return "오류 확인 중";
    default:
      return /[._]/.test(status) ? "작업 중" : status;
  }
}

function compactMultiline(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function codexActivitySummary(status: string): string {
  const label = codexStatusLabel(status);

  if (label === "요청 접수됨") {
    return "생각중...";
  }

  if (label === "파일 탐색 중") {
    return "파일 탐색중...";
  }

  if (label === "파일 수정 중") {
    return "파일 편집중...";
  }

  return `${label}...`;
}

function filenameOnly(value: string): string {
  return path.basename(value.trim().replace(/^`|`$/g, "")) || value;
}

function renderProgressEvent(event: string): string {
  const trimmedEvent = event.trim();
  const fileEditMatch = trimmedEvent.match(/^편집함\s+(.+?)\s+\+(\d+)\s+-(\d+)$/);

  if (fileEditMatch) {
    const fileName = filenameOnly(fileEditMatch[1] ?? "");
    const additions = fileEditMatch[2] ?? "0";
    const deletions = fileEditMatch[3] ?? "0";
    return [`편집함 \`${fileName}\``, "```diff", `+${additions}`, `-${deletions}`, "```"].join("\n");
  }

  return trimmedEvent;
}

function codexProgressActions(expanded: boolean): DiscordActionRowPayload[] {
  return [
    actionRow([
      button({
        customId: expanded ? COMPONENT_IDS.codexThoughtsClose : COMPONENT_IDS.codexThoughtsOpen,
        label: expanded ? "생각 닫기" : "생각 열기",
        style: BUTTON_STYLES.secondary,
      }),
    ]),
  ];
}

function isOpenableCodexSessionId(sessionId: string | null): sessionId is string {
  return typeof sessionId === "string" && /^[0-9a-f-]{32,36}$/i.test(sessionId);
}

function codexOpenSessionActions(sessionId: string | null): DiscordActionRowPayload[] {
  if (!isOpenableCodexSessionId(sessionId)) {
    return [];
  }

  return [
    actionRow([
      button({
        customId: `${COMPONENT_IDS.codexOpenSessionPrefix}${sessionId.toLowerCase()}`,
        label: "Codex 앱에서 열기",
        style: BUTTON_STYLES.primary,
      }),
      button({
        customId: `${COMPONENT_IDS.codexRestartOpenSessionPrefix}${sessionId.toLowerCase()}`,
        label: "앱 재시작 후 열기",
        style: BUTTON_STYLES.danger,
      }),
    ]),
  ];
}

function codexProgressText(
  input: CodexProgressMessageInput,
  progress: CodexProgressState,
  options: CodexProgressRenderOptions,
  title = "Codex 작업 중",
): string {
  const latestMessage = progress.latestMessage ? compactMultiline(progress.latestMessage) : "";
  const prompt = compactMultiline(input.prompt);
  const lines = [`**${title}**`, `진행: ${codexStatusLabel(progress.status)}`];

  if (prompt.length > 0) {
    lines.push("", "**요청**", `>>> ${prompt}`);
  }

  const recentEvents =
    progress.recentEvents?.filter((event) => event.trim().length > 0).slice(-CODEX_PROGRESS_EVENT_LIMIT) ?? [];

  if (!options.expanded) {
    const latestEvent = recentEvents.at(-1);
    lines.push("", codexActivitySummary(progress.status));
    if (
      latestEvent &&
      latestEvent !== latestMessage &&
      latestEvent !== codexActivitySummary(progress.status)
    ) {
      lines.push(renderProgressEvent(latestEvent));
    }
    lines.push("", "_생각과 중간 출력은 버튼으로 열 수 있습니다._");
    return lines.join("\n");
  }

  lines.push("", "**생각 / 중간 출력**");

  if (recentEvents.length > 0) {
    lines.push(...recentEvents.map((event) => renderProgressEvent(event)));
  }

  if (latestMessage.length > 0) {
    lines.push(renderProgressEvent(latestMessage));
  }

  if (recentEvents.length === 0 && latestMessage.length === 0) {
    lines.push("아직 표시할 중간 출력이 없습니다.");
  }

  return lines.join("\n");
}

export function formatCodexProgressUpdate(
  input: CodexProgressMessageInput,
  progress: CodexProgressState,
  options: CodexProgressRenderOptions = {},
): DiscordMessagePayload {
  const expanded = options.expanded ?? false;
  const payload = textPayload(codexProgressText(input, progress, { expanded }));
  payload.components = codexProgressActions(expanded);
  codexProgressViews.set(payload, { input, progress, expanded });
  return payload;
}

export function getCodexProgressView(payload: DiscordMessagePayload): CodexProgressView | null {
  return codexProgressViews.get(payload) ?? null;
}

export function formatCodexProgressView(view: CodexProgressView, options: CodexProgressRenderOptions): DiscordMessagePayload {
  return formatCodexProgressUpdate(view.input, view.progress, {
    expanded: options.expanded ?? view.expanded,
  });
}

export function formatCollapsibleThoughtMessage(
  input: {
    collapsedContent: string;
    expandedContent: string;
  },
  options: CodexProgressRenderOptions = {},
): DiscordMessagePayload {
  const expanded = options.expanded ?? false;
  const payload = textPayload(expanded ? input.expandedContent : input.collapsedContent);
  payload.components = [...codexProgressActions(expanded), ...(options.actionRows ?? [])];
  collapsibleThoughtViews.set(payload, {
    ...input,
    expanded,
    actionRows: options.actionRows,
  });
  return payload;
}

export function getCodexThoughtView(payload: DiscordMessagePayload): CodexThoughtView | null {
  const progressView = codexProgressViews.get(payload);

  if (progressView) {
    return { kind: "progress", view: progressView };
  }

  const collapsibleView = collapsibleThoughtViews.get(payload);

  return collapsibleView ? { kind: "collapsible", view: collapsibleView } : null;
}

export function formatCodexThoughtView(view: CodexThoughtView, options: CodexProgressRenderOptions): DiscordMessagePayload {
  if (view.kind === "progress") {
    return formatCodexProgressView(view.view, options);
  }

  return formatCollapsibleThoughtMessage(view.view, {
    expanded: options.expanded ?? view.view.expanded,
    actionRows: view.view.actionRows,
  });
}

function getResultDetails(response: {
  result?: unknown;
  error?: { message: string };
}): {
  title: string;
  color: number;
  status: string;
  exitCode: string;
  stdout: string;
  stderr: string;
  cwd: string | null;
  ui: CommandUiPayload | null;
} {
  if (response.error) {
    return {
      title: "Command failed",
      color: COLORS.failure,
      status: "failed",
      exitCode: "",
      stdout: "",
      stderr: response.error.message,
      cwd: null,
      ui: null,
    };
  }

  const result = response.result as {
    status?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
    cwd?: unknown;
    ui?: unknown;
  };
  const status = String(result.status ?? "unknown");
  const exitCode = String(result.exitCode ?? "");
  const failed = status === "failed" || (typeof result.exitCode === "number" && result.exitCode !== 0);

  return {
    title: failed ? "Command failed" : "Command completed",
    color: failed ? COLORS.failure : COLORS.success,
    status,
    exitCode,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    cwd: typeof result.cwd === "string" && result.cwd.length > 0 ? result.cwd : null,
    ui: normalizeCommandUi(result.ui),
  };
}

function commandUiFields(ui: CommandUiPayload | null): DiscordEmbedFieldPayload[] {
  if (!ui) {
    return [];
  }

  if (ui.kind === "file-browser") {
    const totalPages = Math.max(1, Math.ceil(ui.totalEntries / Math.max(1, ui.pageSize)));

    return [
      {
        name: "Browser page",
        value: wrapDiscordText(`${ui.page + 1} / ${totalPages}`),
        inline: true,
      },
      {
        name: "Entries",
        value: wrapDiscordText(String(ui.totalEntries)),
        inline: true,
      },
    ];
  }

  return [
    {
      name: "File",
      value: wrapDiscordText(ui.path),
      inline: false,
    },
  ];
}

export function formatCommandResultUpdate(
  input: {
    computerDisplayName: string;
    workspaceDisplayName: string;
    cwd: string;
    command: string;
    channelMode?: ChannelMode;
  },
  response: {
    result?: unknown;
    error?: { message: string };
  },
): DiscordMessagePayload {
  const result = getResultDetails(response);
  const outputFields: DiscordEmbedFieldPayload[] = [];
  const attachments: DiscordFilePayload[] = [];
  const failed = result.color === COLORS.failure;
  const channelMode = input.channelMode ?? "session-linked";

  if (result.stdout.trimEnd().length > 0) {
    const stdout = result.stdout.trimEnd();
    const attachmentName = "command-output.txt";
    const shouldAttach = stdout.length > ATTACH_TEXT_THRESHOLD;

    if (shouldAttach) {
      attachments.push(textAttachment(attachmentName, stdout));
    }

    outputFields.push({
      name: shouldAttach ? "Output preview" : "Output",
      value: shouldAttach
        ? previewCodeBlockWithAttachmentNotice({
            value: stdout,
            language: "text",
            attachmentName,
            label: "전체 출력",
          })
        : codeBlock(stdout, "text"),
      inline: false,
    });
  } else if (result.stderr.trimEnd().length === 0) {
    outputFields.push({
      name: "Output",
      value: wrapDiscordText("No output"),
      inline: false,
    });
  }

  if (result.stderr.trimEnd().length > 0) {
    const stderr = result.stderr.trimEnd();
    const attachmentName = "command-error.txt";
    const shouldAttach = stderr.length > ATTACH_TEXT_THRESHOLD;

    if (shouldAttach) {
      attachments.push(textAttachment(attachmentName, stderr));
    }

    outputFields.push({
      name: shouldAttach ? "Error preview" : "Errors",
      value: shouldAttach
        ? previewCodeBlockWithAttachmentNotice({
            value: stderr,
            language: "text",
            attachmentName,
            label: "전체 오류 출력",
          })
        : codeBlock(stderr, "text"),
      inline: false,
    });
  }

  const payload = messagePayload({
    title: result.title,
    color: result.color,
    fields: [
      ...formatCommandHeaderFields(result.cwd ?? input.cwd, input),
      {
        name: "Status",
        value: wrapDiscordText(result.status),
        inline: true,
      },
      {
        name: "Exit code",
        value: wrapDiscordText(result.exitCode),
        inline: true,
      },
      ...commandUiFields(result.ui),
      ...outputFields,
    ],
  }, [
    ...(fileSystemActions({
      command: input.command,
      stdout: result.stdout,
      failed,
      ui: result.ui,
      channelMode,
    }) ?? []),
    ...(commandWorkflowActions(input.command, failed, channelMode) ?? []),
  ]);

  if (attachments.length > 0) {
    payload.files = attachments;
  }

  return payload;
}

export function formatCommandResult(response: {
  result?: unknown;
  error?: { message: string };
}): DiscordMessagePayload {
  return formatCommandResultUpdate(
    {
      computerDisplayName: "Unknown computer",
      workspaceDisplayName: "Unknown workspace",
      cwd: "Unknown directory",
      command: "Unknown command",
    },
    response,
  );
}

export function formatCodexResultUpdate(
  input: {
    computerDisplayName: string;
    workspaceDisplayName: string;
    cwd: string;
    prompt: string;
  },
  response: {
    result?: unknown;
    error?: { message: string };
  },
  options: {
    recentEvents?: string[];
    expanded?: boolean;
  } = {},
): DiscordMessagePayload {
  const result = response.result as {
    status?: unknown;
    finalMessage?: unknown;
    sessionId?: unknown;
    stderr?: unknown;
    errorCode?: unknown;
  } | undefined;
  const failed = Boolean(response.error) || result?.status === "failed";
  const resultFinalMessage = typeof result?.finalMessage === "string" && result.finalMessage.trim().length > 0
    ? result.finalMessage
    : null;
  const resultStderr = typeof result?.stderr === "string" && result.stderr.trim().length > 0 ? result.stderr : null;
  const finalMessage = response.error?.message ?? resultFinalMessage ?? resultStderr ?? "Codex did not return a final message.";
  const sessionId = typeof result?.sessionId === "string" && result.sessionId.length > 0 ? result.sessionId : null;
  const errorCode = typeof result?.errorCode === "string" && result.errorCode.length > 0 ? result.errorCode : null;
  const fields: DiscordEmbedFieldPayload[] = [
    {
      name: "Target",
      value: `${wrapDiscordText(input.computerDisplayName)} / ${wrapDiscordText(input.workspaceDisplayName)}`,
      inline: false,
    },
    {
      name: "Working directory",
      value: wrapDiscordText(input.cwd),
      inline: false,
    },
    {
      name: "Prompt",
      value: codeBlock(input.prompt, "text"),
      inline: false,
    },
    {
      name: "Status",
      value: wrapDiscordText(failed ? "failed" : String(result?.status ?? "completed")),
      inline: true,
    },
  ];

  if (sessionId) {
    fields.push({
      name: "Session",
      value: wrapDiscordText(sessionId),
      inline: true,
    });
  }

  if (failed && errorCode) {
    fields.push({
      name: "Error code",
      value: wrapDiscordText(errorCode),
      inline: true,
    });
  }

  const imageOutputs = failed ? { attachments: [], remoteUrls: [] } : extractImageOutputs(finalMessage);
  const visibleFinalMessage = stripAttachedLocalImageMarkdown(finalMessage);
  const openSessionActions = codexOpenSessionActions(sessionId);

  if (!failed) {
    const recentEvents = options.recentEvents?.filter((event) => event.trim().length > 0).slice(-CODEX_PROGRESS_EVENT_LIMIT) ?? [];
    const finalContent = [
      visibleFinalMessage || (imageOutputs.attachments.length > 0 ? "생성 이미지 첨부" : finalMessage),
      ...imageOutputs.remoteUrls,
    ]
      .filter((line) => line.trim().length > 0)
      .join("\n");
    const finalAttachmentName = "codex-final-message.txt";
    const shouldAttachFinal = finalContent.length > MAX_MESSAGE_CONTENT_LENGTH;
    const finalTextForDiscord = shouldAttachFinal
      ? previewMessageWithAttachment({
          content: finalContent,
          attachmentName: finalAttachmentName,
          notice: "전체 답변은 첨부 파일",
        })
      : finalContent;
    const finalFiles = shouldAttachFinal
      ? [textAttachment(finalAttachmentName, finalMessage), ...imageOutputs.attachments]
      : imageOutputs.attachments;

    if (recentEvents.length > 0) {
      const expanded = options.expanded ?? false;
      const collapsedContent = [finalTextForDiscord, "_생각과 중간 출력은 버튼으로 열 수 있습니다._"]
        .filter((line) => line.trim().length > 0)
        .join("\n\n");
      const expandedContent = [
        finalTextForDiscord,
        "**생각 / 중간 출력**",
        ...recentEvents.map((event) => renderProgressEvent(event)),
      ]
        .filter((line) => line.trim().length > 0)
        .join("\n\n");
      const payload = formatCollapsibleThoughtMessage(
        {
          collapsedContent,
          expandedContent,
        },
        { expanded, actionRows: openSessionActions },
      );

      if (finalFiles.length > 0) {
        payload.files = finalFiles;
      }

      return payload;
    }

    const payload = textPayload(
      finalTextForDiscord,
    );
    if (openSessionActions.length > 0) {
      payload.components = openSessionActions;
    }

    if (finalFiles.length > 0) {
      payload.files = finalFiles;
    }

    return payload;
  }

  const payload = messagePayload({
    title: "Codex failed",
    color: COLORS.failure,
    description: truncateDescription(sanitizeDiscordMarkdown(finalMessage)),
    fields,
  }, openSessionActions);

  return payload;
}

function scheduleDescription(schedule: ScheduledCommandState): string {
  const spec = schedule.schedule;

  switch (spec.type) {
    case "once":
      return `once at ${spec.runAt}`;
    case "interval":
      return `every ${Math.round(spec.everyMs / 60_000)}m`;
    case "daily":
      return `daily at ${spec.time}`;
    case "weekly":
      return `weekly ${spec.weekdays.join(",")} at ${spec.time}`;
  }
}

export function formatScheduleResult(
  response: ScheduleCommandResult | { error: { message: string } },
): DiscordMessagePayload {
  if ("error" in response) {
    return messagePayload({
      title: "Schedule failed",
      color: COLORS.failure,
      description: truncateDescription(wrapDiscordText(response.error.message)),
    });
  }

  if (response.status === "listed") {
    return messagePayload({
      title: "Scheduled commands",
      color: COLORS.neutral,
      description:
        response.schedules.length === 0
          ? "등록된 schedule이 없습니다."
          : response.schedules
              .map((schedule) => `${schedule.id} · ${scheduleDescription(schedule)} · next ${schedule.nextRunAt}\n${schedule.command}`)
              .join("\n\n"),
    });
  }

  if (response.status === "deleted") {
    return messagePayload({
      title: response.deleted ? "Schedule deleted" : "Schedule not found",
      color: response.deleted ? COLORS.success : COLORS.neutral,
      fields: [
        {
          name: "ID",
          value: wrapDiscordText(response.id),
          inline: true,
        },
      ],
    });
  }

  return messagePayload({
    title: "Schedule created",
    color: COLORS.success,
    fields: [
      {
        name: "ID",
        value: wrapDiscordText(response.schedule.id),
        inline: true,
      },
      {
        name: "Next run",
        value: wrapDiscordText(response.schedule.nextRunAt),
        inline: true,
      },
      {
        name: "Schedule",
        value: wrapDiscordText(scheduleDescription(response.schedule)),
        inline: false,
      },
      {
        name: "Command",
        value: codeBlock(response.schedule.command, "text"),
        inline: false,
      },
    ],
  });
}
