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

const safeReadCommands = new Set(["ls", "tree", "pwd", "cat", "find", "grep"]);
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
const dangerousWrappers = new Set(["sudo", "bash", "sh", "zsh", "fish", "env", "command", "exec"]);

interface ShellScanResult {
  segments: string[];
  hasDangerousControlSyntax: boolean;
}

function isShellWhitespace(character: string): boolean {
  return /\s/.test(character);
}

function scanShell(command: string): ShellScanResult {
  const segments: string[] = [];
  let current = "";
  let mode: "normal" | "single" | "double" = "normal";
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (mode !== "single" && character === "\\") {
      escaped = true;
      continue;
    }

    if (mode === "single") {
      if (character === "'") {
        mode = "normal";
      } else {
        current += character;
      }
      continue;
    }

    if (mode === "double") {
      if (character === '"') {
        mode = "normal";
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'") {
      mode = "single";
      continue;
    }

    if (character === '"') {
      mode = "double";
      continue;
    }

    if (character === "&" && command[index + 1] === "&") {
      return { segments: [command], hasDangerousControlSyntax: true };
    }

    if (character === "|" && command[index + 1] === "|") {
      return { segments: [command], hasDangerousControlSyntax: true };
    }

    if (character === ";" || character === "`" || (character === "$" && command[index + 1] === "(")) {
      return { segments: [command], hasDangerousControlSyntax: true };
    }

    if (character === "|") {
      segments.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  segments.push(current.trim());

  return {
    segments: segments.filter((segment) => segment.length > 0),
    hasDangerousControlSyntax: false,
  };
}

function tokenizeShellWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let mode: "normal" | "single" | "double" = "normal";
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (mode !== "single" && character === "\\") {
      escaped = true;
      continue;
    }

    if (mode === "single") {
      if (character === "'") {
        mode = "normal";
      } else {
        current += character;
      }
      continue;
    }

    if (mode === "double") {
      if (character === '"') {
        mode = "normal";
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'") {
      mode = "single";
      continue;
    }

    if (character === '"') {
      mode = "double";
      continue;
    }

    if (isShellWhitespace(character)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    words.push(current);
  }

  return words;
}

export function firstToken(command: string): string {
  return tokenizeShellWords(command)[0] ?? "";
}

function mergeTiers(left: CommandClassification, right: CommandClassification): CommandClassification {
  if (left.tier === "dangerous-mutate" || right.tier === "dangerous-mutate") {
    return { tier: "dangerous-mutate", requiresConfirmation: true };
  }

  if (left.tier === "normal-mutate" || right.tier === "normal-mutate") {
    return { tier: "normal-mutate", requiresConfirmation: false };
  }

  return { tier: "safe-read", requiresConfirmation: false };
}

function classifySingleCommand(command: string): CommandClassification {
  const tokens = tokenizeShellWords(command);
  const token = tokens[0] ?? "";
  const resetIndex = tokens.indexOf("reset");
  const hardIndex = tokens.indexOf("--hard");
  const isGitHardReset = token === "git" && resetIndex > 0 && hardIndex > resetIndex;

  if (
    dangerousCommands.has(token) ||
    dangerousWrappers.has(token) ||
    command.includes("--force") ||
    isGitHardReset
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

export function classifyCommand(command: string): CommandClassification {
  const scanned = scanShell(command);

  if (scanned.hasDangerousControlSyntax) {
    return { tier: "dangerous-mutate", requiresConfirmation: true };
  }

  if (scanned.segments.length > 1) {
    return scanned.segments
      .map(classifySingleCommand)
      .reduce(
        (accumulator, classification) => mergeTiers(accumulator, classification),
        { tier: "safe-read", requiresConfirmation: false } as CommandClassification,
      );
  }

  return classifySingleCommand(scanned.segments[0] ?? command);
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
