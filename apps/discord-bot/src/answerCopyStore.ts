import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const COPY_ID_PATTERN = /^[a-f0-9]{32}$/;

export interface AnswerCopyStore {
  save(answer: string): Promise<string>;
  read(copyId: string): Promise<string | null>;
}

export function defaultAnswerCopyRoot(): string {
  return path.resolve(process.env.CONNECT_ANSWER_COPY_ROOT ?? ".connect/answer-copies");
}

function copyIdFor(answer: string): string {
  return createHash("sha256").update(answer).digest("hex").slice(0, 32);
}

function validCopyId(copyId: string): string | null {
  const normalized = copyId.trim().toLowerCase();
  return COPY_ID_PATTERN.test(normalized) ? normalized : null;
}

async function writeTextAtomic(filePath: string, answer: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, answer, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "EPERM")) {
      try {
        if (await readFile(filePath, "utf8") === answer) {
          const now = new Date();
          await utimes(filePath, now, now);
          await rm(temporaryPath, { force: true });
          return;
        }
      } catch {
        // Fall through to the original write error.
      }
    }

    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function createAnswerCopyStore(
  rootPath = defaultAnswerCopyRoot(),
  options: { maxEntries?: number; maxAgeMs?: number } = {},
): AnswerCopyStore {
  const root = path.resolve(rootPath);
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const maxAgeMs = Math.max(60_000, options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);

  function copyPath(copyId: string): string {
    return path.join(root, `${copyId}.txt`);
  }

  async function prune(): Promise<void> {
    let entries;

    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    const now = Date.now();
    const files = (await Promise.all(entries
      .filter((entry) => entry.isFile() && COPY_ID_PATTERN.test(entry.name.replace(/\.txt$/, "")))
      .map(async (entry) => {
        const filePath = path.join(root, entry.name);
        try {
          const fileStat = await stat(filePath);
          return { filePath, mtimeMs: fileStat.mtimeMs };
        } catch {
          return null;
        }
      })))
      .filter((entry): entry is { filePath: string; mtimeMs: number } => Boolean(entry));
    const freshFiles = files.filter((entry) => now - entry.mtimeMs <= maxAgeMs);
    const staleFiles = files.filter((entry) => now - entry.mtimeMs > maxAgeMs);
    freshFiles.sort((left, right) => right.mtimeMs - left.mtimeMs);

    await Promise.all([
      ...staleFiles.map((entry) => rm(entry.filePath, { force: true })),
      ...freshFiles.slice(maxEntries).map((entry) => rm(entry.filePath, { force: true })),
    ]);
  }

  return {
    async save(answer) {
      const normalized = answer.trimEnd();
      const copyId = copyIdFor(normalized);
      await writeTextAtomic(copyPath(copyId), normalized);
      await prune();
      return copyId;
    },

    async read(copyId) {
      const normalized = validCopyId(copyId);

      if (!normalized) {
        return null;
      }

      const filePath = copyPath(normalized);

      try {
        const fileStat = await stat(filePath);

        if (Date.now() - fileStat.mtimeMs > maxAgeMs) {
          await rm(filePath, { force: true });
          return null;
        }

        return await readFile(filePath, "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
  };
}
