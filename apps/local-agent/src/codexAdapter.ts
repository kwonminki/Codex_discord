import { discoverCodexSessions } from "@codex-discord/codex-adapter";

export function listNativeCodexSessions(codexHome: string) {
  return discoverCodexSessions(codexHome);
}
