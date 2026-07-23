import { z } from "zod";

import type { ConnectorPresence } from "../../../packages/core/src/index.js";

const RELEASE_FOOTER_PREFIX = "AI Agent Release";
const RELEASE_UPDATE_BUTTON_PREFIX = "agent-release-update:";

export const releaseMetadataSchema = z.object({
  version: z.string().trim().regex(/^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/),
  sha: z.string().trim().regex(/^[0-9a-f]{40}$/i).transform((value) => value.toLowerCase()),
});

export type ReleaseMetadata = z.infer<typeof releaseMetadataSchema>;

export interface ConnectorUpdateTarget {
  computerId: string;
  computerDisplayName: string;
  connectorVersion: string;
  agent: "codex" | "claude";
  channelId: string;
}

export function formatReleaseFooter(release: ReleaseMetadata): string {
  const parsed = releaseMetadataSchema.parse(release);
  return `${RELEASE_FOOTER_PREFIX} | v${parsed.version} | ${parsed.sha}`;
}

export function parseReleaseFooter(value: string | null | undefined): ReleaseMetadata | null {
  const match = value?.trim().match(/^AI Agent Release \| v([^|]+) \| ([0-9a-f]{40})$/i);
  if (!match) {
    return null;
  }
  const parsed = releaseMetadataSchema.safeParse({
    version: match[1]?.trim(),
    sha: match[2],
  });
  return parsed.success ? parsed.data : null;
}

export function releaseUpdateButtonId(release: ReleaseMetadata): string {
  const parsed = releaseMetadataSchema.parse(release);
  return `${RELEASE_UPDATE_BUTTON_PREFIX}${parsed.version}:${parsed.sha}`;
}

export function parseReleaseUpdateButtonId(customId: string): ReleaseMetadata | null {
  if (!customId.startsWith(RELEASE_UPDATE_BUTTON_PREFIX)) {
    return null;
  }
  const match = customId.slice(RELEASE_UPDATE_BUTTON_PREFIX.length).match(/^([^:]+):([0-9a-f]{40})$/i);
  if (!match) {
    return null;
  }
  const parsed = releaseMetadataSchema.safeParse({ version: match[1], sha: match[2] });
  return parsed.success ? parsed.data : null;
}

export function selectConnectorUpdateTargets(
  presences: ConnectorPresence[],
): ConnectorUpdateTarget[] {
  const latestByComputer = new Map<string, ConnectorPresence>();
  for (const presence of presences) {
    const current = latestByComputer.get(presence.computerId);
    if (!current || Date.parse(presence.registeredAt) > Date.parse(current.registeredAt)) {
      latestByComputer.set(presence.computerId, presence);
    }
  }

  return [...latestByComputer.values()]
    .map((presence): ConnectorUpdateTarget => {
      const useClaude = presence.preferredAgent === "claude" && Boolean(presence.channels.claude);
      return {
        computerId: presence.computerId,
        computerDisplayName: presence.computerDisplayName,
        connectorVersion: presence.connectorVersion,
        agent: useClaude ? "claude" : "codex",
        channelId: useClaude ? presence.channels.claude! : presence.channels.codex,
      };
    })
    .sort((left, right) =>
      left.computerDisplayName.localeCompare(right.computerDisplayName) ||
      left.computerId.localeCompare(right.computerId));
}

export function buildReleaseUpdatePrompt(
  release: ReleaseMetadata,
  target: ConnectorUpdateTarget,
): string {
  const parsed = releaseMetadataSchema.parse(release);
  return [
    `AI Agent Discord Connector v${parsed.version} release를 이 서버에 안전하게 적용해줘.`,
    "",
    `정확한 release commit: ${parsed.sha}`,
    `대상 computerId: ${target.computerId}`,
    `현재 보고된 connector version: ${target.connectorVersion}`,
    "",
    "현재 bot/worker 프로세스의 작업 디렉터리와 서비스 정의에서 실제 Connector repo와 supervisor 구성을 먼저 확인해라. 추측한 경로나 서비스 이름을 사용하지 마라.",
    "",
    "안전 조건:",
    "- Connector repo 외 다른 프로젝트 파일과 GPU/학습/추론 프로세스는 건드리지 않는다.",
    "- Git 작업 트리가 dirty면 업데이트하지 말고 변경 파일과 함께 보고한다.",
    "- origin에서 release commit을 fetch하고 현재 HEAD에서 fast-forward 가능한지 확인한다.",
    "- 검증을 통과한 경우에만 exact release commit까지 ff-only로 이동한다.",
    "- package manager lockfile을 준수해 비대화형 의존성 설치를 수행한다.",
    "- bot gateway와 worker를 구분한다. worker의 active/pending 요청을 먼저 확인한다.",
    "- 실행 중 작업이 있으면 worker를 강제 종료하거나 SIGKILL하지 않는다.",
    "- 신뢰 가능한 supervisor가 확인된 경우에만 SIGTERM graceful drain으로 새 코드 재기동을 예약한다.",
    "- supervisor가 불명확하면 repo만 업데이트하고 worker 적용은 보류한다.",
    "",
    "최종 답변에 이전/이후 commit과 version, repo 경로, bot/worker 서비스와 PID, ready 여부, active/pending 수, 보류 사항을 간결하게 적어줘.",
  ].join("\n");
}
