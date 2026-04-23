import path from "node:path";
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
});
