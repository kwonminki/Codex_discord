import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const VERSION_COMMIT_PATTERN =
  /^v(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z][0-9A-Za-z.-]*)?)(?:(?:\s*[:\-–—]\s*|\s+)(.*))?$/i;
const MAX_DESCRIPTION_LENGTH = 3_800;

export function parseVersionCommit(commit) {
  if (!commit || typeof commit.id !== "string" || typeof commit.message !== "string" || typeof commit.url !== "string") {
    return null;
  }

  const [subject = "", ...bodyLines] = commit.message.split(/\r?\n/);
  const match = subject.trim().match(VERSION_COMMIT_PATTERN);

  if (!match) {
    return null;
  }

  return {
    sha: commit.id,
    url: commit.url,
    version: match[1],
    title: match[2]?.trim() || null,
    details: bodyLines.join("\n").trim().replaceAll("\\n", "\n") || null,
  };
}

export function collectVersionCommits(eventPayload) {
  const commits = Array.isArray(eventPayload?.commits) ? eventPayload.commits : [];
  return commits.map(parseVersionCommit).filter(Boolean);
}

function truncate(value, maxLength = MAX_DESCRIPTION_LENGTH) {
  if (value.length <= maxLength) {
    return value;
  }

  const limit = maxLength - 32;
  const lineBoundary = value.lastIndexOf("\n", limit);
  const cutAt = lineBoundary >= Math.floor(limit * 0.6) ? lineBoundary : limit;
  return `${value.slice(0, cutAt).trimEnd()}\n\n…계속되는 내용은 커밋에서 확인하세요.`;
}

export function buildDiscordReleasePayload(release) {
  const sections = [
    release.title ? `**${release.title}**` : null,
    release.details,
  ].filter(Boolean);
  const description = truncate(
    sections.join("\n\n") || "새 버전이 공개되었습니다. 자세한 내용은 커밋에서 확인하세요.",
  );

  return {
    username: "Codex Releases",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `AI Agent Discord Connector v${release.version}`,
      color: 3066993,
      description,
      fields: [{
        name: "GitHub",
        value: `[\`${release.sha.slice(0, 7)}\`](${release.url})`,
      }],
    }],
  };
}

export async function announceVersionCommits(input) {
  const releases = collectVersionCommits(input.eventPayload);

  if (releases.length === 0) {
    input.log?.("No version commit found; Discord announcement skipped.");
    return { announcedVersions: [] };
  }

  const webhookUrl = input.webhookUrl?.trim();

  if (!webhookUrl) {
    throw new Error("Repository secret DISCORD_RELEASE_WEBHOOK_URL is required for version announcements.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const announcedVersions = [];

  for (const release of releases) {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildDiscordReleasePayload(release)),
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed with HTTP ${response.status}: ${await response.text()}`);
    }

    announcedVersions.push(release.version);
    input.log?.(`Announced v${release.version} from ${release.sha.slice(0, 7)}.`);
  }

  return { announcedVersions };
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH?.trim();

  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is required.");
  }

  const eventPayload = JSON.parse(await readFile(eventPath, "utf8"));
  await announceVersionCommits({
    eventPayload,
    webhookUrl: process.env.DISCORD_RELEASE_WEBHOOK_URL,
    log: console.log,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
