import { pathToFileURL } from "node:url";

import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import {
  agentRelayTurnResultSchema,
  parseAgentRelayFilesMarker,
  parseAgentRelayResultMarker,
  type AgentRelayTurnResult,
} from "../../../packages/core/src/index.js";
import {
  createRelayCoordinator,
  type RelayCoordinator,
  type RelayTransferFile,
} from "./coordinator.js";
import { loadRelayBotConfig } from "./config.js";
import { createRelayConversationStore, type RelayConversation } from "./store.js";

const MAX_RELAY_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RELAY_FILES = 10;
const MAX_RELAY_TRANSFER_FILES = MAX_RELAY_FILES - 1;
const MAX_PROMPT_CONTENT = 1_850;
const DEFAULT_MAX_ROUNDS = 6;
const DEFAULT_TIMEOUT_MINUTES = 120;

const RELAY_COMMANDS = [
  {
    name: "agent-chat",
    description: "현재 agent thread와 다른 agent thread 사이의 relay 대화를 시작합니다.",
    options: [
      {
        type: 7,
        name: "peer",
        description: "대화할 상대 agent thread",
        required: true,
        channel_types: [ChannelType.PublicThread, ChannelType.PrivateThread],
      },
      {
        type: 3,
        name: "goal",
        description: "두 agent가 논의하고 합의할 목표",
        required: true,
      },
      {
        type: 4,
        name: "max_rounds",
        description: "최대 왕복 라운드 수",
        min_value: 1,
        max_value: 20,
      },
      {
        type: 4,
        name: "timeout_minutes",
        description: "전체 대화 제한 시간(분)",
        min_value: 5,
        max_value: 720,
      },
    ],
  },
  {
    name: "agent-chat-status",
    description: "현재 thread의 agent relay 대화 상태를 확인합니다.",
  },
  {
    name: "agent-chat-stop",
    description: "현재 thread가 참여 중인 agent relay 대화를 중지합니다.",
  },
] as const;

function interactionRoleIds(interaction: ChatInputCommandInteraction): string[] {
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

function hasOperatorRole(interaction: ChatInputCommandInteraction, operatorRoleIds: string[]): boolean {
  const roles = new Set(interactionRoleIds(interaction));
  return operatorRoleIds.some((roleId) => roles.has(roleId));
}

function isThreadChannelType(type: ChannelType): boolean {
  return type === ChannelType.PublicThread ||
    type === ChannelType.PrivateThread ||
    type === ChannelType.AnnouncementThread;
}

function fitPrompt(content: string, files: RelayTransferFile[]): {
  content: string;
  files: RelayTransferFile[];
} {
  if (content.length <= MAX_PROMPT_CONTENT) {
    return { content, files: files.slice(0, MAX_RELAY_FILES) };
  }

  const transcript: RelayTransferFile = {
    name: "agent-relay-message.txt",
    data: Buffer.from(content, "utf8"),
    contentType: "text/plain; charset=utf-8",
  };
  return {
    content: [
      content.slice(0, 1_250),
      "",
      "전체 relay 메시지는 첨부된 agent-relay-message.txt에서 확인하세요.",
    ].join("\n"),
    files: [transcript, ...files].slice(0, MAX_RELAY_FILES),
  };
}

function statusLabel(status: RelayConversation["status"]): string {
  const labels: Record<RelayConversation["status"], string> = {
    running: "진행 중",
    completed: "합의 완료",
    "max-rounds": "최대 라운드 도달",
    blocked: "사용자 확인 필요",
    failed: "실패",
    stopped: "사용자 중지",
    "timed-out": "시간 초과",
  };
  return labels[status];
}

function conversationSummary(conversation: RelayConversation): string {
  return [
    `대화 ID: \`${conversation.id}\``,
    `A: <#${conversation.originThreadId}>`,
    `B: <#${conversation.peerThreadId}>`,
    `상태: **${statusLabel(conversation.status)}**`,
    `진행: ${Math.ceil(conversation.turnCount / 2)}/${conversation.maxRounds} 라운드 (${conversation.turnCount} turns)`,
    `마지막 agent: ${conversation.lastAgentLabel ?? "아직 없음"}`,
    conversation.statusDetail ? `상세: ${conversation.statusDetail}` : null,
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
  const token = config.token;
  const guildId = config.guildId;
  const controlChannelId = config.controlChannelId;
  const operatorRoleIds = config.operatorRoleIds;
  const connectorBotUserIds = new Set(config.connectorBotUserIds);
  const store = createRelayConversationStore(config.stateRoot);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  const coordinator = createRelayCoordinator({
    store,
    transport: {
      async sendPrompt(input) {
        const channel = await client.channels.fetch(input.threadId);
        if (!channel?.isTextBased() || !("send" in channel)) {
          throw new Error(`Discord thread cannot receive relay messages: ${input.threadId}`);
        }
        const fitted = fitPrompt(input.content, input.files);
        const message = await channel.send({
          content: fitted.content,
          allowedMentions: { parse: [] },
          files: fitted.files.map((file) => ({ attachment: file.data, name: file.name })),
        });
        return { messageId: message.id };
      },
      async sendFinalNotice({ threadId, conversation }) {
        const channel = await client.channels.fetch(threadId);
        if (!channel?.isTextBased() || !("send" in channel)) {
          throw new Error(`Discord thread cannot receive relay completion: ${threadId}`);
        }
        const summary = conversation.lastResponse.trim() || "최종 텍스트 답변이 없습니다.";
        const truncatedSummary = summary.slice(0, 3_900);
        const files = summary.length > truncatedSummary.length
          ? [{ attachment: Buffer.from(summary, "utf8"), name: "agent-relay-final.txt" }]
          : [];
        await channel.send({
          content: [
            ...conversation.operatorRoleIds.map((roleId) => `<@&${roleId}>`),
            `**에이전트 대화 ${statusLabel(conversation.status)}**`,
          ].join("\n"),
          allowedMentions: { parse: [], roles: conversation.operatorRoleIds },
          embeds: [{
            title: "Agent relay 결과",
            color: conversation.status === "completed" ? 0x2ecc71 : 0xf1c40f,
            description: truncatedSummary,
            fields: [
              { name: "대화", value: `A <#${conversation.originThreadId}> ↔ B <#${conversation.peerThreadId}>` },
              { name: "진행", value: `${conversation.turnCount} turns / 최대 ${conversation.maxRounds * 2}` },
              { name: "종료 사유", value: conversation.statusDetail ?? statusLabel(conversation.status) },
            ],
          }],
          files,
        });
      },
    },
  });
  let controlResultQueue: Promise<void> = Promise.resolve();

  function enqueueControlResult(message: Message): Promise<void> {
    const next = controlResultQueue.then(() => processControlResult({
      message,
      coordinator,
      connectorBotUserIds,
    }));
    controlResultQueue = next.catch(() => undefined);
    return next;
  }

  async function rejectUnauthorized(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (interaction.guildId !== guildId || !hasOperatorRole(interaction, operatorRoleIds)) {
      await interaction.reply({ content: "이 명령을 사용할 수 있는 operator role이 없습니다.", ephemeral: true });
      return true;
    }
    return false;
  }

  client.on("interactionCreate", (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    void (async () => {
      if (await rejectUnauthorized(interaction)) {
        return;
      }
      await interaction.deferReply();

      if (interaction.commandName === "agent-chat") {
        const peer = interaction.options.getChannel("peer", true);
        const goal = interaction.options.getString("goal", true).trim();
        const maxRounds = interaction.options.getInteger("max_rounds") ?? DEFAULT_MAX_ROUNDS;
        const timeoutMinutes = interaction.options.getInteger("timeout_minutes") ?? DEFAULT_TIMEOUT_MINUTES;
        if (!goal) {
          throw new Error("대화 목표가 비어 있습니다.");
        }
        if (!interaction.channel?.isThread() || !isThreadChannelType(peer.type)) {
          throw new Error("/agent-chat은 서로 다른 두 agent thread 사이에서만 시작할 수 있습니다.");
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
          content: `Agent relay 대화를 시작했습니다.\n${conversationSummary(conversation)}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (interaction.commandName === "agent-chat-stop") {
        const conversation = await coordinator.stop(interaction.channelId);
        await interaction.editReply(conversation
          ? `Agent relay 대화를 중지했습니다.\n${conversationSummary(conversation)}`
          : "현재 thread에는 실행 중인 agent relay 대화가 없습니다.");
        return;
      }

      const conversation = await coordinator.status(interaction.channelId);
      await interaction.editReply(conversation
        ? conversationSummary(conversation)
        : "현재 thread에는 실행 중인 agent relay 대화가 없습니다.");
    })().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("relay-bot interaction failed", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`Agent relay 명령이 실패했습니다: ${message}`).catch(() => undefined);
      } else {
        await interaction.reply({ content: `Agent relay 명령이 실패했습니다: ${message}`, ephemeral: true }).catch(() => undefined);
      }
    });
  });

  client.on("messageCreate", (message) => {
    if (message.channelId !== controlChannelId || !connectorBotUserIds.has(message.author.id)) {
      return;
    }
    void enqueueControlResult(message).catch((error) => {
      console.error("relay-bot failed to process a connector result", error);
    });
  });

  client.once(Events.ClientReady, () => {
    void (async () => {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(RELAY_COMMANDS);
      console.info(`Agent relay bot ready as ${client.user?.tag ?? "unknown"}`);

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
