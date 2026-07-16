import { discoverCodexSessions } from "../../../packages/codex-adapter/src/index.js";

export function listNativeCodexSessions(
  codexHome: string,
  options: { activeOnly?: boolean; includeExecSessions?: boolean; includeSessionIds?: string[] } = {},
) {
  return discoverCodexSessions(codexHome, {
    activeOnly: options.activeOnly ?? true,
    includeExecSessions: options.includeExecSessions ?? false,
    includeSessionIds: options.includeSessionIds,
    includeContextPreview: true,
    includeRealtimeEvents: true,
    contextMessageLimit: 25,
    contextMessageMaxChars: 8_000,
    realtimeEventLimit: 40,
  });
}
