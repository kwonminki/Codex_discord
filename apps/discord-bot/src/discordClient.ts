import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type Guild,
  type Message,
  type MessageEditOptions,
  type MessagePayload,
} from "discord.js";
import {
  registerDiscordApplicationCommands,
  routeDiscordApplicationCommand,
} from "./applicationCommands.js";
import type { DiscordGuildSurface } from "./codexSessionSync.js";
import type { DiscordMessageLike } from "./messageHandler.js";
import { COMPONENT_IDS, routeDiscordComponent } from "./componentRouter.js";
import {
  formatCodexThoughtView,
  getCodexThoughtView,
  withRoleMentions,
  type CodexThoughtView,
  type DiscordMessagePayload,
} from "./responses.js";

export { registerDiscordApplicationCommands };

interface DiscordMessageEventClient {
  on(eventName: "messageCreate", listener: (message: Message) => void): unknown;
}

interface DiscordInteractionEventClient {
  on(eventName: "interactionCreate", listener: (interaction: unknown) => void): unknown;
}

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
}

function getMemberRoleIds(member: unknown): string[] {
  const roles =
    typeof member === "object" && member !== null && "roles" in member
      ? (member as { roles?: unknown }).roles
      : null;

  if (Array.isArray(roles)) {
    return roles.filter((roleId): roleId is string => typeof roleId === "string");
  }

  if (typeof roles === "object" && roles !== null && "cache" in roles) {
    const cache = (roles as { cache?: unknown }).cache;

    if (cache instanceof Map) {
      return [...cache.keys()].filter((roleId): roleId is string => typeof roleId === "string");
    }
  }

  return [];
}

function getRoleIds(message: Message): string[] {
  return getMemberRoleIds(message.member);
}

interface EditableDiscordMessageLike {
  id: string;
  edit?(message: unknown): Promise<unknown>;
}

interface InteractionReplySource {
  reply(message: unknown): Promise<unknown>;
  editReply?(message: unknown): Promise<unknown>;
  fetchReply?(): Promise<unknown>;
  followUp?(message: unknown): Promise<unknown>;
  channel?: {
    send?(message: unknown): Promise<unknown>;
  } | null;
}

interface ClearableDiscordChannelLike {
  messages?: {
    fetch(input: { limit: number }): Promise<{ size: number }>;
  };
  bulkDelete?(messages: unknown, filterOld?: boolean): Promise<{ size: number }>;
}

interface ThreadParentDiscordChannelLike {
  threads?: {
    create(input: {
      name: string;
      autoArchiveDuration?: number;
      reason?: string;
    }): Promise<{ id: string }>;
  };
}

interface StoredCodexProgressMessage {
  view: CodexThoughtView;
  expanded: boolean;
  message?: EditableDiscordMessageLike;
}

const codexProgressMessages = new Map<string, StoredCodexProgressMessage>();

async function clearChannelMessages(input: {
  guild: Guild | null;
  channelId: string;
  mode: "all" | "count";
  count?: number;
}): Promise<{ deletedCount: number; requestedCount?: number | null }> {
  if (!input.guild) {
    throw new Error("Discord guild context is required for message deletion.");
  }

  const channel = (await input.guild.channels.fetch(input.channelId)) as ClearableDiscordChannelLike | null;

  if (!channel?.messages || typeof channel.bulkDelete !== "function") {
    throw new Error("Discord channel does not support bulk message deletion.");
  }

  const requestedCount = input.mode === "count" ? Math.min(Math.max(input.count ?? 1, 1), 100) : null;
  let remaining = requestedCount ?? Number.POSITIVE_INFINITY;
  let deletedCount = 0;

  while (remaining > 0) {
    const limit = Math.min(remaining, 100);
    const messages = await channel.messages.fetch({ limit });

    if (messages.size === 0) {
      break;
    }

    const deleted = await channel.bulkDelete(messages, true);
    deletedCount += deleted.size;

    if (input.mode === "count") {
      break;
    }

    if (messages.size < 100 || deleted.size === 0) {
      break;
    }
  }

  return {
    deletedCount,
    requestedCount,
  };
}

function isDiscordMessagePayload(message: unknown): message is DiscordMessagePayload {
  return (
    typeof message === "object" &&
    message !== null &&
    "allowedMentions" in message &&
    "embeds" in message &&
    Array.isArray((message as { embeds?: unknown }).embeds)
  );
}

function isEditableDiscordMessage(message: unknown): message is EditableDiscordMessageLike {
  return (
    typeof message === "object" &&
    message !== null &&
    "id" in message &&
    typeof (message as { id?: unknown }).id === "string"
  );
}

function prepareCodexProgressPayload(messageId: string, message: unknown): unknown {
  if (!isDiscordMessagePayload(message)) {
    codexProgressMessages.delete(messageId);
    return message;
  }

  const view = getCodexThoughtView(message);

  if (!view) {
    codexProgressMessages.delete(messageId);
    return message;
  }

  const expanded = codexProgressMessages.get(messageId)?.expanded ?? view.view.expanded;
  return formatCodexThoughtView(view, { expanded });
}

function prepareOutgoingMessage(
  content: string | DiscordMessagePayload,
  options?: { mentionRoleIds?: string[] },
): string | DiscordMessagePayload {
  const mentionRoleIds = options?.mentionRoleIds?.filter(Boolean) ?? [];
  return mentionRoleIds.length > 0 ? withRoleMentions(content, mentionRoleIds) : content;
}

function rememberCodexProgressMessage(message: unknown, payload: unknown): void {
  if (!isEditableDiscordMessage(message) || !isDiscordMessagePayload(payload)) {
    return;
  }

  const view = getCodexThoughtView(payload);

  if (!view) {
    codexProgressMessages.delete(message.id);
    return;
  }

  const previous = codexProgressMessages.get(message.id);
  codexProgressMessages.set(message.id, {
    view,
    expanded: previous?.expanded ?? view.view.expanded,
    message,
  });
}

export function createDiscordGuildSurface(guild: Guild | null): DiscordGuildSurface | null {
  if (!guild) {
    return null;
  }

  return {
    async createCategory(input) {
      const category = await guild.channels.create({
        name: input.name,
        type: ChannelType.GuildCategory,
      });

      return { id: category.id };
    },
    async createTextChannel(input) {
      const channel = await guild.channels.create({
        name: input.name,
        type: ChannelType.GuildText,
        parent: input.parentId ?? undefined,
        topic: input.topic,
      });

      return { id: channel.id };
    },
    async createThread(input) {
      const parentChannel = (await guild.channels.fetch(input.parentChannelId)) as ThreadParentDiscordChannelLike | null;

      if (typeof parentChannel?.threads?.create !== "function") {
        throw new Error("Discord channel cannot create threads.");
      }

      const thread = await parentChannel.threads.create({
        name: input.name,
        autoArchiveDuration: input.autoArchiveDuration,
        reason: input.reason?.slice(0, 512),
      });

      return { id: thread.id };
    },
    async sendTextMessage(channelId, content, options) {
      const channel = await guild.channels.fetch(channelId);
      const sender = channel as { send?: (message: string | DiscordMessagePayload) => Promise<unknown> } | null;
      if (typeof sender?.send !== "function") {
        throw new Error("Discord channel cannot receive text messages.");
      }

      const preparedContent = prepareOutgoingMessage(content, options);
      const sentMessage = await sender.send(preparedContent);
      rememberCodexProgressMessage(sentMessage, preparedContent);
      return isEditableDiscordMessage(sentMessage) ? { id: sentMessage.id } : undefined;
    },
    async editTextMessage(channelId, messageId, content) {
      const channel = await guild.channels.fetch(channelId);
      const messages =
        typeof channel === "object" && channel !== null && "messages" in channel
          ? (channel as { messages?: { fetch?(id: string): Promise<unknown> } }).messages
          : null;
      const message = await messages?.fetch?.(messageId);

      if (!isEditableDiscordMessage(message) || typeof message.edit !== "function") {
        throw new Error("Discord message cannot be edited.");
      }

      const editedMessage = await message.edit(content);
      rememberCodexProgressMessage(editedMessage ?? message, content);
      return isEditableDiscordMessage(editedMessage) ? { id: editedMessage.id } : { id: message.id };
    },
    async deleteChannel(id) {
      const channel = await guild.channels.fetch(id);
      await channel?.delete();
    },
    async deleteCategory(id) {
      const category = await guild.channels.fetch(id);
      await category?.delete();
    },
  };
}

export function attachDiscordMessageHandler(
  client: DiscordMessageEventClient,
  handleMessage: (message: DiscordMessageLike) => Promise<void>,
): void {
  client.on("messageCreate", (message) => {
    const discordMessage = message as Message;

    void handleMessage({
      authorBot: discordMessage.author.bot,
      userId: discordMessage.author.id,
      channelId: discordMessage.channelId,
      content: discordMessage.content,
      roleIds: getRoleIds(discordMessage),
      guild: createDiscordGuildSurface(discordMessage.guild),
      clearMessages: (clearInput) =>
        clearChannelMessages({
          guild: discordMessage.guild,
          channelId: discordMessage.channelId,
          ...clearInput,
        }),
      reply: async (replyMessage) => {
        const sentMessage = await discordMessage.reply(replyMessage);
        rememberCodexProgressMessage(sentMessage, replyMessage);

        if (!isEditableDiscordMessage(sentMessage) || typeof sentMessage.edit !== "function") {
          return sentMessage;
        }

        return {
          edit: async (nextMessage) => {
            const preparedMessage = prepareCodexProgressPayload(sentMessage.id, nextMessage);
            const editedMessage = await sentMessage.edit(preparedMessage as string | MessagePayload | MessageEditOptions);
            rememberCodexProgressMessage(editedMessage ?? sentMessage, preparedMessage);
            return editedMessage;
          },
        };
      },
    }).catch((error) => {
      console.error("discord-bot failed to handle message", error);
    });
  });
}

function isButtonInteraction(interaction: unknown): interaction is {
  isButton(): boolean;
  isStringSelectMenu?(): boolean;
  customId: string;
  values?: string[];
  user: { id: string };
  channelId: string;
  member?: unknown;
  guild: Guild | null;
  message?: EditableDiscordMessageLike;
  reply(message: unknown): Promise<unknown>;
  editReply?(message: unknown): Promise<unknown>;
  fetchReply?(): Promise<unknown>;
  followUp?(message: unknown): Promise<unknown>;
  channel?: { send?(message: unknown): Promise<unknown> } | null;
  update?(message: unknown): Promise<unknown>;
  showModal?(modal: unknown): Promise<unknown>;
} {
  return (
    typeof interaction === "object" &&
    interaction !== null &&
    "isButton" in interaction &&
    typeof (interaction as { isButton?: unknown }).isButton === "function" &&
    "customId" in interaction &&
    typeof (interaction as { customId?: unknown }).customId === "string"
  );
}

function isSupportedComponentInteraction(interaction: unknown): interaction is {
  isButton(): boolean;
  isStringSelectMenu?(): boolean;
  customId: string;
  values?: string[];
  user: { id: string };
  channelId: string;
  member?: unknown;
  guild: Guild | null;
  message?: EditableDiscordMessageLike;
  reply(message: unknown): Promise<unknown>;
  editReply?(message: unknown): Promise<unknown>;
  fetchReply?(): Promise<unknown>;
  followUp?(message: unknown): Promise<unknown>;
  channel?: { send?(message: unknown): Promise<unknown> } | null;
  update?(message: unknown): Promise<unknown>;
  showModal?(modal: unknown): Promise<unknown>;
} {
  if (!isButtonInteraction(interaction)) {
    return false;
  }

  if (interaction.isButton()) {
    return true;
  }

  return typeof interaction.isStringSelectMenu === "function" && interaction.isStringSelectMenu();
}

function isModalSubmitInteraction(interaction: unknown): interaction is {
  isModalSubmit(): boolean;
  customId: string;
  user: { id: string };
  channelId: string;
  member?: unknown;
  guild: Guild | null;
    reply(message: unknown): Promise<unknown>;
    editReply?(message: unknown): Promise<unknown>;
    fetchReply?(): Promise<unknown>;
    followUp?(message: unknown): Promise<unknown>;
    channel?: { send?(message: unknown): Promise<unknown> } | null;
    fields: { getTextInputValue(fieldId: string): string };
} {
  return (
    typeof interaction === "object" &&
    interaction !== null &&
    "isModalSubmit" in interaction &&
    typeof (interaction as { isModalSubmit?: unknown }).isModalSubmit === "function" &&
    "customId" in interaction &&
    typeof (interaction as { customId?: unknown }).customId === "string"
  );
}

function isChatInputCommandInteraction(interaction: unknown): interaction is {
  isChatInputCommand(): boolean;
  commandName: string;
  user: { id: string };
  channelId: string;
  member?: unknown;
  guild: Guild | null;
    reply(message: unknown): Promise<unknown>;
    editReply?(message: unknown): Promise<unknown>;
    fetchReply?(): Promise<unknown>;
    followUp?(message: unknown): Promise<unknown>;
    channel?: { send?(message: unknown): Promise<unknown> } | null;
    options: {
      getString(name: string, required?: boolean): string | null;
      getInteger?(name: string, required?: boolean): number | null;
      getBoolean?(name: string, required?: boolean): boolean | null;
    };
  } {
  return (
    typeof interaction === "object" &&
    interaction !== null &&
    "isChatInputCommand" in interaction &&
    typeof (interaction as { isChatInputCommand?: unknown }).isChatInputCommand === "function" &&
    "commandName" in interaction &&
    typeof (interaction as { commandName?: unknown }).commandName === "string" &&
    "options" in interaction &&
    typeof (interaction as { options?: unknown }).options === "object" &&
    (interaction as { options?: unknown }).options !== null
  );
}

function codexPromptModal() {
  return {
    title: "Codex에게 요청",
    custom_id: COMPONENT_IDS.codexSubmit,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "prompt",
            label: "요청 내용",
            style: 2,
            required: true,
            min_length: 1,
            max_length: 2_000,
            placeholder: "예: README 요약해줘 / 테스트 실패 고쳐줘",
          },
        ],
      },
    ],
  };
}

function codexContinueModal(sessionId: string) {
  return {
    title: "완료된 작업에 답장",
    custom_id: `cdc:codex:continue:submit:${sessionId}`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "prompt",
            label: "이어 할 요청",
            style: 2,
            required: true,
            min_length: 1,
            max_length: 2_000,
            placeholder: "예: 방금 수정한 내용 테스트까지 돌려줘",
          },
        ],
      },
    ],
  };
}

function parseCodexContinueButton(customId: string): string | null {
  const match = customId.match(/^cdc:codex:continue:([0-9a-f-]{32,36})$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function parseCodexContinueSubmit(customId: string): string | null {
  const match = customId.match(/^cdc:codex:continue:submit:([0-9a-f-]{32,36})$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function encodedCodexContinueCommand(input: {
  sessionId: string;
  prompt: string;
}): string {
  return `__cdc_codex_continue ${encodeURIComponent(JSON.stringify(input))}`;
}

function encodedNewChatCommand(input: {
  name: string | null;
  cwd: string | null;
  useCategory: boolean;
  initialPrompt: string | null;
}): string {
  return `__cdc_new_chat ${encodeURIComponent(JSON.stringify(input))}`;
}

function newChatModal(kind: "general" | "current") {
  return {
    title: kind === "current" ? "현재 폴더에서 새 채팅" : "새 일반 채팅",
    custom_id: kind === "current" ? "cdc:chat:submit:current" : "cdc:chat:submit:general",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "name",
            label: "채널 이름",
            style: 1,
            required: false,
            max_length: 90,
            placeholder: kind === "current" ? "예: 지금 폴더 작업" : "예: 자유 메모",
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "prompt",
            label: "첫 요청",
            style: 2,
            required: false,
            max_length: 2_000,
            placeholder: "비워두면 채널만 만들고, 새 채널에서 직접 요청할 수 있습니다.",
          },
        ],
      },
    ],
  };
}

function isNewChatButton(customId: string): customId is
  | typeof COMPONENT_IDS.newGeneralChat
  | typeof COMPONENT_IDS.newCurrentFolderChat
  | typeof COMPONENT_IDS.newHereChat {
  return (
    customId === COMPONENT_IDS.newGeneralChat ||
    customId === COMPONENT_IDS.newCurrentFolderChat ||
    customId === COMPONENT_IDS.newHereChat
  );
}

function isNewChatSubmit(customId: string): customId is "cdc:chat:submit:general" | "cdc:chat:submit:current" {
  return customId === "cdc:chat:submit:general" || customId === "cdc:chat:submit:current";
}

async function fetchInteractionReply(interaction: { fetchReply?(): Promise<unknown> }): Promise<unknown> {
  if (typeof interaction.fetchReply !== "function") {
    return null;
  }

  try {
    return await interaction.fetchReply();
  } catch {
    return null;
  }
}

function interactionReplyAdapter(interaction: InteractionReplySource) {
  let hasInitialReply = false;

  return async (replyMessage: unknown) => {
    if (hasInitialReply) {
      const sentMessage =
        typeof interaction.channel?.send === "function"
          ? await interaction.channel.send(replyMessage)
          : typeof interaction.followUp === "function"
            ? await interaction.followUp(replyMessage)
            : null;

      rememberCodexProgressMessage(sentMessage, replyMessage);

      if (!isEditableDiscordMessage(sentMessage) || typeof sentMessage.edit !== "function") {
        return undefined;
      }

      return {
        edit: async (nextMessage: unknown) => {
          const preparedMessage = prepareCodexProgressPayload(sentMessage.id, nextMessage);
          const editedMessage = await sentMessage.edit?.(preparedMessage);
          rememberCodexProgressMessage(editedMessage ?? sentMessage, preparedMessage);
          return editedMessage;
        },
      };
    }

    await interaction.reply(replyMessage);
    hasInitialReply = true;
    const initialMessage = await fetchInteractionReply(interaction);
    rememberCodexProgressMessage(initialMessage, replyMessage);

    if (!isEditableDiscordMessage(initialMessage) || typeof interaction.editReply !== "function") {
      return undefined;
    }

    return {
      edit: async (nextMessage: unknown) => {
        const preparedMessage = prepareCodexProgressPayload(initialMessage.id, nextMessage);
        const editedMessage = await interaction.editReply?.(preparedMessage);
        rememberCodexProgressMessage(editedMessage ?? initialMessage, preparedMessage);
        return editedMessage;
      },
    };
  };
}

function isCodexThoughtsToggle(customId: string): customId is
  | typeof COMPONENT_IDS.codexThoughtsOpen
  | typeof COMPONENT_IDS.codexThoughtsClose {
  return customId === COMPONENT_IDS.codexThoughtsOpen || customId === COMPONENT_IDS.codexThoughtsClose;
}

async function handleCodexThoughtsToggle(interaction: {
  customId: string;
  message?: EditableDiscordMessageLike;
  update?(message: unknown): Promise<unknown>;
  reply(message: unknown): Promise<unknown>;
}): Promise<void> {
  const messageId = interaction.message?.id;
  const stored = messageId ? codexProgressMessages.get(messageId) : null;

  if (!messageId || !stored) {
    await interaction.reply({
      allowedMentions: { parse: [] },
      ephemeral: true,
      content: "이 진행 메시지는 더 이상 펼칠 수 없습니다. 새 요청에서 다시 열어주세요.",
    });
    return;
  }

  const expanded = interaction.customId === COMPONENT_IDS.codexThoughtsOpen;
  const payload = formatCodexThoughtView(stored.view, { expanded });
  codexProgressMessages.set(messageId, {
    ...stored,
    expanded,
  });

  if (typeof interaction.update === "function") {
    await interaction.update(payload);
    return;
  }

  if (typeof stored.message?.edit === "function") {
    await stored.message.edit(payload);
    return;
  }

  await interaction.reply({
    allowedMentions: { parse: [] },
    ephemeral: true,
    content: "이 Discord 클라이언트에서는 진행 메시지를 수정할 수 없습니다.",
  });
}

export function attachDiscordInteractionHandler(
  client: DiscordInteractionEventClient,
  handleMessage: (message: DiscordMessageLike) => Promise<void>,
): void {
  client.on("interactionCreate", (interaction) => {
    if (isChatInputCommandInteraction(interaction) && interaction.isChatInputCommand()) {
      const content = routeDiscordApplicationCommand(interaction);

      if (!content) {
        void Promise.resolve(
          interaction.reply({
            allowedMentions: { parse: [] },
            ephemeral: true,
            content: "이 slash command는 아직 연결되어 있지 않습니다.",
          }),
        ).catch((error) => {
          console.error("discord-bot failed to acknowledge unknown slash command", error);
        });
        return;
      }

      void handleMessage({
        authorBot: false,
        userId: interaction.user.id,
        channelId: interaction.channelId,
        content,
        roleIds: getMemberRoleIds(interaction.member),
        guild: createDiscordGuildSurface(interaction.guild),
        clearMessages: (clearInput) =>
          clearChannelMessages({
            guild: interaction.guild,
            channelId: interaction.channelId,
            ...clearInput,
          }),
        reply: interactionReplyAdapter(interaction),
      }).catch((error) => {
        console.error("discord-bot failed to handle slash command", error);
      });
      return;
    }

    if (
      isModalSubmitInteraction(interaction) &&
      interaction.isModalSubmit() &&
      interaction.customId === COMPONENT_IDS.codexSubmit
    ) {
      const prompt = interaction.fields.getTextInputValue("prompt").trim();

      if (prompt.length === 0) {
        void Promise.resolve(
          interaction.reply({
            allowedMentions: { parse: [] },
            ephemeral: true,
            content: "요청 내용이 비어 있습니다.",
          }),
        ).catch((error) => {
          console.error("discord-bot failed to acknowledge empty Codex modal", error);
        });
        return;
      }

      void handleMessage({
        authorBot: false,
        userId: interaction.user.id,
        channelId: interaction.channelId,
        content: `codex ${prompt}`,
        roleIds: getMemberRoleIds(interaction.member),
        guild: createDiscordGuildSurface(interaction.guild),
        reply: interactionReplyAdapter(interaction),
      }).catch((error) => {
        console.error("discord-bot failed to handle Codex modal submit", error);
      });
      return;
    }

    if (isModalSubmitInteraction(interaction) && interaction.isModalSubmit()) {
      const continueSessionId = parseCodexContinueSubmit(interaction.customId);

      if (continueSessionId) {
        const prompt = interaction.fields.getTextInputValue("prompt").trim();

        if (prompt.length === 0) {
          void Promise.resolve(
            interaction.reply({
              allowedMentions: { parse: [] },
              ephemeral: true,
              content: "요청 내용이 비어 있습니다.",
            }),
          ).catch((error) => {
            console.error("discord-bot failed to acknowledge empty Codex continue modal", error);
          });
          return;
        }

        void handleMessage({
          authorBot: false,
          userId: interaction.user.id,
          channelId: interaction.channelId,
          content: encodedCodexContinueCommand({
            sessionId: continueSessionId,
            prompt,
          }),
          roleIds: getMemberRoleIds(interaction.member),
          guild: createDiscordGuildSurface(interaction.guild),
          reply: interactionReplyAdapter(interaction),
        }).catch((error) => {
          console.error("discord-bot failed to handle Codex continue modal submit", error);
        });
        return;
      }
    }

    if (isModalSubmitInteraction(interaction) && interaction.isModalSubmit() && isNewChatSubmit(interaction.customId)) {
      const name = interaction.fields.getTextInputValue("name").trim() || null;
      const initialPrompt = interaction.fields.getTextInputValue("prompt").trim() || null;
      const isCurrent = interaction.customId === "cdc:chat:submit:current";

      void handleMessage({
        authorBot: false,
        userId: interaction.user.id,
        channelId: interaction.channelId,
        content: encodedNewChatCommand({
          name,
          cwd: isCurrent ? "." : null,
          useCategory: isCurrent,
          initialPrompt,
        }),
        roleIds: getMemberRoleIds(interaction.member),
        guild: createDiscordGuildSurface(interaction.guild),
        reply: interactionReplyAdapter(interaction),
      }).catch((error) => {
        console.error("discord-bot failed to handle new chat modal submit", error);
      });
      return;
    }

    if (!isSupportedComponentInteraction(interaction)) {
      return;
    }

    if (interaction.isButton()) {
      const continueSessionId = parseCodexContinueButton(interaction.customId);

      if (continueSessionId) {
        if (typeof interaction.showModal !== "function") {
          void Promise.resolve(
            interaction.reply({
              allowedMentions: { parse: [] },
              ephemeral: true,
              content: "이 Discord 클라이언트는 모달을 열 수 없습니다.",
            }),
          ).catch((error) => {
            console.error("discord-bot failed to acknowledge missing modal support", error);
          });
          return;
        }

        void interaction.showModal(codexContinueModal(continueSessionId)).catch((error) => {
          console.error("discord-bot failed to show Codex continue modal", error);
        });
        return;
      }
    }

    if (interaction.isButton() && isCodexThoughtsToggle(interaction.customId)) {
      void handleCodexThoughtsToggle(interaction).catch((error) => {
        console.error("discord-bot failed to toggle Codex progress thoughts", error);
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === COMPONENT_IDS.codexAsk) {
      if (typeof interaction.showModal !== "function") {
        void Promise.resolve(
          interaction.reply({
            allowedMentions: { parse: [] },
            ephemeral: true,
            content: "이 Discord 클라이언트는 모달을 열 수 없습니다.",
          }),
        ).catch((error) => {
          console.error("discord-bot failed to acknowledge missing modal support", error);
        });
        return;
      }

      void interaction.showModal(codexPromptModal()).catch((error) => {
        console.error("discord-bot failed to show Codex modal", error);
      });
      return;
    }

    if (interaction.isButton() && isNewChatButton(interaction.customId)) {
      if (typeof interaction.showModal !== "function") {
        void Promise.resolve(
          interaction.reply({
            allowedMentions: { parse: [] },
            ephemeral: true,
            content: "이 Discord 클라이언트는 모달을 열 수 없습니다.",
          }),
        ).catch((error) => {
          console.error("discord-bot failed to acknowledge missing modal support", error);
        });
        return;
      }

      const kind = interaction.customId === COMPONENT_IDS.newGeneralChat ? "general" : "current";
      void interaction.showModal(newChatModal(kind)).catch((error) => {
        console.error("discord-bot failed to show new chat modal", error);
      });
      return;
    }

    const content = routeDiscordComponent(interaction.customId, interaction.values ?? []);

    if (!content) {
      void Promise.resolve(
        interaction.reply({
          allowedMentions: { parse: [] },
          ephemeral: true,
          content: "이 버튼은 더 이상 사용할 수 없습니다. `help`를 다시 눌러 최신 버튼을 열어주세요.",
        }),
      ).catch((error) => {
        console.error("discord-bot failed to acknowledge unknown button", error);
      });
      return;
    }

    void handleMessage({
      authorBot: false,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      content,
      roleIds: getMemberRoleIds(interaction.member),
      guild: createDiscordGuildSurface(interaction.guild),
      reply: interactionReplyAdapter(interaction),
    }).catch((error) => {
      console.error("discord-bot failed to handle interaction", error);
    });
  });
}
