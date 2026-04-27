import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SQLITE_SEPARATOR = "\u001f";

export interface CodexSessionIndexEntry {
  id: string;
  threadName: string;
  updatedAt: string;
}

export interface CodexSessionMeta {
  id: string;
  cwd: string;
}

export interface DiscoveredCodexSession extends CodexSessionIndexEntry {
  cwdHint: string | null;
  contextPreview?: CodexSessionContextMessage[];
  realtimeEvents?: CodexSessionRealtimeEvent[];
}

export interface DiscoverCodexSessionsOptions {
  activeOnly?: boolean;
  includeArchived?: boolean;
  includeSubAgents?: boolean;
  includeExecSessions?: boolean;
  includeSessionIds?: string[];
  includeContextPreview?: boolean;
  includeRealtimeEvents?: boolean;
  contextMessageLimit?: number;
  contextMessageMaxChars?: number;
  realtimeEventLimit?: number;
}

export interface CodexSessionContextMessage {
  role: "user" | "assistant";
  text: string;
}

export interface CodexSessionRealtimeEvent {
  key: string;
  kind: "user" | "assistant" | "status";
  text: string;
}

interface CodexThreadState {
  archived: boolean;
  source: string | null;
  isSubAgent: boolean;
}

export function parseSessionIndexLine(line: string): CodexSessionIndexEntry {
  const parsed = JSON.parse(line) as { id?: string; thread_name?: string; updated_at?: string };

  if (!parsed.id || !parsed.thread_name || !parsed.updated_at) {
    throw new Error("Invalid Codex session index line");
  }

  return {
    id: parsed.id,
    threadName: parsed.thread_name,
    updatedAt: parsed.updated_at,
  };
}

export function parseSessionMetaLine(line: string): CodexSessionMeta | null {
  let parsed: {
    type?: string;
    payload?: { id?: string; cwd?: string };
  };

  try {
    parsed = JSON.parse(line) as {
      type?: string;
      payload?: { id?: string; cwd?: string };
    };
  } catch {
    return null;
  }

  if (parsed.type !== "session_meta" || !parsed.payload?.id || !parsed.payload.cwd) {
    return null;
  }

  return {
    id: parsed.payload.id,
    cwd: parsed.payload.cwd,
  };
}

export async function discoverCodexSessions(
  codexHome: string,
  options: DiscoverCodexSessionsOptions = {},
): Promise<DiscoveredCodexSession[]> {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  const indexText = await readTextIfExists(indexPath);

  if (indexText === null && (!options.includeSessionIds || options.includeSessionIds.length === 0)) {
    return [];
  }

  const [sessionFilesById, archivedSessionIds, threadStates] = await Promise.all([
    buildSessionFileIndex(path.join(codexHome, "sessions")),
    buildArchivedSessionIds(path.join(codexHome, "archived_sessions")),
    readCodexThreadStates(codexHome),
  ]);
  const entries: CodexSessionIndexEntry[] = [];

  for (const line of (indexText ?? "").split("\n").filter(Boolean)) {
    try {
      entries.push(parseSessionIndexLine(line));
    } catch {
      continue;
    }
  }

  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const visibleEntries = entries.filter((entry) =>
    shouldIncludeSession(entry.id, {
      archivedSessionIds,
      threadState: threadStates.get(entry.id) ?? null,
      threadStateAvailable: threadStates.size > 0,
      options,
    }),
  );
  const visibleIds = new Set(visibleEntries.map((entry) => entry.id));
  const explicitEntries: CodexSessionIndexEntry[] = [];

  for (const sessionId of options.includeSessionIds ?? []) {
    if (visibleIds.has(sessionId) || archivedSessionIds.has(sessionId)) {
      continue;
    }

    const sessionFile = sessionFilesById.get(sessionId);

    if (!sessionFile) {
      continue;
    }

    explicitEntries.push(await fallbackSessionIndexEntry(sessionFile, sessionId));
    visibleIds.add(sessionId);
  }

  return Promise.all(
    [...visibleEntries, ...explicitEntries].map(async (entry) => {
      const details = await findSessionDetails(sessionFilesById, entry.id, options);
      return {
        ...entry,
        cwdHint: details.cwdHint,
        ...(details.contextPreview ? { contextPreview: details.contextPreview } : {}),
        ...(details.realtimeEvents ? { realtimeEvents: details.realtimeEvents } : {}),
      };
    }),
  );
}

async function fallbackSessionIndexEntry(sessionFile: string, sessionId: string): Promise<CodexSessionIndexEntry> {
  const text = (await readTextIfExists(sessionFile)) ?? "";
  const timestamps = text
    .split("\n")
    .map((line) => parseLineTimestamp(line))
    .filter((timestamp): timestamp is string => timestamp !== null);
  const contextPreview = parseSessionContextPreview(text, {
    messageLimit: 1,
    messageMaxChars: 80,
  });
  const firstMessage = contextPreview[0]?.text.split("\n")[0]?.trim();

  return {
    id: sessionId,
    threadName: firstMessage || `Codex session ${sessionId.slice(0, 8)}`,
    updatedAt: timestamps.at(-1) ?? new Date(0).toISOString(),
  };
}

function parseLineTimestamp(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as { timestamp?: unknown };
    return typeof parsed.timestamp === "string" && parsed.timestamp.length > 0 ? parsed.timestamp : null;
  } catch {
    return null;
  }
}

function shouldIncludeSession(
  sessionId: string,
  input: {
    archivedSessionIds: Set<string>;
    threadState: CodexThreadState | null;
    threadStateAvailable: boolean;
    options: DiscoverCodexSessionsOptions;
  },
): boolean {
  if (input.options.activeOnly) {
    if (input.archivedSessionIds.has(sessionId) || !input.threadState) {
      return false;
    }

    return isActiveThreadState(input.threadState);
  }

  if (!input.options.includeArchived && input.archivedSessionIds.has(sessionId)) {
    return false;
  }

  if (!input.threadState) {
    if (input.threadStateAvailable) {
      return false;
    }

    return true;
  }

  if (!input.options.includeArchived && input.threadState.archived) {
    return false;
  }

  if (!input.options.includeSubAgents && input.threadState.isSubAgent) {
    return false;
  }

  if (!input.options.includeExecSessions && isNonInteractiveThreadSource(input.threadState.source)) {
    return false;
  }

  return true;
}

function isActiveThreadState(threadState: CodexThreadState): boolean {
  return (
    !threadState.archived &&
    !threadState.isSubAgent &&
    !isNonInteractiveThreadSource(threadState.source)
  );
}

function isNonInteractiveThreadSource(source: string | null): boolean {
  return source === "exec" || source === "cli";
}

async function findSessionDetails(
  sessionFilesById: Map<string, string>,
  sessionId: string,
  options: DiscoverCodexSessionsOptions,
): Promise<{
  cwdHint: string | null;
  contextPreview?: CodexSessionContextMessage[];
  realtimeEvents?: CodexSessionRealtimeEvent[];
}> {
  const sessionFile = sessionFilesById.get(sessionId);

  if (!sessionFile) {
    return { cwdHint: null };
  }

  const text = await readTextIfExists(sessionFile);

  if (text === null) {
    return { cwdHint: null };
  }

  let cwdHint: string | null = null;

  for (const line of text.split("\n").filter(Boolean)) {
    const meta = parseSessionMetaLine(line);
    if (meta?.id === sessionId) {
      cwdHint = meta.cwd;
      break;
    }
  }

  return {
    cwdHint,
    ...(options.includeContextPreview
      ? {
          contextPreview: parseSessionContextPreview(text, {
            messageLimit: options.contextMessageLimit ?? 6,
            messageMaxChars: options.contextMessageMaxChars ?? 1_000,
          }),
        }
      : {}),
    ...(options.includeRealtimeEvents
      ? {
          realtimeEvents: parseSessionRealtimeEvents(text, {
            eventLimit: options.realtimeEventLimit ?? 30,
            messageMaxChars: options.contextMessageMaxChars ?? 1_000,
          }),
        }
      : {}),
  };
}

async function buildSessionFileIndex(root: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const files = await listJsonlFiles(root);

  for (const file of files) {
    const match = path.basename(file).match(/^.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
    if (match) {
      index.set(match[1], file);
    }
  }

  return index;
}

async function buildArchivedSessionIds(root: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const files = await listJsonlFiles(root);

  for (const file of files) {
    const match = path.basename(file).match(/^.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
    if (match) {
      ids.add(match[1]);
    }
  }

  return ids;
}

async function readCodexThreadStates(codexHome: string): Promise<Map<string, CodexThreadState>> {
  const databasePath = await findCodexStateDatabase(codexHome);

  if (!databasePath) {
    return new Map();
  }

  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      [
        databasePath,
        [
          `select 'thread' || char(31) || id || char(31) || archived || char(31) || source from threads;`,
          `select 'edge' || char(31) || child_thread_id from thread_spawn_edges;`,
        ].join("\n"),
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );

    return parseCodexThreadStateRows(stdout);
  } catch {
    return new Map();
  }
}

function parseCodexThreadStateRows(stdout: string): Map<string, CodexThreadState> {
  const states = new Map<string, CodexThreadState>();

  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const fields = line.split(SQLITE_SEPARATOR);
    const rowType = fields[0];

    if (rowType === "thread") {
      const [, id, archived, source = ""] = fields;
      if (!id) {
        continue;
      }

      states.set(id, {
        archived: archived === "1",
        source,
        isSubAgent: source.trimStart().startsWith('{"subagent"'),
      });
      continue;
    }

    if (rowType === "edge") {
      const childThreadId = fields[1];
      if (!childThreadId) {
        continue;
      }

      const previous = states.get(childThreadId);
      states.set(childThreadId, {
        archived: previous?.archived ?? false,
        source: previous?.source ?? null,
        isSubAgent: true,
      });
    }
  }

  return states;
}

function parseSessionContextPreview(
  text: string,
  options: { messageLimit: number; messageMaxChars: number },
): CodexSessionContextMessage[] {
  const messages: CodexSessionContextMessage[] = [];

  for (const line of text.split("\n").filter(Boolean)) {
    const message = parseContextMessageLine(line, options.messageMaxChars);

    if (message) {
      messages.push(message);
    }
  }

  return messages.slice(-Math.max(1, options.messageLimit));
}

function parseSessionRealtimeEvents(
  text: string,
  options: { eventLimit: number; messageMaxChars: number },
): CodexSessionRealtimeEvent[] {
  const events: CodexSessionRealtimeEvent[] = [];

  for (const line of text.split("\n").filter(Boolean)) {
    const event = parseRealtimeEventLine(line, options.messageMaxChars);

    if (event) {
      events.push(event);
    }
  }

  return events.slice(-Math.max(1, options.eventLimit));
}

function parseContextMessageLine(line: string, messageMaxChars: number): CodexSessionContextMessage | null {
  let parsed: {
    type?: string;
    payload?: {
      type?: string;
      role?: string;
      phase?: string;
      content?: unknown;
    };
  };

  try {
    parsed = JSON.parse(line) as {
      type?: string;
      payload?: {
        type?: string;
        role?: string;
        phase?: string;
        content?: unknown;
      };
    };
  } catch {
    return null;
  }

  if (parsed.type !== "response_item" || parsed.payload?.type !== "message") {
    return null;
  }

  if (parsed.payload.role === "assistant" && parsed.payload.phase !== "final_answer") {
    return null;
  }

  if (parsed.payload.role !== "user" && parsed.payload.role !== "assistant") {
    return null;
  }

  const rawText = extractContentText(parsed.payload.content);
  const text =
    parsed.payload.role === "user"
      ? normalizeUserContextText(rawText)
      : normalizeContextText(rawText);

  if (!text) {
    return null;
  }

  return {
    role: parsed.payload.role,
    text: truncateContextText(text, messageMaxChars),
  };
}

function parseRealtimeEventLine(line: string, messageMaxChars: number): CodexSessionRealtimeEvent | null {
  let parsed:
    | {
        type?: string;
        payload?: {
          type?: string;
          role?: string;
          phase?: string;
          content?: unknown;
          name?: string;
          arguments?: unknown;
        };
      }
    | undefined;

  try {
    parsed = JSON.parse(line) as {
      type?: string;
      payload?: {
        type?: string;
        role?: string;
        phase?: string;
        content?: unknown;
        name?: string;
        arguments?: unknown;
      };
    };
  } catch {
    return null;
  }

  if (!parsed || !parsed.type || !parsed.payload) {
    return null;
  }

  if (parsed.type === "response_item" && parsed.payload.type === "message") {
    if (parsed.payload.role === "user") {
      const text = normalizeUserContextText(extractContentText(parsed.payload.content));

      return text
        ? {
            key: hashSessionEventLine(line),
            kind: "user",
            text: truncateContextText(text, messageMaxChars),
          }
        : null;
    }

    if (parsed.payload.role === "assistant") {
      const text = normalizeContextText(extractContentText(parsed.payload.content));

      return text
        ? {
            key: hashSessionEventLine(line),
            kind: "assistant",
            text: truncateContextText(text, messageMaxChars),
          }
        : null;
    }
  }

  if (
    parsed.type === "response_item" &&
    (parsed.payload.type === "function_call" || parsed.payload.type === "custom_tool_call")
  ) {
    const statusText = parseRealtimeStatusText({
      name: parsed.payload.name ?? "",
      arguments: parsed.payload.arguments,
    });

    return statusText
      ? {
          key: hashSessionEventLine(line),
          kind: "status",
          text: truncateContextText(statusText, messageMaxChars),
        }
      : null;
  }

  if (parsed.type === "event_msg" && parsed.payload.type === "task_started") {
    return {
      key: hashSessionEventLine(line),
      kind: "status",
      text: "작업 시작",
    };
  }

  if (parsed.type === "event_msg" && parsed.payload.type === "task_complete") {
    return {
      key: hashSessionEventLine(line),
      kind: "status",
      text: "작업 완료",
    };
  }

  return null;
}

function hashSessionEventLine(line: string): string {
  return createHash("sha1").update(line).digest("hex");
}

function parseRealtimeStatusText(input: { name: string; arguments: unknown }): string | null {
  const name = input.name.trim();
  const args = parseToolArguments(input.arguments);
  const searchable = `${name} ${args.command ?? ""}`.toLowerCase();

  if (
    searchable.includes("image") ||
    searchable.includes("imagegen") ||
    searchable.includes("generate_image") ||
    searchable.includes("dall-e")
  ) {
    return formatRealtimeStatus("이미지 생성 중", [args.command, name]);
  }

  if (
    searchable.includes("rg --files") ||
    searchable.includes("find ") ||
    searchable.includes("glob") ||
    searchable.includes("file_search")
  ) {
    return formatRealtimeStatus("파일 탐색 중", [args.command]);
  }

  if (searchable.includes("web_search") || searchable.includes("search_query")) {
    return formatRealtimeStatus("웹 검색 중", [args.command, name]);
  }

  if (searchable.includes("apply_patch") || searchable.includes("write") || searchable.includes("edit")) {
    return formatRealtimeStatus("파일 수정 중", [args.command, name]);
  }

  if (name === "exec_command" || searchable.includes("shell")) {
    return formatRealtimeStatus("명령 실행 중", [args.command, name === "exec_command" ? null : name]);
  }

  return name ? formatRealtimeStatus("도구 실행 중", [name, args.command]) : null;
}

function parseToolArguments(value: unknown): { command: string | null } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { command: null };
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const command = parsed.cmd ?? parsed.command ?? parsed.query ?? parsed.prompt;
    return {
      command: typeof command === "string" && command.trim().length > 0 ? normalizeRealtimeDetail(command) : null,
    };
  } catch {
    return { command: null };
  }
}

function normalizeRealtimeDetail(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function formatRealtimeStatus(label: string, parts: Array<string | null>): string {
  const detail = parts.filter((part): part is string => Boolean(part && part.trim().length > 0)).join(" · ");
  return detail.length > 0 ? `${label} · ${detail}` : label;
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (typeof item === "object" && item !== null && "text" in item) {
        const text = (item as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeUserContextText(value: string): string {
  const requestMarker = "## My request for Codex:";
  const markerIndex = value.indexOf(requestMarker);
  const requestText = markerIndex >= 0 ? value.slice(markerIndex + requestMarker.length) : value;
  const normalized = normalizeContextText(requestText);

  if (
    normalized.startsWith("# AGENTS.md instructions") ||
    normalized.startsWith("<environment_context>") ||
    normalized.startsWith("<permissions instructions>")
  ) {
    return "";
  }

  return normalized;
}

function normalizeContextText(value: string): string {
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function truncateContextText(value: string, maxChars: number): string {
  const limit = Math.max(120, maxChars);

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 16).trimEnd()}\n... (truncated)`;
}

async function findCodexStateDatabase(codexHome: string): Promise<string | null> {
  let entries: import("node:fs").Dirent[];

  try {
    entries = await fs.readdir(codexHome, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return null;
    }

    throw error;
  }

  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = entry.name.match(/^state_(\d+)\.sqlite$/);
      return match
        ? {
            version: Number.parseInt(match[1], 10),
            filePath: path.join(codexHome, entry.name),
          }
        : null;
    })
    .filter((candidate): candidate is { version: number; filePath: string } => candidate !== null)
    .sort((a, b) => b.version - a.version);

  return candidates[0]?.filePath ?? null;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];

  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }

    throw error;
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return listJsonlFiles(fullPath);
      }

      return entry.isFile() && entry.name.endsWith(".jsonl") ? [fullPath] : [];
    }),
  );

  return nested.flat();
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return null;
    }

    throw error;
  }
}

function isEnoent(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
