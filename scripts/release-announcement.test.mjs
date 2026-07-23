import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  announceVersionCommits,
  buildDiscordReleasePayload,
  collectVersionCommits,
  formatReleaseFooter,
  parseVersionCommit,
} from "./release-announcement.mjs";

function commit(id, message) {
  return {
    id,
    message,
    url: `https://github.com/kwonminki/ai-agent-discord-connector/commit/${id}`,
  };
}

describe("release announcement", () => {
  it("recognizes supported version subjects and preserves the feature list", () => {
    assert.deepEqual(
      parseVersionCommit(commit("abcdef123", "v1.2.3: 미디어 설문 추가\n\n- 이미지 선택\n- 영상 선택")),
      {
        sha: "abcdef123",
        url: "https://github.com/kwonminki/ai-agent-discord-connector/commit/abcdef123",
        version: "1.2.3",
        title: "미디어 설문 추가",
        details: "- 이미지 선택\n- 영상 선택",
      },
    );
    assert.equal(parseVersionCommit(commit("ordinary", "Add release workflow")), null);
    assert.equal(parseVersionCommit(commit("joined", "v1.0feature")), null);
    assert.equal(
      parseVersionCommit(commit("escaped", "v1.3: Escaped body\n\n- first\\n- second")).details,
      "- first\n- second",
    );
  });

  it("collects every version commit from one push and ignores ordinary commits", () => {
    assert.deepEqual(
      collectVersionCommits({
        commits: [
          commit("one", "Fix tests"),
          commit("two", "v1.0: First release"),
          commit("three", "V2.0-beta.1 Release candidate"),
        ],
      }).map((release) => release.version),
      ["1.0", "2.0-beta.1"],
    );
  });

  it("builds a quiet embed with a GitHub link", () => {
    const payload = buildDiscordReleasePayload(parseVersionCommit(commit(
      "abcdef123",
      "v1.0: 첫 공개 버전\n\n- 자동 공지",
    )));

    assert.equal(payload.username, "AI Agent Releases");
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    assert.equal(payload.embeds[0].title, "AI Agent Discord Connector v1.0");
    assert.equal(payload.embeds[0].description, "**첫 공개 버전**\n\n- 자동 공지");
    assert.match(payload.embeds[0].fields[0].value, /abcdef1/);
    assert.equal(
      payload.embeds[0].footer.text,
      formatReleaseFooter({ version: "1.0", sha: "abcdef123" }),
    );
  });

  it("does not require a webhook for ordinary pushes", async () => {
    let called = false;
    const result = await announceVersionCommits({
      eventPayload: { commits: [commit("one", "Update docs")] },
      fetchImpl: async () => {
        called = true;
        throw new Error("unexpected fetch");
      },
    });

    assert.deepEqual(result, { announcedVersions: [] });
    assert.equal(called, false);
  });

  it("posts one webhook payload for each release commit", async () => {
    const payloads = [];
    const result = await announceVersionCommits({
      eventPayload: {
        commits: [
          commit("one11111", "v1.0: First"),
          commit("two22222", "v1.1: Second"),
        ],
      },
      webhookUrl: "https://discord.example/webhook",
      fetchImpl: async (_url, options) => {
        payloads.push(JSON.parse(options.body));
        return { ok: true, status: 204, text: async () => "" };
      },
    });

    assert.deepEqual(result, { announcedVersions: ["1.0", "1.1"] });
    assert.deepEqual(payloads.map((payload) => payload.embeds[0].title), [
      "AI Agent Discord Connector v1.0",
      "AI Agent Discord Connector v1.1",
    ]);
  });

  it("fails version pushes when the secret is missing", async () => {
    await assert.rejects(
      announceVersionCommits({ eventPayload: { commits: [commit("one", "v1.0")] } }),
      /DISCORD_RELEASE_WEBHOOK_URL/,
    );
  });
});
