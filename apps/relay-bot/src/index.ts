import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type AnyThreadChannel,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
  type Message,
} from "discord.js";
import {
  AGENT_RELAY_PROMPT_ATTACHMENT_NAME,
  agentRelayTurnResultSchema,
  formatConnectorDiscoveryMarker,
  formatAgentRelayCancelMarker,
  formatAgentRelayRequestMarker,
  formatAgentRelayStateMarker,
  parseConnectorPresenceMarker,
  parseAgentRelayFilesMarker,
  parseAgentRelayResultMarker,
  splitDiscordMessageContent,
  type AgentRelayTurnResult,
  type ConnectorPresence,
  type ConnectorLocale,
} from "../../../packages/core/src/index.js";
import {
  createRelayCoordinator,
  type RelayCoordinator,
  type RelayTransferFile,
} from "./coordinator.js";
import { loadRelayBotConfig } from "./config.js";
import { relayLocaleText } from "./i18n.js";
import {
  buildReleaseUpdatePrompt,
  parseReleaseFooter,
  parseReleaseUpdateButtonId,
  releaseUpdateButtonId,
  selectConnectorUpdateTargets,
  type ReleaseMetadata,
} from "./releaseDeployment.js";
import {
  DEFAULT_RELAY_TIMEOUT_MS,
  MAX_RELAY_TIMEOUT_MS,
  createRelayConversationStore,
  type RelayConversation,
} from "./store.js";

const MAX_RELAY_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RELAY_FILES = 10;
const MAX_RELAY_TRANSFER_FILES = MAX_RELAY_FILES - 1;
const MAX_PROMPT_CONTENT = 1_850;
export const DEFAULT_MAX_ROUNDS = 20;
export const DEFAULT_TIMEOUT_MINUTES = DEFAULT_RELAY_TIMEOUT_MS / 60_000;
export const MAX_TIMEOUT_MINUTES = MAX_RELAY_TIMEOUT_MS / 60_000;
const THREAD_AUTOCOMPLETE_LIMIT = 25;
const THREAD_CACHE_TTL_MS = 2_000;
const EXTENSION_BUTTON_PREFIX = "agent-relay:extend:";
const EXTENSION_REJECT_BUTTON_PREFIX = "agent-relay:reject-extension:";
const CONNECTOR_DISCOVERY_WAIT_MS = 2_500;

export function relayCommands(locale: ConnectorLocale = "ko") {
  const text = relayLocaleText(locale);
  return [
    {
      name: "agent-chat",
      description: text.commandStart,
      options: [
        {
          type: 7,
          name: "parent",
          description: text.commandParent,
          required: true,
          channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
        },
        {
          type: 3,
          name: "peer",
          description: text.commandPeer,
          required: true,
          autocomplete: true,
        },
        {
          type: 3,
          name: "goal",
          description: text.commandGoal,
          required: true,
        },
        {
          type: 4,
          name: "max_rounds",
          description: text.commandMaxRounds,
          min_value: 1,
          max_value: 20,
        },
        {
          type: 4,
          name: "timeout_minutes",
          description: text.commandTimeout,
          min_value: 5,
          max_value: MAX_TIMEOUT_MINUTES,
        },
      ],
    },
    {
      name: "agent-chat-status",
      description: text.commandStatus,
    },
    {
      name: "agent-chat-stop",
      description: text.commandStop,
    },
  ] as const;
}

export const RELAY_COMMANDS = relayCommands();

export interface RelayThreadChoiceCandidate {
  id: string;
  name: string;
  parentName: string;
  archived: boolean;
}

export function parseRelayExtensionButtonId(customId: string): string | null {
  if (!customId.startsWith(EXTENSION_BUTTON_PREFIX)) {
    return null;
  }
  const conversationId = customId.slice(EXTENSION_BUTTON_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)
    ? conversationId.toLowerCase()
    : null;
}

export function parseRelayExtensionRejectButtonId(customId: string): string | null {
  if (!customId.startsWith(EXTENSION_REJECT_BUTTON_PREFIX)) {
    return null;
  }
  const conversationId = customId.slice(EXTENSION_REJECT_BUTTON_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)
    ? conversationId.toLowerCase()
    : null;
}

export function relayExtensionActionRows(
  conversationId: string,
  disabled = false,
  locale: ConnectorLocale = "ko",
) {
  const text = relayLocaleText(locale);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EXTENSION_BUTTON_PREFIX}${conversationId}`)
      .setLabel(text.buttonExtend)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${EXTENSION_REJECT_BUTTON_PREFIX}${conversationId}`)
      .setLabel(text.buttonReject)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  )];
}

export function releaseUpdateActionRows(
  release: ReleaseMetadata,
  disabled = false,
  locale: ConnectorLocale = "ko",
) {
  const text = relayLocaleText(locale);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(releaseUpdateButtonId(release))
      .setLabel(text.releaseUpdateButton)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  )];
}

export function releaseUpdateNotice(
  content: string,
  operatorRoleIds: string[],
): {
  content: string;
  allowedMentions: { parse: []; roles: string[] };
} {
  const roleIds = [...new Set(operatorRoleIds.map((roleId) => roleId.trim()).filter(Boolean))];
  return {
    content: [
      ...roleIds.map((roleId) => `<@&${roleId}>`),
      content,
    ].join("\n"),
    allowedMentions: { parse: [], roles: roleIds },
  };
}

export function parseRelayThreadId(value: string): string | null {
  const trimmed = value.trim();
  const mention = trimmed.match(/^<#(\d+)>$/);
  if (mention) {
    return mention[1] ?? null;
  }
  const url = trimmed.match(/^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/\d+\/(\d+)(?:\/\d+)?\/?$/i);
  if (url) {
    return url[1] ?? null;
  }
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

export function relayThreadAutocompleteChoices(
  candidates: RelayThreadChoiceCandidate[],
  query: string,
  locale: ConnectorLocale = "ko",
): Array<{ name: string; value: string }> {
  const text = relayLocaleText(locale);
  const terms = query.normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()]
    .filter((candidate) => {
      const searchable = `${candidate.parentName} ${candidate.name} ${candidate.id}`
        .normalize("NFKC")
        .toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    })
    .sort((left, right) => {
      if (left.archived !== right.archived) {
        return left.archived ? 1 : -1;
      }
      return BigInt(right.id) > BigInt(left.id) ? 1 : -1;
    })
    .slice(0, THREAD_AUTOCOMPLETE_LIMIT)
    .map((candidate) => ({
      name: `${candidate.parentName} / ${candidate.name}${candidate.archived ? ` (${text.archived})` : ""}`.slice(0, 100),
      value: candidate.id,
    }));
}

async function fetchRelayThreadCandidates(parent: GuildBasedChannel): Promise<RelayThreadChoiceCandidate[]> {
  if (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildAnnouncement) {
    return [];
  }

  const emptyThreads = { threads: new Map<string, AnyThreadChannel>() };
  const [active, archivedPublic, archivedPrivate] = await Promise.all([
    parent.threads.fetchActive(false).catch(() => emptyThreads),
    parent.threads.fetchArchived({ type: "public", limit: 100 }, false).catch(() => emptyThreads),
    parent.threads.fetchArchived({ type: "private", limit: 100 }, false).catch(() => emptyThreads),
  ]);
  const threads = [
    ...active.threads.values(),
    ...archivedPublic.threads.values(),
    ...archivedPrivate.threads.values(),
  ];

  return threads.map((thread) => ({
    id: thread.id,
    name: thread.name,
    parentName: parent.name,
    archived: Boolean(thread.archived),
  }));
}

function interactionRoleIds(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction | ButtonInteraction,
): string[] {
  const member = interaction.member;
  if (!member) {
    return [];
  }
  if ("roles" in member && Array.isArray(member.roles)) {
    return member.roles;
  }
  if ("roles" in member && member.roles && "cache" in member.roles) {
    return [...member.roles.cache.keys()];
  }
  return [];
}

function hasOperatorRole(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction | ButtonInteraction,
  operatorRoleIds: string[],
): boolean {
  const roles = new Set(interactionRoleIds(interaction));
  return operatorRoleIds.some((roleId) => roles.has(roleId));
}

export function relayPublicMessages(content: string, files: RelayTransferFile[]): Array<{
  content: string;
  files: RelayTransferFile[];
}> {
  const chunks = splitDiscordMessageContent(content, MAX_PROMPT_CONTENT);
  const visibleChunks = chunks.length > 0 ? chunks : [""];

  return visibleChunks.map((chunk, index) => ({
    content: chunk,
    files: index === visibleChunks.length - 1
      ? files.slice(0, MAX_RELAY_FILES)
      : [],
  }));
}

function statusLabel(status: RelayConversation["status"], locale: ConnectorLocale = "ko"): string {
  return relayLocaleText(locale).status[status];
}

function conversationSummary(conversation: RelayConversation, locale: ConnectorLocale = "ko"): string {
  const text = relayLocaleText(locale);
  return [
    `${text.conversationId}: \`${conversation.id}\``,
    `A: <#${conversation.originThreadId}>`,
    `B: <#${conversation.peerThreadId}>`,
    `${text.state}: **${statusLabel(conversation.status, locale)}**`,
    `${text.progress}: ${text.roundTrip} ${Math.ceil(conversation.turnCount / 2)}/${conversation.maxRounds} · agent turn ${conversation.turnCount}/${conversation.maxRounds * 2}`,
    `${text.lastAgent}: ${conversation.lastAgentLabel ?? text.noneYet}`,
    conversation.statusDetail ? `${text.details}: ${conversation.statusDetail}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

async function fetchAttachmentBuffer(url: string, expectedSize: number): Promise<Buffer> {
  if (expectedSize > MAX_RELAY_FILE_BYTES) {
    throw new Error(`Relay attachment exceeds ${MAX_RELAY_FILE_BYTES} bytes.`);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Relay attachment download failed with HTTP ${response.status}.`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength > MAX_RELAY_FILE_BYTES) {
    throw new Error(`Relay attachment exceeds ${MAX_RELAY_FILE_BYTES} bytes.`);
  }
  return data;
}

async function parseResultAttachment(message: Message): Promise<AgentRelayTurnResult> {
  const attachment = [...message.attachments.values()].find((candidate) =>
    candidate.name === "agent-relay-result.json");
  if (!attachment) {
    throw new Error("Relay result metadata attachment is missing.");
  }
  const data = await fetchAttachmentBuffer(attachment.url, attachment.size);
  return agentRelayTurnResultSchema.parse(JSON.parse(data.toString("utf8")));
}

async function collectRelayFiles(input: {
  controlMessage: Message;
  requestMessageId: string;
  connectorBotUserIds: Set<string>;
}): Promise<RelayTransferFile[]> {
  const channel = input.controlMessage.channel;
  if (!channel.isTextBased() || !("messages" in channel)) {
    return [];
  }
  const history = await channel.messages.fetch({ limit: 100, around: input.controlMessage.id });
  const attachmentRecords = [...history.values()]
    .filter((message) => input.connectorBotUserIds.has(message.author.id))
    .filter((message) => parseAgentRelayFilesMarker(message.content)?.requestMessageId === input.requestMessageId)
    .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
    .flatMap((message) => [...message.attachments.values()])
    .slice(0, MAX_RELAY_TRANSFER_FILES);
  const files: RelayTransferFile[] = [];

  for (const attachment of attachmentRecords) {
    try {
      files.push({
        name: attachment.name || "relay-file",
        data: await fetchAttachmentBuffer(attachment.url, attachment.size),
        contentType: attachment.contentType,
      });
    } catch (error) {
      console.warn(`relay-bot skipped attachment ${attachment.name}`, error);
    }
  }
  return files;
}

async function processControlResult(input: {
  message: Message;
  coordinator: RelayCoordinator;
  connectorBotUserIds: Set<string>;
}): Promise<void> {
  if (!input.connectorBotUserIds.has(input.message.author.id)) {
    return;
  }
  const requestMessageId = parseAgentRelayResultMarker(input.message.content);
  if (!requestMessageId) {
    return;
  }

  const result = await parseResultAttachment(input.message);
  if (result.requestMessageId !== requestMessageId) {
    throw new Error("Relay result marker and attachment request IDs do not match.");
  }
  const files = await collectRelayFiles({
    controlMessage: input.message,
    requestMessageId,
    connectorBotUserIds: input.connectorBotUserIds,
  });
  await input.coordinator.handleTurnResult(result, files);
}

export async function startRelayBot(): Promise<void> {
  const config = await loadRelayBotConfig();
  const locale = config.locale;
  const text = relayLocaleText(locale);
  const token = config.token;
  const guildId = config.guildId;
  const controlChannelId = config.controlChannelId;
  const releaseChannelId = config.releaseChannelId?.trim() || null;
  const operatorRoleIds = config.operatorRoleIds;
  const connectorBotUserIds = new Set(config.connectorBotUserIds);
  const store = createRelayConversationStore(config.stateRoot);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
  const connectorDiscoveries = new Map<string, ConnectorPresence[]>();
  const activeReleaseDeployments = new Set<string>();
  const publishedReleaseActions = new Set<string>();

  async function controlChannel() {
    const channel = await client.channels.fetch(controlChannelId);
    if (!channel?.isTextBased() || !("send" in channel)) {
      throw new Error(`Discord control channel is unavailable: ${controlChannelId}`);
    }
    return channel;
  }

  async function discoverConnectorTargets() {
    const discoveryId = randomUUID();
    const presences: ConnectorPresence[] = [];
    connectorDiscoveries.set(discoveryId, presences);

    try {
      const channel = await controlChannel();
      await channel.send({
        content: formatConnectorDiscoveryMarker(discoveryId),
        allowedMentions: { parse: [] },
      });
      await new Promise((resolve) => setTimeout(resolve, CONNECTOR_DISCOVERY_WAIT_MS));
      return selectConnectorUpdateTargets(presences);
    } finally {
      connectorDiscoveries.delete(discoveryId);
    }
  }

  async function dispatchReleaseUpdate(
    release: ReleaseMetadata,
    target: ReturnType<typeof selectConnectorUpdateTargets>[number],
  ): Promise<void> {
    const channel = await controlChannel();
    await channel.send({
      content: formatAgentRelayRequestMarker(target.channelId),
      allowedMentions: { parse: [] },
      files: [{
        attachment: Buffer.from(buildReleaseUpdatePrompt(release, target), "utf8"),
        name: AGENT_RELAY_PROMPT_ATTACHMENT_NAME,
      }],
    });
  }

  async function publishReleaseAction(message: Message): Promise<void> {
    if (!releaseChannelId || message.channelId !== releaseChannelId || !message.webhookId) {
      return;
    }
    const release = message.embeds
      .map((embed) => parseReleaseFooter(embed.footer?.text))
      .find((candidate): candidate is ReleaseMetadata => Boolean(candidate));
    if (!release) {
      return;
    }

    const releaseKey = `${release.version}:${release.sha}`;
    if (publishedReleaseActions.has(releaseKey)) {
      return;
    }
    publishedReleaseActions.add(releaseKey);

    try {
      const buttonId = releaseUpdateButtonId(release);
      if (message.channel.isTextBased() && "messages" in message.channel) {
        const history = await message.channel.messages.fetch({ limit: 100 });
        const alreadyPublished = [...history.values()].some((candidate) =>
          candidate.components.some((row) =>
            "components" in row &&
            row.components.some((component) =>
              "customId" in component && component.customId === buttonId)));
        if (alreadyPublished) {
          return;
        }
      }

      await message.reply({
        ...releaseUpdateNotice(text.releaseUpdateAvailable, operatorRoleIds),
        components: releaseUpdateActionRows(release, false, locale),
      });
    } catch (error) {
      publishedReleaseActions.delete(releaseKey);
      throw error;
    }
  }

  const coordinator = createRelayCoordinator({
    store,
    transport: {
      async sendPrompt(input) {
        const channel = await client.channels.fetch(input.threadId);
        if (!channel?.isTextBased() || !("send" in channel)) {
          throw new Error(`Discord thread cannot receive relay messages: ${input.threadId}`);
        }
        if (channel.isThread() && channel.archived) {
          await channel.setArchived(false, "Agent relay turn delivery");
        }

        if (input.publicContent) {
          for (const visible of relayPublicMessages(input.publicContent, input.files)) {
            await channel.send({
              content: visible.content,
              allowedMentions: { parse: [] },
              files: visible.files.map((file) => ({ attachment: file.data, name: file.name })),
            });
          }
        }

        const controlChannel = await client.channels.fetch(controlChannelId);
        if (!controlChannel?.isTextBased() || !("send" in controlChannel)) {
          throw new Error(`Discord control channel cannot receive relay requests: ${controlChannelId}`);
        }
        const message = await controlChannel.send({
          content: formatAgentRelayRequestMarker(input.threadId),
          allowedMentions: { parse: [] },
          files: [
            {
              attachment: Buffer.from(input.prompt, "utf8"),
              name: AGENT_RELAY_PROMPT_ATTACHMENT_NAME,
            },
            ...input.files.slice(0, MAX_RELAY_TRANSFER_FILES).map((file) => ({
              attachment: file.data,
              name: file.name,
            })),
          ],
        });
        return { messageId: message.id };
      },
      async cancelPrompt(input) {
        const controlChannel = await client.channels.fetch(controlChannelId);
        if (!controlChannel?.isTextBased() || !("send" in controlChannel)) {
          throw new Error(`Discord control channel cannot receive relay cancellation: ${controlChannelId}`);
        }
        await controlChannel.send({
          content: formatAgentRelayCancelMarker(input.threadId, input.requestMessageId),
          allowedMentions: { parse: [] },
        });
      },
      async publishState(input) {
        const controlChannel = await client.channels.fetch(controlChannelId);
        if (!controlChannel?.isTextBased() || !("send" in controlChannel)) {
          throw new Error(`Discord control channel cannot receive relay state: ${controlChannelId}`);
        }
        await controlChannel.send({
          content: formatAgentRelayStateMarker({
            conversationId: input.conversation.id,
            status: input.activeThreadId ? "active" : "ended",
            originThreadId: input.conversation.originThreadId,
            peerThreadId: input.conversation.peerThreadId,
            activeThreadId: input.activeThreadId,
            expiresAtMs: input.activeThreadId
              ? Date.parse(input.conversation.timeoutAt)
              : 0,
          }),
          allowedMentions: { parse: [] },
        });
      },
      async sendFinalNotice({ threadId, conversation }) {
        const channel = await client.channels.fetch(threadId);
        if (!channel?.isTextBased() || !("send" in channel)) {
          throw new Error(`Discord thread cannot receive relay completion: ${threadId}`);
        }
        if (channel.isThread() && channel.archived) {
          await channel.setArchived(false, "Agent relay completion delivery");
        }
        const summary = conversation.lastResponse.trim() || text.noFinalText;
        const truncatedSummary = summary.slice(0, 3_900);
        const files = summary.length > truncatedSummary.length
          ? [{ attachment: Buffer.from(summary, "utf8"), name: "agent-relay-final.txt" }]
          : [];
        await channel.send({
          content: [
            ...conversation.operatorRoleIds.map((roleId) => `<@&${roleId}>`),
            `**${text.conversation} ${statusLabel(conversation.status, locale)}**`,
          ].join("\n"),
          allowedMentions: { parse: [], roles: conversation.operatorRoleIds },
          embeds: [{
            title: text.finalNoticeTitle,
            color: conversation.status === "completed" ? 0x2ecc71 : 0xf1c40f,
            description: truncatedSummary,
            fields: [
              { name: text.conversation, value: `A <#${conversation.originThreadId}> ↔ B <#${conversation.peerThreadId}>` },
              {
                name: text.progress,
                value: `${text.roundTrip} ${Math.ceil(conversation.turnCount / 2)}/${conversation.maxRounds} · agent turn ${conversation.turnCount}/${conversation.maxRounds * 2}`,
              },
              { name: text.endReason, value: conversation.statusDetail ?? statusLabel(conversation.status, locale) },
            ],
          }],
          components: conversation.status === "extension-requested"
            ? relayExtensionActionRows(conversation.id, false, locale)
            : [],
          files,
        });
      },
    },
  });
  let controlResultQueue: Promise<void> = Promise.resolve();
  const threadChoiceCache = new Map<string, {
    expiresAt: number;
    candidates: RelayThreadChoiceCandidate[];
  }>();

  function invalidateThreadChoices(parentId: string | null | undefined): void {
    if (parentId) {
      threadChoiceCache.delete(parentId);
    }
  }

  client.on(Events.ThreadCreate, (thread) => {
    invalidateThreadChoices(thread.parentId);
  });
  client.on(Events.ThreadDelete, (thread) => {
    invalidateThreadChoices(thread.parentId);
  });
  client.on(Events.ThreadUpdate, (previous, current) => {
    invalidateThreadChoices(previous.parentId);
    invalidateThreadChoices(current.parentId);
  });

  function enqueueControlResult(message: Message): Promise<void> {
    const next = controlResultQueue.then(() => processControlResult({
      message,
      coordinator,
      connectorBotUserIds,
    }));
    controlResultQueue = next.catch(() => undefined);
    return next;
  }

  async function rejectUnauthorized(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
  ): Promise<boolean> {
    if (interaction.guildId !== guildId || !hasOperatorRole(interaction, operatorRoleIds)) {
      await interaction.reply({ content: text.unauthorized, ephemeral: true });
      return true;
    }
    return false;
  }

  client.on("interactionCreate", (interaction) => {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName !== "agent-chat") {
        return;
      }
      void (async () => {
        if (interaction.guildId !== guildId || !hasOperatorRole(interaction, operatorRoleIds)) {
          await interaction.respond([]);
          return;
        }
        const parentOption = interaction.options.get("parent");
        const parentId = typeof parentOption?.value === "string" ? parentOption.value : null;
        if (!parentId || !interaction.guild) {
          await interaction.respond([]);
          return;
        }

        let cached = threadChoiceCache.get(parentId);
        if (!cached || cached.expiresAt <= Date.now()) {
          const parent = await interaction.guild.channels.fetch(parentId);
          cached = {
            expiresAt: Date.now() + THREAD_CACHE_TTL_MS,
            candidates: parent ? await fetchRelayThreadCandidates(parent) : [],
          };
          threadChoiceCache.set(parentId, cached);
        }
        await interaction.respond(relayThreadAutocompleteChoices(
          cached.candidates,
          interaction.options.getFocused(),
          locale,
        ));
      })().catch(async (error) => {
        console.error("relay-bot thread autocomplete failed", error);
        await interaction.respond([]).catch(() => undefined);
      });
      return;
    }

    if (interaction.isButton()) {
      const conversationId = parseRelayExtensionButtonId(interaction.customId);
      const rejectionConversationId = parseRelayExtensionRejectButtonId(interaction.customId);
      const releaseUpdate = parseReleaseUpdateButtonId(interaction.customId);
      if (!conversationId && !rejectionConversationId && !releaseUpdate) {
        return;
      }
      if (releaseUpdate) {
        void (async () => {
          if (await rejectUnauthorized(interaction)) {
            return;
          }
          const releaseKey = `${releaseUpdate.version}:${releaseUpdate.sha}`;
          if (activeReleaseDeployments.has(releaseKey)) {
            await interaction.reply({
              content: text.releaseUpdateAlreadyStarted,
              ephemeral: true,
            });
            return;
          }

          activeReleaseDeployments.add(releaseKey);
          await interaction.deferReply({ ephemeral: true });
          await interaction.message.edit({
            components: releaseUpdateActionRows(releaseUpdate, true, locale),
          });

          try {
            const targets = await discoverConnectorTargets();
            if (targets.length === 0) {
              activeReleaseDeployments.delete(releaseKey);
              await interaction.message.edit({
                components: releaseUpdateActionRows(releaseUpdate, false, locale),
              }).catch(() => undefined);
              await interaction.editReply(text.releaseUpdateNoTargets);
              return;
            }

            const dispatches = await Promise.allSettled(
              targets.map((target) => dispatchReleaseUpdate(releaseUpdate, target)),
            );
            const delivered = targets.filter((_, index) => dispatches[index]?.status === "fulfilled");
            const failed = targets.filter((_, index) => dispatches[index]?.status === "rejected");

            if (delivered.length === 0) {
              activeReleaseDeployments.delete(releaseKey);
              await interaction.message.edit({
                components: releaseUpdateActionRows(releaseUpdate, false, locale),
              }).catch(() => undefined);
            }

            await interaction.editReply([
              `${text.releaseUpdateStarted} (${delivered.length}/${targets.length})`,
              ...delivered.map((target) =>
                `- ${target.computerDisplayName} · ${target.agent === "claude" ? "Claude Code" : "Codex"} · <#${target.channelId}> · v${target.connectorVersion}`),
              ...failed.map((target) =>
                `- FAILED · ${target.computerDisplayName} · <#${target.channelId}>`),
            ].join("\n"));
          } catch (error) {
            activeReleaseDeployments.delete(releaseKey);
            await interaction.message.edit({
              components: releaseUpdateActionRows(releaseUpdate, false, locale),
            }).catch(() => undefined);
            throw error;
          }
        })().catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error("relay-bot release update interaction failed", error);
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply(`${text.releaseUpdateFailed}: ${message}`).catch(() => undefined);
          } else {
            await interaction.reply({
              content: `${text.releaseUpdateFailed}: ${message}`,
              ephemeral: true,
            }).catch(() => undefined);
          }
        });
        return;
      }
      void (async () => {
        if (await rejectUnauthorized(interaction)) {
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const targetConversationId = conversationId ?? rejectionConversationId!;
        const conversation = conversationId
          ? await coordinator.grantExtension(conversationId, 1)
          : await coordinator.rejectExtension(targetConversationId);
        await interaction.message.edit({
          components: relayExtensionActionRows(targetConversationId, true, locale),
        }).catch(() => undefined);
        await interaction.editReply(conversationId
          ? [
              text.extensionGranted,
              conversationSummary(conversation, locale),
            ].join("\n")
          : [
              text.extensionRejected,
              conversationSummary(conversation, locale),
            ].join("\n"));
      })().catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("relay-bot extension interaction failed", error);
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(`${text.extensionFailed}: ${message}`).catch(() => undefined);
        } else {
          await interaction.reply({
            content: `${text.extensionFailed}: ${message}`,
            ephemeral: true,
          }).catch(() => undefined);
        }
      });
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }
    void (async () => {
      if (await rejectUnauthorized(interaction)) {
        return;
      }
      await interaction.deferReply();

      if (interaction.commandName === "agent-chat") {
        const parent = interaction.options.getChannel("parent", true);
        const peerId = parseRelayThreadId(interaction.options.getString("peer", true));
        const goal = interaction.options.getString("goal", true).trim();
        const maxRounds = interaction.options.getInteger("max_rounds") ?? DEFAULT_MAX_ROUNDS;
        const timeoutMinutes = interaction.options.getInteger("timeout_minutes") ?? DEFAULT_TIMEOUT_MINUTES;
        if (!goal) {
          throw new Error(text.goalRequired);
        }
        if (!peerId) {
          throw new Error(text.peerRequired);
        }
        const peer = await client.channels.fetch(peerId);
        if (
          !interaction.channel?.isThread() ||
          !peer ||
          !peer.isThread() ||
          peer.parentId !== parent.id
        ) {
          throw new Error(text.distinctThreadsRequired);
        }
        const conversation = await coordinator.start({
          guildId,
          originThreadId: interaction.channelId,
          peerThreadId: peer.id,
          operatorUserId: interaction.user.id,
          operatorRoleIds,
          goal,
          maxRounds,
          timeoutMs: timeoutMinutes * 60_000,
        });
        await interaction.editReply({
          content: [
            text.conversationStarted,
            conversationSummary(conversation, locale),
            "",
            text.stopHint,
          ].join("\n"),
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (interaction.commandName === "agent-chat-stop") {
        const conversation = await coordinator.stop(interaction.channelId);
        await interaction.editReply(conversation
          ? `${text.conversationStopped}\n${conversationSummary(conversation, locale)}`
          : text.noActiveConversation);
        return;
      }

      const conversation = await coordinator.status(interaction.channelId);
      await interaction.editReply(conversation
        ? conversationSummary(conversation, locale)
        : text.noActiveConversation);
    })().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("relay-bot interaction failed", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`${text.commandFailed}: ${message}`).catch(() => undefined);
      } else {
        await interaction.reply({ content: `${text.commandFailed}: ${message}`, ephemeral: true }).catch(() => undefined);
      }
    });
  });

  client.on("messageCreate", (message) => {
    if (message.channelId === controlChannelId && connectorBotUserIds.has(message.author.id)) {
      const presence = parseConnectorPresenceMarker(message.content);
      if (presence) {
        connectorDiscoveries.get(presence.discoveryId)?.push(presence);
        return;
      }
      void enqueueControlResult(message).catch((error) => {
        console.error("relay-bot failed to process a connector result", error);
      });
    }
    if (releaseChannelId && message.channelId === releaseChannelId && message.webhookId) {
      void publishReleaseAction(message).catch((error) => {
        console.error("relay-bot failed to publish release update action", error);
      });
    }
  });

  client.once(Events.ClientReady, () => {
    void (async () => {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(relayCommands(locale));
      console.info(`Agent relay bot ready as ${client.user?.tag ?? "unknown"}`);
      await coordinator.republishActiveStates();

      if (releaseChannelId) {
        const releaseChannel = await client.channels.fetch(releaseChannelId);
        if (releaseChannel?.isTextBased() && "messages" in releaseChannel) {
          const releaseMessages = await releaseChannel.messages.fetch({ limit: 50 });
          const webhookMessages = [...releaseMessages.values()]
            .filter((message) => Boolean(message.webhookId))
            .sort((left, right) => left.createdTimestamp - right.createdTimestamp);
          for (const message of webhookMessages) {
            await publishReleaseAction(message);
          }
        }
      }

      const controlChannel = await client.channels.fetch(controlChannelId);
      if (controlChannel?.isTextBased() && "messages" in controlChannel) {
        const pendingRequestIds = new Set((await store.list())
          .filter((conversation) => conversation.status === "running")
          .map((conversation) => conversation.pendingRequestMessageId)
          .filter((requestId): requestId is string => Boolean(requestId)));
        const results: Message[] = [];
        let before: string | undefined;

        for (let page = 0; page < 10 && pendingRequestIds.size > 0; page += 1) {
          const history = await controlChannel.messages.fetch({
            limit: 100,
            ...(before ? { before } : {}),
          });
          if (history.size === 0) {
            break;
          }
          for (const message of history.values()) {
            const requestId = parseAgentRelayResultMarker(message.content);
            if (requestId && pendingRequestIds.delete(requestId)) {
              results.push(message);
            }
          }
          before = [...history.values()]
            .sort((left, right) => left.createdTimestamp - right.createdTimestamp)[0]?.id;
          if (!before || history.size < 100) {
            break;
          }
        }

        results.sort((left, right) => left.createdTimestamp - right.createdTimestamp);
        for (const message of results) {
          await enqueueControlResult(message);
        }
      }
      await coordinator.redeliverPendingFinalNotices();
    })().catch((error) => console.error("relay-bot ready initialization failed", error));
  });

  const timeoutTimer = setInterval(() => {
    void (async () => {
      await coordinator.expireTimedOut();
      await coordinator.redeliverPendingFinalNotices();
    })().catch((error) => console.error("relay-bot maintenance scan failed", error));
  }, 60_000);
  timeoutTimer.unref();

  await client.login(token);
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  await startRelayBot();
}
