import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverCodexSessions, parseSessionIndexLine, parseSessionMetaLine } from "../src/parser.js";

const fixturesRoot = path.resolve("packages/codex-adapter/test/fixtures");

describe("codex parser", () => {
  it("parses session index entries", () => {
    expect(
      parseSessionIndexLine(
        '{"id":"019db2be-b2b3-7e82-9e61-8c84b28ad287","thread_name":"Codex Discord planning","updated_at":"2026-04-22T01:15:24.714Z"}',
      ),
    ).toEqual({
      id: "019db2be-b2b3-7e82-9e61-8c84b28ad287",
      threadName: "Codex Discord planning",
      updatedAt: "2026-04-22T01:15:24.714Z",
    });
  });

  it("parses session meta cwd", () => {
    const line =
      '{"timestamp":"2026-04-22T01:15:24.714Z","type":"session_meta","payload":{"id":"019db2be-b2b3-7e82-9e61-8c84b28ad287","cwd":"/Users/me/project"}}';

    expect(parseSessionMetaLine(line)).toEqual({
      id: "019db2be-b2b3-7e82-9e61-8c84b28ad287",
      cwd: "/Users/me/project",
    });
  });

  it("discovers sessions with workspace hints", async () => {
    const sessions = await discoverCodexSessions(fixturesRoot);

    expect(sessions[0]).toMatchObject({
      id: "019db2be-b2b3-7e82-9e61-8c84b28ad287",
      threadName: "Codex Discord planning",
      cwdHint: "/Users/dgsw36/Desktop/01_프로젝트-개발/앱-도구/CodexDiscordConnecter",
    });
  });

  it("returns an empty list when session index is missing", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-adapter-"));

    await expect(discoverCodexSessions(codexHome)).resolves.toEqual([]);

    await fs.rm(codexHome, { recursive: true, force: true });
  });

  it("returns index entries with null cwd hints when sessions are missing", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-adapter-"));
    await fs.writeFile(
      path.join(codexHome, "session_index.jsonl"),
      '{"id":"019db2be-b2b3-7e82-9e61-8c84b28ad287","thread_name":"Codex Discord planning","updated_at":"2026-04-22T01:15:24.714Z"}\n',
      "utf8",
    );

    await expect(discoverCodexSessions(codexHome)).resolves.toEqual([
      {
        id: "019db2be-b2b3-7e82-9e61-8c84b28ad287",
        threadName: "Codex Discord planning",
        updatedAt: "2026-04-22T01:15:24.714Z",
        cwdHint: null,
      },
    ]);

    await fs.rm(codexHome, { recursive: true, force: true });
  });

  it("skips malformed index lines and keeps valid sessions", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-adapter-"));
    const goodSessionId = "019db2be-b2b3-7e82-9e61-8c84b28ad287";

    await fs.writeFile(
      path.join(codexHome, "session_index.jsonl"),
      `{"id":"missing-thread-name","updated_at":"2026-04-22T01:15:24.714Z"}\n{"id":"${goodSessionId}","thread_name":"Codex Discord planning","updated_at":"2026-04-22T01:15:24.714Z"}\n`,
      "utf8",
    );

    await expect(discoverCodexSessions(codexHome)).resolves.toEqual([
      {
        id: goodSessionId,
        threadName: "Codex Discord planning",
        updatedAt: "2026-04-22T01:15:24.714Z",
        cwdHint: null,
      },
    ]);

    await fs.rm(codexHome, { recursive: true, force: true });
  });

  it("ignores malformed transcript lines before a valid session meta line", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-adapter-"));
    const sessionId = "019db2be-b2b3-7e82-9e61-8c84b28ad287";

    await fs.writeFile(
      path.join(codexHome, "session_index.jsonl"),
      `{"id":"${sessionId}","thread_name":"Codex Discord planning","updated_at":"2026-04-22T01:15:24.714Z"}\n`,
      "utf8",
    );

    await fs.mkdir(path.join(codexHome, "sessions", "2026", "04", "22"), { recursive: true });
    await fs.writeFile(
      path.join(codexHome, "sessions", "2026", "04", "22", `rollout-${sessionId}.jsonl`),
      `not-json\n{"timestamp":"2026-04-22T01:15:24.714Z","type":"session_meta","payload":{"id":"${sessionId}","cwd":"/Users/me/project"}}\n`,
      "utf8",
    );

    await expect(discoverCodexSessions(codexHome)).resolves.toEqual([
      {
        id: sessionId,
        threadName: "Codex Discord planning",
        updatedAt: "2026-04-22T01:15:24.714Z",
        cwdHint: "/Users/me/project",
      },
    ]);

    await fs.rm(codexHome, { recursive: true, force: true });
  });

  it("does not rely on the full path when matching session files", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-adapter-"));
    const sessionId = "019db2be-b2b3-7e82-9e61-8c84b28ad287";

    await fs.writeFile(
      path.join(codexHome, "session_index.jsonl"),
      `{"id":"${sessionId}","thread_name":"Codex Discord planning","updated_at":"2026-04-22T01:15:24.714Z"}\n`,
      "utf8",
    );

    const decoyDir = path.join(codexHome, "sessions", "2026", "04", "22", sessionId);
    await fs.mkdir(decoyDir, { recursive: true });
    await fs.writeFile(path.join(decoyDir, "rollout-other.jsonl"), "{}", "utf8");

    await fs.mkdir(path.join(codexHome, "sessions", "2026", "04", "22"), { recursive: true });
    await fs.writeFile(
      path.join(codexHome, "sessions", "2026", "04", "22", `rollout-${sessionId}.jsonl`),
      `{"timestamp":"2026-04-22T01:15:24.714Z","type":"session_meta","payload":{"id":"${sessionId}","cwd":"/Users/me/project"}}\n`,
      "utf8",
    );

    await expect(discoverCodexSessions(codexHome)).resolves.toEqual([
      {
        id: sessionId,
        threadName: "Codex Discord planning",
        updatedAt: "2026-04-22T01:15:24.714Z",
        cwdHint: "/Users/me/project",
      },
    ]);

    await fs.rm(codexHome, { recursive: true, force: true });
  });
});
