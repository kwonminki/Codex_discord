import { CODEX_DISCORD_HOW_TO_USE_PROMPT } from "./codexUsagePrompt.js";

const OPTION_TYPES = {
  string: 3,
  integer: 4,
  boolean: 5,
} as const;

export interface DiscordApplicationCommandDefinition {
  name: string;
  description: string;
  options?: DiscordApplicationCommandOptionDefinition[];
}

export interface DiscordApplicationCommandOptionDefinition {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  min_value?: number;
  max_value?: number;
  choices?: DiscordApplicationCommandChoiceDefinition[];
}

export interface DiscordApplicationCommandChoiceDefinition {
  name: string;
  value: string | number;
}

export interface DiscordApplicationCommandInteractionLike {
  commandName: string;
  options: {
    getString(name: string, required?: boolean): string | null;
    getInteger?(name: string, required?: boolean): number | null;
    getBoolean?(name: string, required?: boolean): boolean | null;
  };
}

interface DiscordCommandRegistrar {
  commands: {
    set(commands: readonly DiscordApplicationCommandDefinition[]): Promise<unknown>;
  };
}

interface DiscordCommandRegistrationClient {
  application?: DiscordCommandRegistrar | null;
  guilds?: {
    cache?: {
      get(guildId: string): DiscordCommandRegistrar | undefined;
    };
    fetch?(guildId: string): Promise<DiscordCommandRegistrar>;
  };
}

function stringOption(input: {
  name: string;
  description: string;
  required?: boolean;
  choices?: DiscordApplicationCommandChoiceDefinition[];
}): DiscordApplicationCommandOptionDefinition {
  return {
    type: OPTION_TYPES.string,
    name: input.name,
    description: input.description,
    required: input.required,
    choices: input.choices,
  };
}

function integerOption(input: {
  name: string;
  description: string;
  required?: boolean;
  minValue?: number;
  maxValue?: number;
}): DiscordApplicationCommandOptionDefinition {
  return {
    type: OPTION_TYPES.integer,
    name: input.name,
    description: input.description,
    required: input.required,
    min_value: input.minValue,
    max_value: input.maxValue,
  };
}

function booleanOption(input: {
  name: string;
  description: string;
  required?: boolean;
}): DiscordApplicationCommandOptionDefinition {
  return {
    type: OPTION_TYPES.boolean,
    name: input.name,
    description: input.description,
    required: input.required,
  };
}

export const DISCORD_APPLICATION_COMMANDS: readonly DiscordApplicationCommandDefinition[] = [
  {
    name: "codex",
    description: "Codex에게 자연어로 요청합니다.",
    options: [
      stringOption({
        name: "prompt",
        description: "Codex에게 보낼 요청",
        required: true,
      }),
    ],
  },
  {
    name: "codex-command",
    description: "지원되는 Codex/bridge 단축 명령을 실행합니다. 예: model, diff, mcp list",
    options: [
      stringOption({
        name: "command",
        description: "앞의 /를 제외한 Codex 명령어 이름",
        required: true,
      }),
      stringOption({
        name: "prompt",
        description: "명령어 뒤에 붙일 프롬프트 또는 인자",
      }),
    ],
  },
  {
    name: "compact",
    description: "현재 작업 맥락을 압축 요약하도록 Codex에 요청합니다.",
    options: [
      stringOption({
        name: "prompt",
        description: "compact에 함께 전달할 요청",
      }),
    ],
  },
  {
    name: "skill",
    description: "지정한 skill 관점으로 Codex 요청을 실행합니다.",
    options: [
      stringOption({
        name: "name",
        description: "사용할 skill 이름",
        required: true,
      }),
      stringOption({
        name: "prompt",
        description: "skill과 함께 실행할 요청",
        required: true,
      }),
    ],
  },
  {
    name: "model",
    description: "이 Discord 채널의 이후 Codex 요청에 사용할 모델을 설정합니다.",
    options: [
      stringOption({
        name: "model",
        description: "전환하거나 확인할 모델 이름",
        required: true,
      }),
    ],
  },
  {
    name: "fast",
    description: "이 채널의 Codex 요청을 빠른 응답 모드로 전환합니다.",
  },
  {
    name: "task",
    description: "이 채널의 Codex 요청을 작업 수행 모드로 전환합니다.",
  },
  {
    name: "codex-mode",
    description: "이 채널의 Codex 실행 모드를 설정하거나 기본값으로 되돌립니다.",
    options: [
      stringOption({
        name: "mode",
        description: "default, fast, task 중 하나",
        required: true,
        choices: [
          { name: "default", value: "default" },
          { name: "fast", value: "fast" },
          { name: "task", value: "task" },
        ],
      }),
    ],
  },
  {
    name: "status",
    description: "현재 채널의 연결 상태, 작업 위치, Codex 세션을 보여줍니다.",
  },
  {
    name: "diff",
    description: "현재 작업 위치에서 git diff 요약을 보여줍니다.",
  },
  {
    name: "review",
    description: "현재 변경사항을 Codex에게 리뷰시킵니다.",
    options: [
      stringOption({
        name: "prompt",
        description: "리뷰 관점 또는 추가 지시",
      }),
    ],
  },
  {
    name: "fix-tests",
    description: "테스트 실행, 실패 분석, 수정을 Codex에게 요청합니다.",
  },
  {
    name: "summarize",
    description: "현재 채널 또는 프로젝트 맥락을 요약합니다.",
    options: [
      stringOption({
        name: "target",
        description: "요약할 대상",
      }),
    ],
  },
  {
    name: "howtouse",
    description: "Discord 봇 사용법과 첨부 전송 형식을 현재 Codex 세션에 전달합니다.",
  },
  {
    name: "where",
    description: "현재 Discord 채널이 연결된 컴퓨터/작업 위치를 보여줍니다.",
  },
  {
    name: "reload",
    description: "봇 명령어를 Discord에서 재등록하거나 봇 재시작을 요청합니다.",
    options: [
      stringOption({
        name: "mode",
        description: "commands 또는 restart. 비워두면 commands입니다.",
        choices: [
          { name: "commands", value: "commands" },
          { name: "restart", value: "restart" },
        ],
      }),
      booleanOption({
        name: "confirm",
        description: "restart 모드 실행을 확정합니다.",
      }),
    ],
  },
  {
    name: "clear",
    description: "관리자 채널의 최근 메시지를 삭제합니다.",
    options: [
      integerOption({
        name: "count",
        description: "삭제할 최근 메시지 수. 비우면 가능한 전체 메시지를 삭제합니다.",
        minValue: 1,
        maxValue: 100,
      }),
      booleanOption({
        name: "all",
        description: "가능한 전체 메시지를 삭제합니다.",
      }),
    ],
  },
  {
    name: "sync",
    description: "동기화할 활성 Codex 세션을 선택하는 목록을 엽니다.",
    options: [
      integerOption({
        name: "limit",
        description: "선택 목록에 보여줄 최대 세션 수",
        minValue: 1,
        maxValue: 25,
      }),
    ],
  },
  {
    name: "sync-all",
    description: "활성 Codex 세션을 선택 없이 모두 동기화합니다.",
    options: [
      integerOption({
        name: "limit",
        description: "가져올 최대 세션 수",
        minValue: 1,
        maxValue: 100,
      }),
    ],
  },
  {
    name: "sync-select",
    description: "활성 Codex 세션 목록에서 원하는 세션만 선택해 동기화합니다.",
    options: [
      integerOption({
        name: "limit",
        description: "선택 목록에 보여줄 최대 세션 수",
        minValue: 1,
        maxValue: 25,
      }),
    ],
  },
  {
    name: "sync-status",
    description: "현재 동기화된 카테고리/세션/보관 상태를 보여줍니다.",
  },
  {
    name: "sync-mode",
    description: "동기화된 Codex 채널의 transcript 반영 방식을 선택합니다.",
    options: [
      stringOption({
        name: "mode",
        description: "채팅 시작 시 동기화 또는 실시간 폴링",
        required: true,
        choices: [
          { name: "on-chat", value: "on-chat" },
          { name: "realtime", value: "realtime" },
        ],
      }),
    ],
  },
  {
    name: "sync-delete",
    description: "동기화된 Discord 세션 채널을 삭제합니다. 먼저 preview로 확인하세요.",
    options: [
      stringOption({
        name: "mode",
        description: "preview, all, channels, session 중 선택",
        required: true,
        choices: [
          { name: "preview", value: "preview" },
          { name: "all", value: "all" },
          { name: "channels", value: "channels" },
          { name: "session", value: "session" },
        ],
      }),
      stringOption({
        name: "session_id",
        description: "mode가 session일 때 삭제할 Codex 세션 ID",
      }),
      booleanOption({
        name: "confirm",
        description: "실제 삭제 실행을 확정합니다.",
      }),
    ],
  },
  {
    name: "sync-archive",
    description: "특정 Codex 세션을 브리지에서 보관 처리해 다음 sync에서 제외합니다.",
    options: [
      stringOption({
        name: "session_id",
        description: "보관할 Codex 세션 ID",
        required: true,
      }),
      booleanOption({
        name: "confirm",
        description: "실제 보관 실행을 확정합니다.",
      }),
    ],
  },
  {
    name: "schedule",
    description: "특정 시간, 주기, 요일에 기존 Discord 명령을 반복 실행합니다.",
    options: [
      stringOption({
        name: "action",
        description: "create, list, delete 중 선택",
        required: true,
        choices: [
          { name: "create", value: "create" },
          { name: "list", value: "list" },
          { name: "delete", value: "delete" },
        ],
      }),
      stringOption({
        name: "mode",
        description: "create일 때 once, every, daily, weekly 중 선택",
        choices: [
          { name: "once", value: "once" },
          { name: "every", value: "every" },
          { name: "daily", value: "daily" },
          { name: "weekly", value: "weekly" },
        ],
      }),
      stringOption({
        name: "command",
        description: "반복 실행할 기존 채팅형 명령. 예: shell pnpm test, codex README 요약",
      }),
      stringOption({
        name: "at",
        description: "once: YYYY-MM-DD HH:mm 또는 ISO. daily/weekly: HH:mm",
      }),
      stringOption({
        name: "every",
        description: "every 모드 주기. 예: 10m, 1h, 1d",
      }),
      stringOption({
        name: "weekdays",
        description: "weekly 모드 요일. 예: mon,wed,fri 또는 월,수,금",
      }),
      stringOption({
        name: "id",
        description: "delete일 때 삭제할 schedule id",
      }),
    ],
  },
  {
    name: "chat-new",
    description: "새 Codex 채팅 채널을 만듭니다. 일반/현재 폴더/지정 폴더 중 위치를 고릅니다.",
    options: [
      stringOption({
        name: "name",
        description: "새 Discord 채널/채팅 이름",
      }),
      stringOption({
        name: "location",
        description: "general, current, path 중 선택합니다. 비우면 cwd 유무로 결정합니다.",
        choices: [
          { name: "general", value: "general" },
          { name: "current", value: "current" },
          { name: "path", value: "path" },
        ],
      }),
      stringOption({
        name: "cwd",
        description: "location:path일 때 Codex를 시작할 폴더 경로입니다.",
      }),
      booleanOption({
        name: "category",
        description: "cwd가 있을 때 해당 폴더 카테고리 아래에 생성합니다.",
      }),
      stringOption({
        name: "prompt",
        description: "채널 생성 후 첫 요청으로 안내할 프롬프트",
      }),
    ],
  },
  {
    name: "fork",
    description: "현재 Codex 또는 Claude Code session thread를 새 Discord thread로 fork합니다.",
  },
  {
    name: "steer",
    description: "현재 실행 중인 Codex 작업에 즉시 추가 지시를 보냅니다.",
    options: [
      stringOption({
        name: "prompt",
        description: "현재 turn에 추가할 지시",
        required: true,
      }),
    ],
  },
  {
    name: "interrupt",
    description: "현재 실행 중인 Codex 작업을 중단합니다.",
  },
  {
    name: "queue",
    description: "현재 채널의 실행 중 작업과 대기 요청을 보여줍니다.",
  },
  {
    name: "queue-clear",
    description: "현재 실행은 유지하고 이 채널의 대기 요청을 모두 삭제합니다.",
  },
  {
    name: "archive",
    description: "현재 Codex 세션 채널을 보관하고 다음 sync에서 제외합니다.",
  },
  {
    name: "browse",
    description: "현재 위치의 파일 목록을 버튼/드롭다운 UI로 엽니다.",
  },
  {
    name: "shell",
    description: "현재 채널 위치에서 shell 명령을 실행합니다.",
    options: [
      stringOption({
        name: "command",
        description: "실행할 shell 명령",
        required: true,
      }),
    ],
  },
];

function normalizeSlashCommandName(command: string): string | null {
  const normalized = command.trim().replace(/^\/+/, "").toLowerCase();

  if (!/^[a-z0-9_-]{1,32}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function compactPrompt(prompt: string | null): string {
  const normalizedPrompt = prompt?.trim() ?? "";
  return normalizedPrompt.length > 0
    ? `codex 지금까지의 작업 맥락을 압축 요약해줘. ${normalizedPrompt}`
    : "codex 지금까지의 작업 맥락을 압축 요약해줘.";
}

function skillPrompt(skillName: string, prompt: string): string {
  return `codex ${skillName} skill을 적용해서 다음 요청을 처리해줘: ${prompt}`;
}

function routeCodexCommandShortcut(commandName: string, prompt: string | null): string | null {
  switch (commandName) {
    case "status":
      return "where";
    case "diff":
      return "__cdc_exec git diff --stat";
    case "model": {
      const model = prompt?.trim();
      return model ? `model ${model}` : null;
    }
    case "review":
      return `__cdc_codex_review ${prompt?.trim() || "현재 변경사항을 리뷰해줘."}`;
    case "compact":
      return compactPrompt(prompt);
    case "mcp":
      return prompt?.trim() ? `__cdc_exec codex mcp ${prompt.trim()}` : "__cdc_exec codex mcp list";
    default:
      return `codex Codex CLI 명령 '${commandName}'을 직접 실행할 수 있는지 확인하고, 가능하면 대체 실행 방법을 제안해줘. 인자: ${prompt?.trim() || "(none)"}`;
  }
}

function encodedNewChatCommand(input: {
  name: string | null;
  cwd: string | null;
  useCategory: boolean;
  initialPrompt: string | null;
}): string {
  return `__cdc_new_chat ${encodeURIComponent(JSON.stringify(input))}`;
}

function encodedScheduleCommand(input: {
  action: string | null;
  mode: string | null;
  command: string | null;
  at: string | null;
  every: string | null;
  weekdays: string | null;
  id: string | null;
}): string {
  return `__cdc_schedule ${encodeURIComponent(JSON.stringify(input))}`;
}

export function routeDiscordApplicationCommand(
  interaction: DiscordApplicationCommandInteractionLike,
): string | null {
  const commandName = interaction.commandName.trim().toLowerCase();

  switch (commandName) {
    case "codex":
      return `codex ${interaction.options.getString("prompt", true)?.trim() ?? ""}`.trim();
    case "codex-command": {
      const commandName = normalizeSlashCommandName(interaction.options.getString("command", true) ?? "");

      if (!commandName) {
        return null;
      }

      return routeCodexCommandShortcut(commandName, interaction.options.getString("prompt"));
    }
    case "compact":
      return compactPrompt(interaction.options.getString("prompt"));
    case "skill": {
      const skillName = interaction.options.getString("name", true)?.trim();
      const prompt = interaction.options.getString("prompt", true)?.trim();

      if (!skillName || !prompt) {
        return null;
      }

      return skillPrompt(skillName, prompt);
    }
    case "model": {
      const model = interaction.options.getString("model", true)?.trim();
      return model ? `model ${model}` : null;
    }
    case "fast":
      return "fast";
    case "task":
      return "task";
    case "codex-mode": {
      const mode = interaction.options.getString("mode", true)?.trim().toLowerCase();
      return mode === "default" || mode === "fast" || mode === "task" ? `mode ${mode}` : null;
    }
    case "status":
      return "where";
    case "diff":
      return "__cdc_exec git diff --stat";
    case "review":
      return `__cdc_codex_review ${interaction.options.getString("prompt")?.trim() || "현재 변경사항을 리뷰해줘."}`;
    case "fix-tests":
      return "codex 테스트를 실행하고 실패 원인을 분석한 뒤 수정해줘. 수정 후 테스트를 다시 실행해줘";
    case "summarize":
      return `codex ${interaction.options.getString("target")?.trim() || "현재 채널"}을 요약하고 다음 액션을 제안해줘`;
    case "howtouse":
    case "how-to-use":
    case "how_to_use":
      return `codex ${CODEX_DISCORD_HOW_TO_USE_PROMPT}`;
    case "where":
      return "where";
    case "reload": {
      const mode = interaction.options.getString("mode")?.trim().toLowerCase() || "commands";

      if (mode !== "commands" && mode !== "restart") {
        return null;
      }

      if (mode === "restart") {
        return interaction.options.getBoolean?.("confirm") ? "reload restart confirm" : "reload restart";
      }

      return "reload commands";
    }
    case "clear": {
      const count = interaction.options.getInteger?.("count");

      if (count && count > 0) {
        return `clear ${Math.min(count, 100)}`;
      }

      return interaction.options.getBoolean?.("all") ? "clear all" : "clear";
    }
    case "sync": {
      const limit = interaction.options.getInteger?.("limit") ?? 25;
      return `sync select ${Math.min(limit, 25)}`;
    }
    case "sync-all": {
      const limit = interaction.options.getInteger?.("limit") ?? 25;
      return `sync all ${limit}`;
    }
    case "sync-select": {
      const limit = interaction.options.getInteger?.("limit") ?? 25;
      return `sync select ${Math.min(limit, 25)}`;
    }
    case "sync-status":
      return "sync status";
    case "sync-mode": {
      const mode = interaction.options.getString("mode", true)?.trim().toLowerCase();
      return mode === "on-chat" || mode === "realtime" ? `sync mode ${mode}` : null;
    }
    case "sync-delete": {
      const mode = interaction.options.getString("mode", true)?.trim().toLowerCase();
      const confirmed = interaction.options.getBoolean?.("confirm") ? " confirm" : "";

      if (mode === "preview") {
        return "sync delete preview";
      }

      if (mode === "all" || mode === "channels") {
        return `sync delete ${mode}${confirmed}`;
      }

      if (mode === "session") {
        const sessionId = interaction.options.getString("session_id")?.trim().toLowerCase();
        return sessionId ? `sync delete session ${sessionId}${confirmed}` : null;
      }

      return null;
    }
    case "sync-archive": {
      const sessionId = interaction.options.getString("session_id", true)?.trim().toLowerCase();
      const confirmed = interaction.options.getBoolean?.("confirm") ? " confirm" : "";
      return sessionId ? `sync archive ${sessionId}${confirmed}` : null;
    }
    case "schedule":
      return encodedScheduleCommand({
        action: interaction.options.getString("action", true)?.trim().toLowerCase() ?? null,
        mode: interaction.options.getString("mode")?.trim().toLowerCase() ?? null,
        command: interaction.options.getString("command")?.trim() ?? null,
        at: interaction.options.getString("at")?.trim() ?? null,
        every: interaction.options.getString("every")?.trim() ?? null,
        weekdays: interaction.options.getString("weekdays")?.trim() ?? null,
        id: interaction.options.getString("id")?.trim() ?? null,
      });
    case "chat-new": {
      const name = interaction.options.getString("name")?.trim() || null;
      const location = interaction.options.getString("location")?.trim().toLowerCase() || null;
      const rawCwd = interaction.options.getString("cwd")?.trim() || null;
      const categoryOption = interaction.options.getBoolean?.("category");
      const initialPrompt = interaction.options.getString("prompt")?.trim() || null;
      const cwd = location === "general" ? null : location === "current" ? "." : rawCwd;
      const useCategory = location === "general" ? false : location === "current" ? true : (categoryOption ?? Boolean(cwd));

      return encodedNewChatCommand({
        name,
        cwd,
        useCategory,
        initialPrompt,
      });
    }
    case "steer": {
      const prompt = interaction.options.getString("prompt", true)?.trim();
      return prompt ? `steer ${prompt}` : null;
    }
    case "interrupt":
      return "interrupt";
    case "queue":
      return "queue";
    case "queue-clear":
      return "queue-clear";
    case "archive":
      return "archive";
    case "browse":
      return "__cdc_exec __cdc_ls 0";
    case "shell":
      return `__cdc_exec ${interaction.options.getString("command", true)?.trim() ?? ""}`.trim();
    default:
      return null;
  }
}

export async function registerDiscordApplicationCommands(
  client: DiscordCommandRegistrationClient,
  guildId?: string,
): Promise<void> {
  if (guildId) {
    const guild = client.guilds?.cache?.get(guildId) ?? (await client.guilds?.fetch?.(guildId));

    if (!guild) {
      throw new Error(`Discord guild ${guildId} is not available for command registration.`);
    }

    await guild.commands.set(DISCORD_APPLICATION_COMMANDS);
    return;
  }

  if (!client.application) {
    throw new Error("Discord application is not available for command registration.");
  }

  await client.application.commands.set(DISCORD_APPLICATION_COMMANDS);
}
