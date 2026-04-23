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
  const parsed = JSON.parse(line) as {
    type?: string;
    payload?: { id?: string; cwd?: string };
  };

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
  const indexText = await fs.readFile(indexPath, "utf8");
  const entries = indexText
    .split("\n")
    .filter(Boolean)
    .map(parseSessionIndexLine)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      cwdHint: await findCwdHint(codexHome, entry.id),
    })),
  );
}

async function findCwdHint(codexHome: string, sessionId: string): Promise<string | null> {
  const sessionsRoot = path.join(codexHome, "sessions");
  const files = await listJsonlFiles(sessionsRoot);
  const sessionFile = files.find((file) => file.includes(sessionId));

  if (!sessionFile) {
    return null;
  }

  const text = await fs.readFile(sessionFile, "utf8");
  for (const line of text.split("\n").filter(Boolean)) {
    const meta = parseSessionMetaLine(line);
    if (meta?.id === sessionId) {
      return meta.cwd;
    }
  }

  return null;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
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
