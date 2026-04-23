import fs from "node:fs";
import path from "node:path";
import type { ChannelMode } from "./domain.js";

export type CommandTier = "safe-read" | "normal-mutate" | "dangerous-mutate";

export interface CommandClassification {
  tier: CommandTier;
  requiresConfirmation: boolean;
}

export interface AuthorizationInput {
  userRoleIds: string[];
  allowedRoleIds: string[];
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
}

const safeReadCommands = new Set(["ls", "tree", "pwd", "cat", "find"]);
const normalMutateCommands = new Set([
  "mkdir",
  "touch",
  "mv",
  "cp",
  "git",
  "npm",
  "pnpm",
  "python",
  "python3",
  "node",
]);
const dangerousCommands = new Set(["rm", "rmdir"]);
const dangerousWrappers = new Set(["sudo", "bash", "sh", "zsh", "fish", "env"]);
const dangerousShellSyntax = /&&|\|\||;|\||`|\$\(/;

export function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

export function classifyCommand(command: string): CommandClassification {
  const token = firstToken(command);

  if (
    dangerousCommands.has(token) ||
    dangerousWrappers.has(token) ||
    dangerousShellSyntax.test(command) ||
    command.includes("--force") ||
    command.includes(" reset --hard")
  ) {
    return { tier: "dangerous-mutate", requiresConfirmation: true };
  }

  if (safeReadCommands.has(token)) {
    return { tier: "safe-read", requiresConfirmation: false };
  }

  if (normalMutateCommands.has(token)) {
    return { tier: "normal-mutate", requiresConfirmation: false };
  }

  return { tier: "normal-mutate", requiresConfirmation: false };
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function tryRealpath(targetPath: string): string | null {
  try {
    return fs.realpathSync.native(targetPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function parseDiscordMessageCommand(input: {
  mode: ChannelMode;
  content: string;
}): { kind: "command"; command: string } | { kind: "chat"; content: string } {
  const content = input.content.trim();

  if (input.mode === "shell-admin") {
    return { kind: "command", command: content };
  }

  if (content.startsWith("!")) {
    return { kind: "command", command: content.slice(1).trim() };
  }

  return { kind: "chat", content };
}

export function authorizeCommand(input: AuthorizationInput): AuthorizationResult {
  const hasAllowedRole = input.userRoleIds.some((roleId) => input.allowedRoleIds.includes(roleId));

  if (!hasAllowedRole) {
    return { allowed: false, reason: "User does not have an allowed role" };
  }

  return { allowed: true };
}

export function updateCwd(workspaceRoot: string, currentCwd: string, requestedPath: string): string {
  const resolved = path.resolve(currentCwd, requestedPath);
  const normalizedRoot = path.resolve(workspaceRoot);

  if (!isWithinRoot(resolved, normalizedRoot)) {
    throw new Error("Path escapes workspace root");
  }

  if (fs.existsSync(normalizedRoot) && fs.existsSync(resolved)) {
    const realRoot = tryRealpath(normalizedRoot);
    const realTarget = tryRealpath(resolved);

    if (realRoot !== null && realTarget !== null && !isWithinRoot(realTarget, realRoot)) {
      throw new Error("Path escapes workspace root");
    }
  }

  return resolved;
}
