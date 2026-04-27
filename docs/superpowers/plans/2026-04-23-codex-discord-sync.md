# Codex Discord Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MVP that connects Discord to Codex-managed computers with multi-machine registration, workspace/category mapping, channel/session attachment, shell execution, role checks, audit logs, and native Codex session import.

**Architecture:** Use a TypeScript monorepo with shared domain logic, a Discord bot process, a central control API, and a per-computer Local Agent. The Control DB is the operational source of truth, while the Local Agent's Codex Adapter reads native Codex files as an import and validation source without mutating them.

**Tech Stack:** Node.js 22+, TypeScript, pnpm workspaces, Vitest, discord.js, Fastify, ws, Prisma, SQLite, zod.

---

## Scope Check

This plan implements the approved MVP as one vertical system because the subsystems must integrate to prove the core product loop:

- Discord command intake
- Control DB state
- Local Agent heartbeat and job execution
- workspace shell execution
- Codex native session import
- audit and reconciliation

The plan avoids non-MVP features from the spec: full Codex UI mirroring, multi-session channels, interactive TUI streaming, aggressive auto-healing, and Discord voice or screen features.

## File Structure

Create this structure:

```text
.
|-- .env.example
|-- .gitignore
|-- package.json
|-- pnpm-workspace.yaml
|-- prisma/
|   `-- schema.prisma
|-- tsconfig.base.json
|-- tsconfig.json
|-- vitest.config.ts
|-- apps/
|   |-- control-api/
|   |   |-- package.json
|   |   `-- src/
|   |       |-- agentRegistry.ts
|   |       |-- audit.ts
|   |       |-- index.ts
|   |       |-- jobs.ts
|   |       |-- repositories.ts
|   |       |-- reconcile.ts
|   |       `-- server.ts
|   |-- discord-bot/
|   |   |-- package.json
|   |   `-- src/
|   |       |-- commandRouter.ts
|   |       |-- discordClient.ts
|   |       |-- index.ts
|   |       `-- responses.ts
|   `-- local-agent/
|       |-- package.json
|       `-- src/
|           |-- agentClient.ts
|           |-- codexAdapter.ts
|           |-- index.ts
|           |-- runner.ts
|           `-- workspace.ts
|-- packages/
|   |-- codex-adapter/
|   |   |-- package.json
|   |   |-- src/
|   |   |   |-- index.ts
|   |   |   `-- parser.ts
|   |   `-- test/
|   |       |-- fixtures/
|   |       |   |-- session_index.jsonl
|   |       |   `-- sessions/2026/04/22/rollout-2026-04-22T10-12-15-019db2be-b2b3-7e82-9e61-8c84b28ad287.jsonl
|   |       `-- parser.test.ts
|   `-- core/
|       |-- package.json
|       |-- src/
|       |   |-- domain.ts
|       |   |-- index.ts
|       |   `-- policy.ts
|       `-- test/
|           |-- domain.test.ts
|           `-- policy.test.ts
`-- tests/
    `-- e2e/
        `-- smoke.test.ts
```

Responsibilities:

- `packages/core`: pure domain types, channel state rules, command policy, authorization, and execution context logic.
- `packages/codex-adapter`: native Codex file parsing with fixtures and no runtime dependency on Discord or Prisma.
- `apps/control-api`: central state, REST endpoints, WebSocket agent registry, job dispatch, audit logging, and reconciliation.
- `apps/local-agent`: per-computer process that connects outbound, validates workspace paths, runs commands, and reads Codex data.
- `apps/discord-bot`: Discord client wiring plus a testable command router.
- `prisma/schema.prisma`: product source-of-truth schema.
- `tests/e2e`: smoke coverage of the MVP operator loop.

---

### Task 1: Repository and Tooling Skeleton

**Files:**

- Create: `.gitignore`
- Create: `.env.example`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `packages/core/package.json`
- Create: `packages/codex-adapter/package.json`
- Create: `apps/control-api/package.json`
- Create: `apps/discord-bot/package.json`
- Create: `apps/local-agent/package.json`

- [ ] **Step 1: Initialize git**

Run:

```bash
git init
```

Expected: git creates `.git/` in the project root.

- [ ] **Step 2: Write workspace metadata**

Create `package.json`:

```json
{
  "name": "codex-discord-sync",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "dev:control": "tsx apps/control-api/src/index.ts",
    "dev:bot": "tsx apps/discord-bot/src/index.ts",
    "dev:agent": "tsx apps/local-agent/src/index.ts"
  },
  "dependencies": {
    "@prisma/client": "^6.6.0",
    "discord.js": "^14.18.0",
    "fastify": "^5.2.1",
    "ws": "^8.18.1",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.14.0",
    "@types/ws": "^8.5.14",
    "prisma": "^6.6.0",
    "tsx": "^4.19.3",
    "typescript": "^5.8.3",
    "vitest": "^3.1.1"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
.env
.superpowers/
*.log
*.sqlite
*.sqlite-shm
*.sqlite-wal
coverage/
```

Create `.env.example`:

```bash
DATABASE_URL="file:./dev.sqlite"
CONTROL_API_HOST="127.0.0.1"
CONTROL_API_PORT="4317"
CONTROL_WS_URL="ws://127.0.0.1:4317/agents"
DISCORD_TOKEN=""
DISCORD_CLIENT_ID=""
DISCORD_GUILD_ID=""
DISCORD_ALLOWED_ROLE_IDS=""
AGENT_COMPUTER_ID="local-dev"
AGENT_DISPLAY_NAME="Local Dev"
AGENT_WORKSPACE_ROOT="/absolute/path/to/workspace"
CODEX_HOME="$HOME/.codex"
```

- [ ] **Step 3: Write TypeScript and Vitest config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

Create `tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "include": ["apps/**/*.ts", "packages/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write package manifests**

Create `packages/core/package.json`:

```json
{
  "name": "@codex-discord/core",
  "type": "module",
  "main": "src/index.ts"
}
```

Create `packages/codex-adapter/package.json`:

```json
{
  "name": "@codex-discord/codex-adapter",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@codex-discord/core": "workspace:*"
  }
}
```

Create `apps/control-api/package.json`:

```json
{
  "name": "@codex-discord/control-api",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@codex-discord/core": "workspace:*",
    "@codex-discord/codex-adapter": "workspace:*"
  }
}
```

Create `apps/discord-bot/package.json`:

```json
{
  "name": "@codex-discord/discord-bot",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@codex-discord/core": "workspace:*"
  }
}
```

Create `apps/local-agent/package.json`:

```json
{
  "name": "@codex-discord/local-agent",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@codex-discord/core": "workspace:*",
    "@codex-discord/codex-adapter": "workspace:*"
  }
}
```

- [ ] **Step 5: Install dependencies**

Run:

```bash
pnpm install
```

Expected: dependencies install and `pnpm-lock.yaml` is created.

- [ ] **Step 6: Verify empty toolchain**

Run:

```bash
pnpm test
```

Expected: test command exits successfully with no test files yet. Typecheck is first run after source files are created in Task 2.

- [ ] **Step 7: Commit**

Run:

```bash
git add .gitignore .env.example package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json vitest.config.ts packages apps
git commit -m "chore: scaffold TypeScript workspace"
```

Expected: commit succeeds.

---

### Task 2: Core Domain Model

**Files:**

- Create: `packages/core/src/domain.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/domain.test.ts`

- [ ] **Step 1: Write failing domain tests**

Create `packages/core/test/domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createManagedChannel,
  createWorkspaceCategoryName,
  linkCodexSession,
} from "../src/domain.js";

describe("domain mapping", () => {
  it("names workspace categories with computer context", () => {
    expect(createWorkspaceCategoryName("macbook-pro-01", "CodexDiscordConnector")).toBe(
      "macbook-pro-01 / CodexDiscordConnector",
    );
  });

  it("creates an unattached managed channel rooted at the workspace path", () => {
    const channel = createManagedChannel({
      channelId: "discord-channel-1",
      computerId: "computer-1",
      workspaceId: "workspace-1",
      workspaceRoot: "/Users/me/project",
      mode: "session-linked",
    });

    expect(channel.currentSessionLinkId).toBeNull();
    expect(channel.cwd).toBe("/Users/me/project");
    expect(channel.status).toBe("created");
  });

  it("links one active Codex session to a channel", () => {
    const channel = createManagedChannel({
      channelId: "discord-channel-1",
      computerId: "computer-1",
      workspaceId: "workspace-1",
      workspaceRoot: "/Users/me/project",
      mode: "session-linked",
    });

    const result = linkCodexSession(channel, {
      sessionLinkId: "link-1",
      codexSessionId: "019db2be-b2b3-7e82-9e61-8c84b28ad287",
      origin: "imported_native",
      threadNameSnapshot: "Codex Discord planning",
      attachedAt: "2026-04-23T00:00:00.000Z",
    });

    expect(result.channel.status).toBe("attached");
    expect(result.channel.currentSessionLinkId).toBe("link-1");
    expect(result.link.availabilityStatus).toBe("available");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run packages/core/test/domain.test.ts
```

Expected: FAIL because `packages/core/src/domain.ts` does not exist.

- [ ] **Step 3: Implement domain model**

Create `packages/core/src/domain.ts`:

```ts
export type ChannelMode = "shell-admin" | "session-linked";
export type ChannelStatus = "created" | "attached" | "active" | "archived" | "detached";
export type SessionOrigin = "managed_new" | "imported_native";
export type AvailabilityStatus = "available" | "unavailable";

export interface ManagedChannel {
  channelId: string;
  workspaceId: string;
  computerId: string;
  channelMode: ChannelMode;
  cwd: string;
  status: ChannelStatus;
  currentSessionLinkId: string | null;
}

export interface CodexSessionLink {
  sessionLinkId: string;
  channelId: string;
  codexSessionId: string;
  origin: SessionOrigin;
  threadNameSnapshot: string;
  attachedAt: string;
  availabilityStatus: AvailabilityStatus;
}

export interface CreateManagedChannelInput {
  channelId: string;
  workspaceId: string;
  computerId: string;
  workspaceRoot: string;
  mode: ChannelMode;
}

export interface LinkCodexSessionInput {
  sessionLinkId: string;
  codexSessionId: string;
  origin: SessionOrigin;
  threadNameSnapshot: string;
  attachedAt: string;
}

export function createWorkspaceCategoryName(computerDisplayName: string, workspaceDisplayName: string): string {
  return `${computerDisplayName} / ${workspaceDisplayName}`;
}

export function createManagedChannel(input: CreateManagedChannelInput): ManagedChannel {
  return {
    channelId: input.channelId,
    workspaceId: input.workspaceId,
    computerId: input.computerId,
    channelMode: input.mode,
    cwd: input.workspaceRoot,
    status: "created",
    currentSessionLinkId: null,
  };
}

export function linkCodexSession(
  channel: ManagedChannel,
  input: LinkCodexSessionInput,
): { channel: ManagedChannel; link: CodexSessionLink } {
  const link: CodexSessionLink = {
    sessionLinkId: input.sessionLinkId,
    channelId: channel.channelId,
    codexSessionId: input.codexSessionId,
    origin: input.origin,
    threadNameSnapshot: input.threadNameSnapshot,
    attachedAt: input.attachedAt,
    availabilityStatus: "available",
  };

  return {
    channel: {
      ...channel,
      status: "attached",
      currentSessionLinkId: link.sessionLinkId,
    },
    link,
  };
}
```

Create `packages/core/src/index.ts`:

```ts
export * from "./domain.js";
```

- [ ] **Step 4: Run domain tests**

Run:

```bash
pnpm vitest run packages/core/test/domain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/core
git commit -m "feat: add core domain model"
```

Expected: commit succeeds.

---

### Task 3: Command Policy and Authorization

**Files:**

- Create: `packages/core/src/policy.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create `packages/core/test/policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  authorizeCommand,
  classifyCommand,
  parseDiscordMessageCommand,
  updateCwd,
} from "../src/policy.js";

describe("command policy", () => {
  it("classifies safe read, normal mutate, and dangerous mutate commands", () => {
    expect(classifyCommand("ls -la").tier).toBe("safe-read");
    expect(classifyCommand("mkdir reports").tier).toBe("normal-mutate");
    expect(classifyCommand("rm -rf reports").tier).toBe("dangerous-mutate");
  });

  it("allows bare commands only in shell-admin channels", () => {
    expect(parseDiscordMessageCommand({ mode: "shell-admin", content: "ls" })).toEqual({
      kind: "command",
      command: "ls",
    });
    expect(parseDiscordMessageCommand({ mode: "session-linked", content: "ls" })).toEqual({
      kind: "chat",
      content: "ls",
    });
    expect(parseDiscordMessageCommand({ mode: "session-linked", content: "!ls" })).toEqual({
      kind: "command",
      command: "ls",
    });
  });

  it("requires an allowed role", () => {
    expect(
      authorizeCommand({
        userRoleIds: ["role-operator"],
        allowedRoleIds: ["role-operator"],
      }).allowed,
    ).toBe(true);

    expect(
      authorizeCommand({
        userRoleIds: ["role-viewer"],
        allowedRoleIds: ["role-operator"],
      }).allowed,
    ).toBe(false);
  });

  it("updates cwd only when the next path remains inside workspace root", () => {
    expect(updateCwd("/repo", "/repo/src", "..")).toBe("/repo");
    expect(() => updateCwd("/repo", "/repo", "..")).toThrow("Path escapes workspace root");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run packages/core/test/policy.test.ts
```

Expected: FAIL because `policy.ts` does not exist.

- [ ] **Step 3: Implement policy logic**

Create `packages/core/src/policy.ts`:

```ts
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
const normalMutateCommands = new Set(["mkdir", "touch", "mv", "cp", "git", "npm", "pnpm", "python", "python3", "node"]);
const dangerousCommands = new Set(["rm", "rmdir"]);

export function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

export function classifyCommand(command: string): CommandClassification {
  const token = firstToken(command);

  if (dangerousCommands.has(token) || command.includes("--force") || command.includes(" reset --hard")) {
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

  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error("Path escapes workspace root");
  }

  return resolved;
}
```

Modify `packages/core/src/index.ts`:

```ts
export * from "./domain.js";
export * from "./policy.js";
```

- [ ] **Step 4: Run policy and domain tests**

Run:

```bash
pnpm vitest run packages/core/test/domain.test.ts packages/core/test/policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/core
git commit -m "feat: add command policy and authorization"
```

Expected: commit succeeds.

---

### Task 4: Prisma Schema and Repository Layer

**Files:**

- Create: `prisma/schema.prisma`
- Create: `apps/control-api/src/repositories.ts`
- Create: `apps/control-api/src/audit.ts`
- Create: `apps/control-api/src/repositories.test.ts`

- [ ] **Step 1: Write Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Computer {
  id              String      @id
  displayName     String
  hostname        String
  status          String
  allowedRoleIds  String
  capabilities    String
  lastHeartbeatAt DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  workspaces      Workspace[]
}

model Workspace {
  id          String           @id
  computerId  String
  absolutePath String
  displayName String
  status      String
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  computer    Computer         @relation(fields: [computerId], references: [id])
  categories  CategoryMapping[]
  channels    ManagedChannel[]
}

model CategoryMapping {
  id                String    @id
  discordCategoryId String    @unique
  computerId        String
  workspaceId       String
  syncStatus        String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  workspace         Workspace @relation(fields: [workspaceId], references: [id])
}

model ManagedChannel {
  id                   String             @id
  discordChannelId      String             @unique
  computerId            String
  workspaceId           String
  channelMode           String
  cwd                   String
  status                String
  currentSessionLinkId  String?
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt
  workspace             Workspace          @relation(fields: [workspaceId], references: [id])
  sessionLinks          CodexSessionLink[]
  auditEvents           AuditEvent[]
}

model CodexSessionLink {
  id                 String         @id
  channelId          String
  codexSessionId     String
  origin             String
  threadNameSnapshot String
  attachedAt         DateTime
  availabilityStatus String
  createdAt          DateTime       @default(now())
  channel            ManagedChannel @relation(fields: [channelId], references: [id])
}

model AuditEvent {
  id              String         @id
  channelId       String?
  userId          String
  targetComputerId String
  targetWorkspaceId String?
  cwd             String?
  rawCommand      String
  tier            String
  resultStatus    String
  createdAt       DateTime       @default(now())
  channel         ManagedChannel? @relation(fields: [channelId], references: [id])
}
```

- [ ] **Step 2: Generate Prisma client**

Run:

```bash
pnpm prisma:generate
```

Expected: Prisma Client is generated without schema errors.

- [ ] **Step 3: Write failing repository tests**

Create `apps/control-api/src/repositories.test.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepositories } from "./repositories.js";

const prisma = new PrismaClient();

describe("repositories", () => {
  beforeAll(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.codexSessionLink.deleteMany();
    await prisma.managedChannel.deleteMany();
    await prisma.categoryMapping.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.computer.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("registers a computer, workspace, and channel", async () => {
    const repos = createRepositories(prisma);

    await repos.computers.upsertHeartbeat({
      id: "computer-1",
      displayName: "macbook-pro-01",
      hostname: "macbook-pro-01.local",
      allowedRoleIds: ["role-operator"],
      capabilities: ["shell", "codex-import"],
    });

    const workspace = await repos.workspaces.create({
      id: "workspace-1",
      computerId: "computer-1",
      absolutePath: "/Users/me/project",
      displayName: "project",
    });

    const channel = await repos.channels.create({
      id: "channel-1",
      discordChannelId: "discord-channel-1",
      computerId: "computer-1",
      workspaceId: workspace.id,
      channelMode: "shell-admin",
      cwd: "/Users/me/project",
    });

    expect(channel.status).toBe("created");
    expect(channel.cwd).toBe("/Users/me/project");
  });
});
```

- [ ] **Step 4: Run test to verify it fails before migration**

Run:

```bash
DATABASE_URL="file:./dev.sqlite" pnpm vitest run apps/control-api/src/repositories.test.ts
```

Expected: FAIL because SQLite tables do not exist or `repositories.ts` does not exist.

- [ ] **Step 5: Apply schema to local SQLite**

Run:

```bash
DATABASE_URL="file:./dev.sqlite" pnpm prisma db push
```

Expected: Prisma creates the SQLite schema.

- [ ] **Step 6: Implement repositories**

Create `apps/control-api/src/repositories.ts`:

```ts
import type { PrismaClient } from "@prisma/client";

export interface ComputerHeartbeatInput {
  id: string;
  displayName: string;
  hostname: string;
  allowedRoleIds: string[];
  capabilities: string[];
}

export interface WorkspaceCreateInput {
  id: string;
  computerId: string;
  absolutePath: string;
  displayName: string;
}

export interface ManagedChannelCreateInput {
  id: string;
  discordChannelId: string;
  computerId: string;
  workspaceId: string;
  channelMode: "shell-admin" | "session-linked";
  cwd: string;
}

export function createRepositories(prisma: PrismaClient) {
  return {
    computers: {
      upsertHeartbeat(input: ComputerHeartbeatInput) {
        return prisma.computer.upsert({
          where: { id: input.id },
          update: {
            displayName: input.displayName,
            hostname: input.hostname,
            status: "online",
            allowedRoleIds: JSON.stringify(input.allowedRoleIds),
            capabilities: JSON.stringify(input.capabilities),
            lastHeartbeatAt: new Date(),
          },
          create: {
            id: input.id,
            displayName: input.displayName,
            hostname: input.hostname,
            status: "online",
            allowedRoleIds: JSON.stringify(input.allowedRoleIds),
            capabilities: JSON.stringify(input.capabilities),
            lastHeartbeatAt: new Date(),
          },
        });
      },
    },
    workspaces: {
      create(input: WorkspaceCreateInput) {
        return prisma.workspace.create({
          data: {
            id: input.id,
            computerId: input.computerId,
            absolutePath: input.absolutePath,
            displayName: input.displayName,
            status: "valid",
          },
        });
      },
    },
    channels: {
      create(input: ManagedChannelCreateInput) {
        return prisma.managedChannel.create({
          data: {
            id: input.id,
            discordChannelId: input.discordChannelId,
            computerId: input.computerId,
            workspaceId: input.workspaceId,
            channelMode: input.channelMode,
            cwd: input.cwd,
            status: "created",
          },
        });
      },
      findByDiscordChannelId(discordChannelId: string) {
        return prisma.managedChannel.findUnique({ where: { discordChannelId } });
      },
    },
  };
}
```

Create `apps/control-api/src/audit.ts`:

```ts
import type { PrismaClient } from "@prisma/client";

export interface RecordAuditInput {
  id: string;
  channelId: string | null;
  userId: string;
  targetComputerId: string;
  targetWorkspaceId: string | null;
  cwd: string | null;
  rawCommand: string;
  tier: string;
  resultStatus: string;
}

export async function recordAuditEvent(prisma: PrismaClient, input: RecordAuditInput) {
  return prisma.auditEvent.create({
    data: {
      id: input.id,
      channelId: input.channelId,
      userId: input.userId,
      targetComputerId: input.targetComputerId,
      targetWorkspaceId: input.targetWorkspaceId,
      cwd: input.cwd,
      rawCommand: input.rawCommand,
      tier: input.tier,
      resultStatus: input.resultStatus,
    },
  });
}
```

- [ ] **Step 7: Run repository tests**

Run:

```bash
DATABASE_URL="file:./dev.sqlite" pnpm vitest run apps/control-api/src/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add prisma apps/control-api/src package.json pnpm-lock.yaml
git commit -m "feat: add control database repositories"
```

Expected: commit succeeds.

---

### Task 5: Native Codex Session Parser

**Files:**

- Create: `packages/codex-adapter/src/parser.ts`
- Create: `packages/codex-adapter/src/index.ts`
- Create: `packages/codex-adapter/test/fixtures/session_index.jsonl`
- Create: `packages/codex-adapter/test/fixtures/sessions/2026/04/22/rollout-2026-04-22T10-12-15-019db2be-b2b3-7e82-9e61-8c84b28ad287.jsonl`
- Create: `packages/codex-adapter/test/parser.test.ts`

- [ ] **Step 1: Write Codex fixtures**

Create `packages/codex-adapter/test/fixtures/session_index.jsonl`:

```jsonl
{"id":"019db2be-b2b3-7e82-9e61-8c84b28ad287","thread_name":"Codex Discord planning","updated_at":"2026-04-22T01:15:24.714Z"}
{"id":"019db2ba-8c6b-7d13-89ef-3b2cbb8a8b62","thread_name":"Previous local session","updated_at":"2026-04-22T01:07:43.000Z"}
```

Create `packages/codex-adapter/test/fixtures/sessions/2026/04/22/rollout-2026-04-22T10-12-15-019db2be-b2b3-7e82-9e61-8c84b28ad287.jsonl`:

```jsonl
{"timestamp":"2026-04-22T01:15:24.714Z","type":"session_meta","payload":{"id":"019db2be-b2b3-7e82-9e61-8c84b28ad287","cwd":"/Users/dgsw36/Desktop/01_프로젝트-개발/앱-도구/CodexDiscordConnector","originator":"Codex Desktop","cli_version":"0.122.0-alpha.13"}}
{"timestamp":"2026-04-22T01:15:25.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"기획하자"}]}}
```

- [ ] **Step 2: Write failing parser tests**

Create `packages/codex-adapter/test/parser.test.ts`:

```ts
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
      cwdHint: "/Users/dgsw36/Desktop/01_프로젝트-개발/앱-도구/CodexDiscordConnector",
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
pnpm vitest run packages/codex-adapter/test/parser.test.ts
```

Expected: FAIL because `parser.ts` does not exist.

- [ ] **Step 4: Implement parser**

Create `packages/codex-adapter/src/parser.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";

export interface CodexSessionIndexEntry {
  id: string;
  threadName: string;
  updatedAt: string;
}

export interface CodexSessionMeta {
  id: string;
  cwd: string;
}

export interface DiscoveredCodexSession extends CodexSessionIndexEntry {
  cwdHint: string | null;
}

export function parseSessionIndexLine(line: string): CodexSessionIndexEntry {
  const parsed = JSON.parse(line) as { id?: string; thread_name?: string; updated_at?: string };

  if (!parsed.id || !parsed.thread_name || !parsed.updated_at) {
    throw new Error("Invalid Codex session index line");
  }

  return {
    id: parsed.id,
    threadName: parsed.thread_name,
    updatedAt: parsed.updated_at,
  };
}

export function parseSessionMetaLine(line: string): CodexSessionMeta | null {
  const parsed = JSON.parse(line) as {
    type?: string;
    payload?: { id?: string; cwd?: string };
  };

  if (parsed.type !== "session_meta" || !parsed.payload?.id || !parsed.payload.cwd) {
    return null;
  }

  return {
    id: parsed.payload.id,
    cwd: parsed.payload.cwd,
  };
}

export async function discoverCodexSessions(codexHome: string): Promise<DiscoveredCodexSession[]> {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  const indexText = await fs.readFile(indexPath, "utf8");
  const entries = indexText
    .split("\n")
    .filter(Boolean)
    .map(parseSessionIndexLine)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const withHints = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      cwdHint: await findCwdHint(codexHome, entry.id),
    })),
  );

  return withHints;
}

async function findCwdHint(codexHome: string, sessionId: string): Promise<string | null> {
  const sessionsRoot = path.join(codexHome, "sessions");
  const files = await listJsonlFiles(sessionsRoot);
  const sessionFile = files.find((file) => file.includes(sessionId));

  if (!sessionFile) {
    return null;
  }

  const text = await fs.readFile(sessionFile, "utf8");
  for (const line of text.split("\n").filter(Boolean)) {
    const meta = parseSessionMetaLine(line);
    if (meta?.id === sessionId) {
      return meta.cwd;
    }
  }

  return null;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return listJsonlFiles(fullPath);
      }
      return entry.isFile() && entry.name.endsWith(".jsonl") ? [fullPath] : [];
    }),
  );

  return nested.flat();
}
```

Create `packages/codex-adapter/src/index.ts`:

```ts
export * from "./parser.js";
```

- [ ] **Step 5: Run parser tests**

Run:

```bash
pnpm vitest run packages/codex-adapter/test/parser.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/codex-adapter
git commit -m "feat: parse native Codex sessions"
```

Expected: commit succeeds.

---

### Task 6: Local Agent Workspace and Shell Runner

**Files:**

- Create: `apps/local-agent/src/workspace.ts`
- Create: `apps/local-agent/src/runner.ts`
- Create: `apps/local-agent/src/runner.test.ts`
- Create: `apps/local-agent/src/codexAdapter.ts`

- [ ] **Step 1: Write failing runner tests**

Create `apps/local-agent/src/runner.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWorkspaceCommand } from "./runner.js";
import { assertInsideWorkspace } from "./workspace.js";

let workspaceRoot: string;

describe("local agent runner", () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "codex-discord-"));
    await writeFile(path.join(workspaceRoot, "README.md"), "hello from workspace\n");
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("blocks paths outside the workspace", () => {
    expect(() => assertInsideWorkspace(workspaceRoot, path.dirname(workspaceRoot))).toThrow(
      "Path escapes workspace root",
    );
  });

  it("runs safe read commands in the workspace", async () => {
    const result = await runWorkspaceCommand({
      workspaceRoot,
      cwd: workspaceRoot,
      command: "cat README.md",
      timeoutMs: 3000,
      confirmedDangerous: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello from workspace");
  });

  it("requires confirmation for dangerous commands", async () => {
    const result = await runWorkspaceCommand({
      workspaceRoot,
      cwd: workspaceRoot,
      command: "rm README.md",
      timeoutMs: 3000,
      confirmedDangerous: false,
    });

    expect(result.status).toBe("blocked");
    expect(result.stderr).toContain("requires confirmation");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/local-agent/src/runner.test.ts
```

Expected: FAIL because runner files do not exist.

- [ ] **Step 3: Implement workspace validation**

Create `apps/local-agent/src/workspace.ts`:

```ts
import path from "node:path";

export function assertInsideWorkspace(workspaceRoot: string, targetPath: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(targetPath);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Path escapes workspace root");
  }

  return target;
}
```

- [ ] **Step 4: Implement shell runner**

Create `apps/local-agent/src/runner.ts`:

```ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { classifyCommand } from "@codex-discord/core";
import { assertInsideWorkspace } from "./workspace.js";

const execAsync = promisify(exec);

export interface RunWorkspaceCommandInput {
  workspaceRoot: string;
  cwd: string;
  command: string;
  timeoutMs: number;
  confirmedDangerous: boolean;
}

export interface RunWorkspaceCommandResult {
  status: "completed" | "blocked" | "failed";
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export async function runWorkspaceCommand(input: RunWorkspaceCommandInput): Promise<RunWorkspaceCommandResult> {
  const cwd = assertInsideWorkspace(input.workspaceRoot, input.cwd);
  const classification = classifyCommand(input.command);

  if (classification.requiresConfirmation && !input.confirmedDangerous) {
    return {
      status: "blocked",
      stdout: "",
      stderr: `Command tier ${classification.tier} requires confirmation`,
      exitCode: null,
    };
  }

  try {
    const result = await execAsync(input.command, {
      cwd,
      timeout: input.timeoutMs,
      maxBuffer: 1024 * 1024,
      shell: "/bin/zsh",
    });

    return {
      status: "completed",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    return {
      status: "failed",
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "Command failed",
      exitCode: typeof failed.code === "number" ? failed.code : 1,
    };
  }
}
```

Create `apps/local-agent/src/codexAdapter.ts`:

```ts
import { discoverCodexSessions } from "@codex-discord/codex-adapter";

export async function listNativeCodexSessions(codexHome: string) {
  return discoverCodexSessions(codexHome);
}
```

- [ ] **Step 5: Run runner tests**

Run:

```bash
pnpm vitest run apps/local-agent/src/runner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/local-agent
git commit -m "feat: add local agent command runner"
```

Expected: commit succeeds.

---

### Task 7: Control API and Agent Job Dispatch

**Files:**

- Create: `apps/control-api/src/agentRegistry.ts`
- Create: `apps/control-api/src/jobs.ts`
- Create: `apps/control-api/src/server.ts`
- Create: `apps/control-api/src/index.ts`
- Create: `apps/control-api/src/server.test.ts`

- [ ] **Step 1: Write failing server tests**

Create `apps/control-api/src/server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "./agentRegistry.js";
import { createServer } from "./server.js";

describe("control api", () => {
  it("reports health", async () => {
    const app = createServer({ agentRegistry: createAgentRegistry() });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("lists registered online agents", async () => {
    const registry = createAgentRegistry();
    registry.register({
      computerId: "computer-1",
      displayName: "macbook-pro-01",
      capabilities: ["shell", "codex-import"],
      send: async () => undefined,
    });

    const app = createServer({ agentRegistry: registry });
    const response = await app.inject({ method: "GET", url: "/computers" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        computerId: "computer-1",
        displayName: "macbook-pro-01",
        capabilities: ["shell", "codex-import"],
        status: "online",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/control-api/src/server.test.ts
```

Expected: FAIL because control API files do not exist.

- [ ] **Step 3: Implement agent registry**

Create `apps/control-api/src/agentRegistry.ts`:

```ts
export interface RegisteredAgent {
  computerId: string;
  displayName: string;
  capabilities: string[];
  send(message: unknown): Promise<void>;
}

export interface AgentSummary {
  computerId: string;
  displayName: string;
  capabilities: string[];
  status: "online";
}

export function createAgentRegistry() {
  const agents = new Map<string, RegisteredAgent>();

  return {
    register(agent: RegisteredAgent) {
      agents.set(agent.computerId, agent);
    },
    get(computerId: string) {
      return agents.get(computerId) ?? null;
    },
    list(): AgentSummary[] {
      return [...agents.values()].map((agent) => ({
        computerId: agent.computerId,
        displayName: agent.displayName,
        capabilities: agent.capabilities,
        status: "online",
      }));
    },
  };
}
```

- [ ] **Step 4: Implement job dispatch**

Create `apps/control-api/src/jobs.ts`:

```ts
import crypto from "node:crypto";
import type { createAgentRegistry } from "./agentRegistry.js";

export interface AgentJob {
  jobId: string;
  type: "run-command" | "list-codex-sessions";
  payload: unknown;
}

export function createJob(computerId: string, type: AgentJob["type"], payload: unknown) {
  return {
    computerId,
    job: {
      jobId: crypto.randomUUID(),
      type,
      payload,
    },
  };
}

export async function dispatchJob(
  registry: ReturnType<typeof createAgentRegistry>,
  computerId: string,
  job: AgentJob,
) {
  const agent = registry.get(computerId);
  if (!agent) {
    throw new Error("Computer is offline");
  }

  await agent.send(job);
}
```

- [ ] **Step 5: Implement Fastify server**

Create `apps/control-api/src/server.ts`:

```ts
import Fastify from "fastify";
import type { createAgentRegistry } from "./agentRegistry.js";

export interface CreateServerInput {
  agentRegistry: ReturnType<typeof createAgentRegistry>;
}

export function createServer(input: CreateServerInput) {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));
  app.get("/computers", async () => input.agentRegistry.list());

  return app;
}
```

Create `apps/control-api/src/index.ts`:

```ts
import { createAgentRegistry } from "./agentRegistry.js";
import { createServer } from "./server.js";

const host = process.env.CONTROL_API_HOST ?? "127.0.0.1";
const port = Number(process.env.CONTROL_API_PORT ?? "4317");

const app = createServer({ agentRegistry: createAgentRegistry() });

await app.listen({ host, port });
console.log(`control-api listening on http://${host}:${port}`);
```

- [ ] **Step 6: Run server tests**

Run:

```bash
pnpm vitest run apps/control-api/src/server.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/control-api
git commit -m "feat: add control api and agent registry"
```

Expected: commit succeeds.

---

### Task 8: Local Agent Client

**Files:**

- Create: `apps/local-agent/src/agentClient.ts`
- Create: `apps/local-agent/src/index.ts`
- Create: `apps/local-agent/src/agentClient.test.ts`

- [ ] **Step 1: Write failing client tests**

Create `apps/local-agent/src/agentClient.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAgentHelloMessage, handleAgentJob } from "./agentClient.js";

describe("agent client", () => {
  it("creates a hello message for registration", () => {
    expect(
      createAgentHelloMessage({
        computerId: "local-dev",
        displayName: "Local Dev",
        capabilities: ["shell", "codex-import"],
      }),
    ).toEqual({
      type: "agent-hello",
      computerId: "local-dev",
      displayName: "Local Dev",
      capabilities: ["shell", "codex-import"],
    });
  });

  it("rejects unknown jobs", async () => {
    await expect(
      handleAgentJob({
        jobId: "job-1",
        type: "unknown",
        payload: {},
      }),
    ).rejects.toThrow("Unsupported agent job type");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/local-agent/src/agentClient.test.ts
```

Expected: FAIL because `agentClient.ts` does not exist.

- [ ] **Step 3: Implement agent client helpers**

Create `apps/local-agent/src/agentClient.ts`:

```ts
import WebSocket from "ws";
import { listNativeCodexSessions } from "./codexAdapter.js";
import { runWorkspaceCommand } from "./runner.js";

export interface AgentConfig {
  computerId: string;
  displayName: string;
  capabilities: string[];
}

export interface AgentJob {
  jobId: string;
  type: string;
  payload: unknown;
}

export function createAgentHelloMessage(config: AgentConfig) {
  return {
    type: "agent-hello",
    computerId: config.computerId,
    displayName: config.displayName,
    capabilities: config.capabilities,
  };
}

export async function handleAgentJob(job: AgentJob) {
  if (job.type === "run-command") {
    return runWorkspaceCommand(job.payload as Parameters<typeof runWorkspaceCommand>[0]);
  }

  if (job.type === "list-codex-sessions") {
    const payload = job.payload as { codexHome: string };
    return listNativeCodexSessions(payload.codexHome);
  }

  throw new Error("Unsupported agent job type");
}

export function connectAgent(wsUrl: string, config: AgentConfig) {
  const socket = new WebSocket(wsUrl);

  socket.on("open", () => {
    socket.send(JSON.stringify(createAgentHelloMessage(config)));
  });

  socket.on("message", async (raw) => {
    const job = JSON.parse(raw.toString()) as AgentJob;
    const result = await handleAgentJob(job);
    socket.send(JSON.stringify({ type: "agent-job-result", jobId: job.jobId, result }));
  });

  return socket;
}
```

Create `apps/local-agent/src/index.ts`:

```ts
import { connectAgent } from "./agentClient.js";

const computerId = process.env.AGENT_COMPUTER_ID ?? "local-dev";
const displayName = process.env.AGENT_DISPLAY_NAME ?? computerId;
const wsUrl = process.env.CONTROL_WS_URL ?? "ws://127.0.0.1:4317/agents";

connectAgent(wsUrl, {
  computerId,
  displayName,
  capabilities: ["shell", "codex-import"],
});

console.log(`local-agent ${computerId} connecting to ${wsUrl}`);
```

- [ ] **Step 4: Run client tests**

Run:

```bash
pnpm vitest run apps/local-agent/src/agentClient.test.ts apps/local-agent/src/runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/local-agent
git commit -m "feat: add local agent client"
```

Expected: commit succeeds.

---

### Task 9: Discord Bot Command Router

**Files:**

- Create: `apps/discord-bot/src/commandRouter.ts`
- Create: `apps/discord-bot/src/responses.ts`
- Create: `apps/discord-bot/src/discordClient.ts`
- Create: `apps/discord-bot/src/index.ts`
- Create: `apps/discord-bot/src/commandRouter.test.ts`

- [ ] **Step 1: Write failing router tests**

Create `apps/discord-bot/src/commandRouter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { routeDiscordMessage } from "./commandRouter.js";

describe("discord command router", () => {
  it("routes bare shell-admin messages to command execution", () => {
    expect(
      routeDiscordMessage({
        channelMode: "shell-admin",
        content: "ls",
        userRoleIds: ["role-operator"],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "execute-command",
      command: "ls",
    });
  });

  it("routes session-linked normal text to Codex chat", () => {
    expect(
      routeDiscordMessage({
        channelMode: "session-linked",
        content: "what changed in this repo?",
        userRoleIds: ["role-operator"],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "codex-chat",
      content: "what changed in this repo?",
    });
  });

  it("denies unauthorized command execution", () => {
    expect(
      routeDiscordMessage({
        channelMode: "shell-admin",
        content: "ls",
        userRoleIds: ["role-viewer"],
        allowedRoleIds: ["role-operator"],
      }),
    ).toEqual({
      type: "denied",
      reason: "User does not have an allowed role",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/discord-bot/src/commandRouter.test.ts
```

Expected: FAIL because router files do not exist.

- [ ] **Step 3: Implement command router**

Create `apps/discord-bot/src/commandRouter.ts`:

```ts
import type { ChannelMode } from "@codex-discord/core";
import { authorizeCommand, parseDiscordMessageCommand } from "@codex-discord/core";

export interface RouteDiscordMessageInput {
  channelMode: ChannelMode;
  content: string;
  userRoleIds: string[];
  allowedRoleIds: string[];
}

export type RoutedDiscordMessage =
  | { type: "execute-command"; command: string }
  | { type: "codex-chat"; content: string }
  | { type: "denied"; reason: string };

export function routeDiscordMessage(input: RouteDiscordMessageInput): RoutedDiscordMessage {
  const parsed = parseDiscordMessageCommand({
    mode: input.channelMode,
    content: input.content,
  });

  if (parsed.kind === "chat") {
    return { type: "codex-chat", content: parsed.content };
  }

  const auth = authorizeCommand({
    userRoleIds: input.userRoleIds,
    allowedRoleIds: input.allowedRoleIds,
  });

  if (!auth.allowed) {
    return { type: "denied", reason: auth.reason ?? "Unauthorized" };
  }

  return { type: "execute-command", command: parsed.command };
}
```

Create `apps/discord-bot/src/responses.ts`:

```ts
export function formatCommandAck(input: {
  computerDisplayName: string;
  workspaceDisplayName: string;
  cwd: string;
  command: string;
}) {
  return [
    `Target: ${input.computerDisplayName} / ${input.workspaceDisplayName}`,
    `cwd: ${input.cwd}`,
    `command: ${input.command}`,
    "state: queued",
  ].join("\n");
}

export function formatDenied(reason: string) {
  return `Permission denied: ${reason}`;
}
```

Create `apps/discord-bot/src/discordClient.ts`:

```ts
import { Client, GatewayIntentBits } from "discord.js";

export function createDiscordClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
}
```

Create `apps/discord-bot/src/index.ts`:

```ts
import { createDiscordClient } from "./discordClient.js";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("DISCORD_TOKEN is required");
}

const client = createDiscordClient();

client.once("ready", () => {
  console.log(`discord-bot logged in as ${client.user?.tag ?? "unknown"}`);
});

await client.login(token);
```

- [ ] **Step 4: Run router tests**

Run:

```bash
pnpm vitest run apps/discord-bot/src/commandRouter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/discord-bot
git commit -m "feat: add Discord command router"
```

Expected: commit succeeds.

---

### Task 10: Reconciliation Decisions

**Files:**

- Create: `apps/control-api/src/reconcile.ts`
- Create: `apps/control-api/src/reconcile.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Create `apps/control-api/src/reconcile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideReconciliationAction } from "./reconcile.js";

describe("reconciliation", () => {
  it("marks unmanaged Discord channels for explicit adoption", () => {
    expect(decideReconciliationAction({ discordExists: true, dbExists: false, localSessionExists: true })).toEqual({
      action: "offer-adopt-channel",
      executionAllowed: false,
    });
  });

  it("tombstones missing Discord channels while preserving history", () => {
    expect(decideReconciliationAction({ discordExists: false, dbExists: true, localSessionExists: true })).toEqual({
      action: "mark-channel-tombstoned",
      executionAllowed: false,
    });
  });

  it("blocks execution when the linked Codex session is missing", () => {
    expect(decideReconciliationAction({ discordExists: true, dbExists: true, localSessionExists: false })).toEqual({
      action: "mark-session-unavailable",
      executionAllowed: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/control-api/src/reconcile.test.ts
```

Expected: FAIL because `reconcile.ts` does not exist.

- [ ] **Step 3: Implement reconciliation decisions**

Create `apps/control-api/src/reconcile.ts`:

```ts
export interface ReconciliationInput {
  discordExists: boolean;
  dbExists: boolean;
  localSessionExists: boolean;
}

export type ReconciliationDecision =
  | { action: "offer-adopt-channel"; executionAllowed: false }
  | { action: "mark-channel-tombstoned"; executionAllowed: false }
  | { action: "mark-session-unavailable"; executionAllowed: false }
  | { action: "no-action"; executionAllowed: true };

export function decideReconciliationAction(input: ReconciliationInput): ReconciliationDecision {
  if (input.discordExists && !input.dbExists) {
    return { action: "offer-adopt-channel", executionAllowed: false };
  }

  if (!input.discordExists && input.dbExists) {
    return { action: "mark-channel-tombstoned", executionAllowed: false };
  }

  if (input.discordExists && input.dbExists && !input.localSessionExists) {
    return { action: "mark-session-unavailable", executionAllowed: false };
  }

  return { action: "no-action", executionAllowed: true };
}
```

- [ ] **Step 4: Run reconciliation tests**

Run:

```bash
pnpm vitest run apps/control-api/src/reconcile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/control-api/src/reconcile.ts apps/control-api/src/reconcile.test.ts
git commit -m "feat: add reconciliation decisions"
```

Expected: commit succeeds.

---

### Task 11: End-to-End Smoke Test Skeleton

**Files:**

- Create: `tests/e2e/smoke.test.ts`
- Modify: `apps/control-api/src/server.ts`
- Modify: `apps/control-api/src/agentRegistry.ts`

- [ ] **Step 1: Write failing smoke test**

Create `tests/e2e/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "../../apps/control-api/src/agentRegistry.js";
import { createJob } from "../../apps/control-api/src/jobs.js";

describe("mvp smoke flow", () => {
  it("dispatches an ls command to an online agent", async () => {
    const sent: unknown[] = [];
    const registry = createAgentRegistry();

    registry.register({
      computerId: "computer-1",
      displayName: "macbook-pro-01",
      capabilities: ["shell", "codex-import"],
      send: async (message) => {
        sent.push(message);
      },
    });

    const { job } = createJob("computer-1", "run-command", {
      workspaceRoot: "/repo",
      cwd: "/repo",
      command: "ls",
      timeoutMs: 3000,
      confirmedDangerous: false,
    });

    await registry.get("computer-1")?.send(job);

    expect(sent).toEqual([
      {
        jobId: job.jobId,
        type: "run-command",
        payload: {
          workspaceRoot: "/repo",
          cwd: "/repo",
          command: "ls",
          timeoutMs: 3000,
          confirmedDangerous: false,
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run smoke test**

Run:

```bash
pnpm vitest run tests/e2e/smoke.test.ts
```

Expected: PASS if the previous job and registry tasks are implemented correctly.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add tests apps packages
git commit -m "test: add MVP smoke flow"
```

Expected: commit succeeds.

---

### Task 12: Operator Documentation

**Files:**

- Create: `README.md`
- Create: `docs/operator-guide.md`

- [ ] **Step 1: Write README**

Create `README.md`:

````md
# Codex Discord Sync

Codex Discord Sync connects a Discord server to one or more computers running Local Agents.

The MVP supports:

- registering computers
- mapping computer workspaces to Discord categories
- creating managed Discord channels
- running role-gated shell commands
- importing native Codex sessions from local Codex data
- recording execution audit events

## Development

```bash
pnpm install
DATABASE_URL="file:./dev.sqlite" pnpm prisma db push
pnpm test
pnpm typecheck
```

## Processes

```bash
pnpm dev:control
pnpm dev:agent
pnpm dev:bot
```

Copy `.env.example` to `.env` and fill in Discord credentials before starting the bot.
````

- [ ] **Step 2: Write operator guide**

Create `docs/operator-guide.md`:

````md
# Operator Guide

## Channel Modes

### shell-admin

Bare messages execute as commands after role checks.

Example:

```text
ls
git status
pnpm test
```

### session-linked

Normal messages are treated as Codex chat. Operational commands use a prefix or slash command.

Example:

```text
!ls
!cat README.md
/session import
```

## Safety Rules

- Command execution requires an approved Discord role.
- Each managed channel has its own current working directory.
- A successful `cd` changes only that channel's cwd.
- Dangerous commands require explicit confirmation.
- Offline computers block execution.
- Missing Codex session links block session-dependent actions.

## Native Codex Import

The Local Agent reads native Codex data from `CODEX_HOME`, usually `$HOME/.codex`.

The import flow reads:

- `session_index.jsonl`
- session transcript files under `sessions/`

Native Codex files are not modified by import.
````

- [ ] **Step 3: Run documentation verification**

Run:

```bash
test -f README.md
test -f docs/operator-guide.md
pnpm test
pnpm typecheck
```

Expected: all commands succeed.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md docs/operator-guide.md
git commit -m "docs: add operator guide"
```

Expected: commit succeeds.

---

## Final Verification

Run:

```bash
pnpm test
pnpm typecheck
DATABASE_URL="file:./dev.sqlite" pnpm prisma db push
```

Expected:

- all Vitest tests pass
- TypeScript typecheck passes
- Prisma schema applies to SQLite

Run:

```bash
git status --short
```

Expected:

- no uncommitted implementation changes remain

## Implementation Notes

- Keep the Codex Adapter isolated from Discord and Prisma so native Codex storage changes are contained.
- Keep Discord message parsing pure and tested so `shell-admin` and `session-linked` behavior stays predictable.
- Enforce workspace boundaries inside the Local Agent, not only in the Discord Bot.
- Treat Control DB identity fields as authoritative and display names as mutable labels.
- Do not add automatic destructive recovery actions in this MVP.

## Plan Self-Review

Spec coverage:

- Multi-computer registration: Tasks 4, 7, and 8.
- Workspace/category/channel mapping: Tasks 2, 4, 9, and 12.
- Role-gated shell execution: Tasks 3, 6, 9, and 11.
- Native Codex import: Tasks 5 and 8.
- Session attachment domain model: Tasks 2 and 4.
- Audit logging: Task 4.
- Reconciliation: Task 10.
- Testing strategy: Tasks 2 through 12.

Placeholder scan:

- The plan contains no unresolved placeholder markers.

Type consistency:

- Channel modes use `shell-admin` and `session-linked` consistently.
- Session origins use `managed_new` and `imported_native` consistently.
- Command tiers use `safe-read`, `normal-mutate`, and `dangerous-mutate` consistently.
