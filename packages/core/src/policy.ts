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

const safeReadCommands = new Set(["ls", "tree", "pwd", "cat", "find", "grep", "echo"]);
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
const dangerousWrappers = new Set([
  "sudo",
  "bash",
  "sh",
  "zsh",
  "fish",
  "env",
  "command",
  "exec",
  "eval",
  "source",
  ".",
  "!",
  "time",
  "nohup",
  "nice",
  "(",
]);
const shellAssignmentPattern = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;

interface ShellScanResult {
  segments: string[];
  hasDangerousControlSyntax: boolean;
}

function isShellWhitespace(character: string): boolean {
  return /\s/.test(character);
}

function isCommandSubstitutionStart(command: string, index: number): boolean {
  return command[index] === "$" && command[index + 1] === "(" && command[index + 2] !== "(";
}

function isProcessSubstitutionStart(command: string, index: number): boolean {
  return (command[index] === "<" || command[index] === ">") && command[index + 1] === "(";
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
      } else if (
        character === "`" ||
        isCommandSubstitutionStart(command, index)
      ) {
        return { segments: [command], hasDangerousControlSyntax: true };
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

    if (character === "&") {
      return { segments: [command], hasDangerousControlSyntax: true };
    }

    if (character === "|" && command[index + 1] === "|") {
      return { segments: [command], hasDangerousControlSyntax: true };
    }

    if (
      character === ";" ||
      character === "`" ||
      character === "\n" ||
      character === "\r" ||
      character === "<" ||
      character === ">" ||
      isCommandSubstitutionStart(command, index) ||
      isProcessSubstitutionStart(command, index)
    ) {
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

function normalizeExecutableToken(token: string): string {
  return path.basename(token);
}

function stripShellAssignments(tokens: string[]): string[] {
  let index = 0;

  while (index < tokens.length && shellAssignmentPattern.test(tokens[index])) {
    index += 1;
  }

  return tokens.slice(index);
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

function isDangerousGitPush(tokens: string[]): boolean {
  if (normalizeExecutableToken(tokens[0] ?? "") !== "git") {
    return false;
  }

  const pushIndex = tokens.indexOf("push");

  if (pushIndex < 0) {
    return false;
  }

  return tokens.slice(pushIndex + 1).some((token) => {
    if (token === "-f" || token === "--force" || token === "--force-with-lease") {
      return true;
    }

    if (token.startsWith("--force-with-lease=")) {
      return true;
    }

    return token.startsWith("+");
  });
}

function isDangerousFind(tokens: string[]): boolean {
  if (normalizeExecutableToken(tokens[0] ?? "") !== "find") {
    return false;
  }

  return tokens.some(
    (token) =>
      token === "-delete" ||
      token === "-exec" ||
      token === "-execdir" ||
      token === "-ok" ||
      token === "-okdir",
  );
}

function classifySingleCommand(command: string): CommandClassification {
  const tokens = stripShellAssignments(tokenizeShellWords(command));
  const token = normalizeExecutableToken(tokens[0] ?? "");
  const isGitHardReset =
    token === "git" && tokens.includes("reset") && tokens.includes("--hard");

  if (
    dangerousCommands.has(token) ||
    dangerousWrappers.has(token) ||
    token.startsWith("(") ||
    isGitHardReset ||
    isDangerousGitPush(tokens) ||
    isDangerousFind(tokens)
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

function findDeepestExistingPath(targetPath: string): string | null {
  let currentPath = targetPath;

  while (!fs.existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }

  return currentPath;
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

  if (fs.existsSync(normalizedRoot)) {
    const realRoot = tryRealpath(normalizedRoot);
    const deepestExistingPath = findDeepestExistingPath(resolved);

    if (realRoot !== null && deepestExistingPath !== null) {
      const realTarget = tryRealpath(deepestExistingPath);

      if (realTarget !== null && !isWithinRoot(realTarget, realRoot)) {
        throw new Error("Path escapes workspace root");
      }
    }
  }

  return resolved;
}
