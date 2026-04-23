import { promises as fs } from "node:fs";
import path from "node:path";

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

export async function discoverCodexSessions(codexHome: string): Promise<DiscoveredCodexSession[]> {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  const indexText = await readTextIfExists(indexPath);

  if (indexText === null) {
    return [];
  }

  const sessionFilesById = await buildSessionFileIndex(path.join(codexHome, "sessions"));
  const entries: CodexSessionIndexEntry[] = [];

  for (const line of indexText.split("\n").filter(Boolean)) {
    try {
      entries.push(parseSessionIndexLine(line));
    } catch {
      continue;
    }
  }

  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      cwdHint: await findCwdHint(sessionFilesById, entry.id),
    })),
  );
}

async function findCwdHint(sessionFilesById: Map<string, string>, sessionId: string): Promise<string | null> {
  const sessionFile = sessionFilesById.get(sessionId);

  if (!sessionFile) {
    return null;
  }

  const text = await readTextIfExists(sessionFile);

  if (text === null) {
    return null;
  }

  for (const line of text.split("\n").filter(Boolean)) {
    const meta = parseSessionMetaLine(line);
    if (meta?.id === sessionId) {
      return meta.cwd;
    }
  }

  return null;
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
