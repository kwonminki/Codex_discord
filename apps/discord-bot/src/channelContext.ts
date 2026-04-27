import type { ChannelMode } from "../../../packages/core/src/index.js";

export interface ManagedDiscordChannelContext {
  channelMode: ChannelMode;
  allowedRoleIds: string[];
  computerId: string;
  computerDisplayName: string;
  workspaceDisplayName: string;
  workspaceRoot: string;
  cwd: string;
  timeoutMs: number;
  codexSessionId?: string | null;
}
