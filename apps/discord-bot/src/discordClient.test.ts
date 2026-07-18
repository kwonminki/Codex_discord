import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  attachDiscordMessageHandler,
  attachDiscordInteractionHandler,
  createDiscordGuildSurface,
} from "./discordClient.js";
import { formatCodexProgressUpdate, formatCodexResultUpdate, formatCollapsibleThoughtMessage } from "./responses.js";

describe("attachDiscordMessageHandler", () => {
  it("adapts Discord messageCreate events into the pure message handler", async () => {
    const handlers = new Map<string, (message: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (message: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const guild = {
      channels: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: "category-1" })
          .mockResolvedValueOnce({ id: "channel-1" }),
        fetch: vi.fn().mockResolvedValue({
          delete: vi.fn().mockResolvedValue(undefined),
        }),
      },
    };

    attachDiscordMessageHandler(client, handleMessage);
    handlers.get("messageCreate")?.({
      author: { bot: false, id: "discord-user-1" },
      channelId: "discord-channel-1",
      content: "ls",
      member: {
        roles: {
          cache: new Map([
            ["role-operator", { id: "role-operator" }],
            ["role-extra", { id: "role-extra" }],
          ]),
        },
      },
      reply,
      guild,
    });

    expect(client.on).toHaveBeenCalledWith("messageCreate", expect.any(Function));
    expect(handleMessage).toHaveBeenCalledWith({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "ls",
      roleIds: ["role-operator", "role-extra"],
      guild: expect.any(Object),
      clearMessages: expect.any(Function),
      reply: expect.any(Function),
    });

    const payload = { embeds: [{ title: "pong" }] };
    const adaptedMessage = handleMessage.mock.calls[0][0] as { reply(message: unknown): Promise<unknown> };
    await adaptedMessage.reply(payload);
    expect(reply).toHaveBeenCalledWith(payload);

    const adaptedGuild = handleMessage.mock.calls[0][0].guild as {
      createCategory(input: { name: string }): Promise<{ id: string }>;
      createTextChannel(input: { name: string; parentId: string; topic?: string }): Promise<{ id: string }>;
      deleteChannel(id: string): Promise<void>;
      deleteCategory(id: string): Promise<void>;
    };
    await expect(adaptedGuild.createCategory({ name: "repo" })).resolves.toEqual({ id: "category-1" });
    await expect(
      adaptedGuild.createTextChannel({
        name: "session",
        parentId: "category-1",
        topic: "Codex session",
      }),
    ).resolves.toEqual({ id: "channel-1" });
    await expect(adaptedGuild.deleteChannel("channel-1")).resolves.toBeUndefined();
    await expect(adaptedGuild.deleteCategory("category-1")).resolves.toBeUndefined();
    expect(guild.channels.create).toHaveBeenCalledTimes(2);
    expect(guild.channels.fetch).toHaveBeenCalledWith("channel-1");
    expect(guild.channels.fetch).toHaveBeenCalledWith("category-1");
  });

  it("creates threads and allows explicit role mentions for sent messages", async () => {
    const threadCreate = vi.fn().mockResolvedValue({ id: "thread-1" });
    const send = vi.fn().mockResolvedValue({ id: "message-1" });
    const guild = {
      channels: {
        fetch: vi.fn((channelId: string) =>
          Promise.resolve(
            channelId === "admin-channel"
              ? { threads: { create: threadCreate } }
              : { send },
          ),
        ),
      },
    };
    const guildSurface = createDiscordGuildSurface(guild as never);

    await expect(
      guildSurface?.createThread?.({
        parentChannelId: "admin-channel",
        name: "session-thread",
        autoArchiveDuration: 10_080,
        reason: "Codex session",
      }),
    ).resolves.toEqual({ id: "thread-1" });
    await expect(
      guildSurface?.sendTextMessage?.("thread-1", "작업 완료", {
        mentionRoleIds: ["operator-role"],
      }),
    ).resolves.toEqual({ id: "message-1" });

    expect(threadCreate).toHaveBeenCalledWith({
      name: "session-thread",
      autoArchiveDuration: 10_080,
      reason: "Codex session",
    });
    expect(send).toHaveBeenCalledWith({
      allowedMentions: { parse: [], roles: ["operator-role"] },
      content: "<@&operator-role>\n작업 완료",
      embeds: [],
    });
  });
});

describe("attachDiscordInteractionHandler", () => {
  it("adapts Discord native slash command interactions into the pure message handler", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);

    attachDiscordInteractionHandler(client, handleMessage);
    handlers.get("interactionCreate")?.({
      isChatInputCommand: () => true,
      commandName: "compact",
      options: {
        getString: (name: string) => (name === "prompt" ? "지금까지 맥락 정리" : null),
        getInteger: () => null,
        getBoolean: () => null,
      },
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: {
        roles: {
          cache: new Map([["role-operator", { id: "role-operator" }]]),
        },
      },
      reply,
      guild: null,
    });

    expect(client.on).toHaveBeenCalledWith("interactionCreate", expect.any(Function));
    expect(handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorBot: false,
        userId: "discord-user-1",
        channelId: "discord-channel-1",
        content: "codex 지금까지의 작업 맥락을 압축 요약해줘. 지금까지 맥락 정리",
        roleIds: ["role-operator"],
      }),
    );
  });

  it("defers slash command replies before long handler work", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const sentMessage = { id: "slash-message-1", edit: vi.fn() };
    const editReply = vi.fn().mockResolvedValue(sentMessage);

    attachDiscordInteractionHandler(client, handleMessage);
    handlers.get("interactionCreate")?.({
      isChatInputCommand: () => true,
      commandName: "howtouse",
      options: {
        getString: () => null,
        getInteger: () => null,
        getBoolean: () => null,
      },
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: {
        roles: {
          cache: new Map([["role-operator", { id: "role-operator" }]]),
        },
      },
      deferReply,
      reply,
      editReply,
      fetchReply: vi.fn().mockResolvedValue(sentMessage),
      guild: null,
    });

    await vi.waitFor(() => expect(handleMessage).toHaveBeenCalled());
    expect(deferReply.mock.invocationCallOrder[0]).toBeLessThan(handleMessage.mock.invocationCallOrder[0]);

    const adaptedMessage = handleMessage.mock.calls[0][0] as { reply(message: unknown): Promise<unknown> };
    const payload = { embeds: [{ title: "Codex 작업 시작" }] };
    await adaptedMessage.reply(payload);

    expect(reply).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(payload);
  });

  it("ignores slash command interactions in unmanaged channels before deferring replies", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const isManagedChannel = vi.fn().mockResolvedValue(false);

    attachDiscordInteractionHandler(client, handleMessage, { isManagedChannel });
    handlers.get("interactionCreate")?.({
      isChatInputCommand: () => true,
      commandName: "howtouse",
      options: {
        getString: () => null,
        getInteger: () => null,
        getBoolean: () => null,
      },
      user: { id: "discord-user-1" },
      channelId: "unmanaged-channel",
      member: {
        roles: {
          cache: new Map([["role-operator", { id: "role-operator" }]]),
        },
      },
      deferReply,
      reply,
      guild: null,
    });

    await vi.waitFor(() => expect(isManagedChannel).toHaveBeenCalledWith("unmanaged-channel"));
    expect(deferReply).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it("adapts Discord button interactions into the pure message handler", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const guild = {
      channels: {
        create: vi.fn(),
        fetch: vi.fn(),
      },
    };

    attachDiscordInteractionHandler(client, handleMessage);
    handlers.get("interactionCreate")?.({
      isButton: () => true,
      customId: "cdc:sync:25",
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: {
        roles: {
          cache: new Map([["role-operator", { id: "role-operator" }]]),
        },
      },
      reply,
      guild,
    });

    expect(client.on).toHaveBeenCalledWith("interactionCreate", expect.any(Function));
    expect(handleMessage).toHaveBeenCalledWith({
      authorBot: false,
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      content: "sync select 25",
      roleIds: ["role-operator"],
      guild: expect.any(Object),
      reply: expect.any(Function),
    });

    const adaptedInteraction = handleMessage.mock.calls[0][0] as { reply(message: unknown): Promise<unknown> };
    const payload = { embeds: [{ title: "syncing" }] };
    await adaptedInteraction.reply(payload);
    expect(reply).toHaveBeenCalledWith(payload);
  });

  it("ignores button interactions in unmanaged channels before replying", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const isManagedChannel = vi.fn().mockResolvedValue(false);

    attachDiscordInteractionHandler(client, handleMessage, { isManagedChannel });
    handlers.get("interactionCreate")?.({
      isButton: () => true,
      customId: "cdc:sync:25",
      user: { id: "discord-user-1" },
      channelId: "unmanaged-channel",
      member: {
        roles: {
          cache: new Map([["role-operator", { id: "role-operator" }]]),
        },
      },
      reply,
      guild: null,
    });

    await vi.waitFor(() => expect(isManagedChannel).toHaveBeenCalledWith("unmanaged-channel"));
    expect(reply).not.toHaveBeenCalled();
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it("ignores modal submit interactions in unmanaged channels", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const isManagedChannel = vi.fn().mockResolvedValue(false);

    attachDiscordInteractionHandler(client, handleMessage, { isManagedChannel });
    handlers.get("interactionCreate")?.({
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "cdc:codex:submit",
      user: { id: "discord-user-1" },
      channelId: "unmanaged-channel",
      member: {
        roles: {
          cache: new Map([["role-operator", { id: "role-operator" }]]),
        },
      },
      reply,
      guild: null,
      fields: {
        getTextInputValue: () => "README 요약해줘",
      },
    });

    await vi.waitFor(() => expect(isManagedChannel).toHaveBeenCalledWith("unmanaged-channel"));
    expect(reply).not.toHaveBeenCalled();
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it("sends additional interaction replies through the channel", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue({ id: "followup-message-1" });

    attachDiscordInteractionHandler(client, handleMessage);
    handlers.get("interactionCreate")?.({
      isButton: () => true,
      customId: "cdc:sync:25",
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: {
        roles: {
          cache: new Map([["role-operator", { id: "role-operator" }]]),
        },
      },
      reply,
      channel: { send },
      guild: null,
    });

    const adaptedInteraction = handleMessage.mock.calls[0][0] as { reply(message: unknown): Promise<unknown> };
    const firstPayload = { embeds: [{ title: "queued" }] };
    const secondPayload = { embeds: [{ title: "approval required" }] };

    await adaptedInteraction.reply(firstPayload);
    await adaptedInteraction.reply(secondPayload);

    expect(reply).toHaveBeenCalledWith(firstPayload);
    expect(send).toHaveBeenCalledWith(secondPayload);
  });

  it("adapts Discord select menu interactions into the pure message handler", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);

    attachDiscordInteractionHandler(client, handleMessage);
    handlers.get("interactionCreate")?.({
      isButton: () => false,
      isStringSelectMenu: () => true,
      customId: "cdc:fs:open",
      values: ["docs"],
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: {
        roles: {
          cache: new Map([["role-operator", { id: "role-operator" }]]),
        },
      },
      reply,
      guild: null,
    });

    expect(handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "__cdc_exec __cdc_open docs",
        channelId: "discord-channel-1",
      }),
    );
  });

  it("shows a Codex prompt modal and dispatches submitted text", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const showModal = vi.fn().mockResolvedValue(undefined);

    attachDiscordInteractionHandler(client, handleMessage);
    handlers.get("interactionCreate")?.({
      isButton: () => true,
      customId: "cdc:codex:ask",
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: { roles: { cache: new Map([["role-operator", { id: "role-operator" }]]) } },
      guild: null,
      reply: vi.fn(),
      showModal,
    });

    expect(showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Codex에게 요청",
        custom_id: "cdc:codex:submit",
      }),
    );
    expect(handleMessage).not.toHaveBeenCalled();

    handlers.get("interactionCreate")?.({
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "cdc:codex:submit",
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: { roles: { cache: new Map([["role-operator", { id: "role-operator" }]]) } },
      guild: null,
      reply: vi.fn(),
      fields: {
        getTextInputValue: (fieldId: string) => (fieldId === "prompt" ? "README 요약해줘" : ""),
      },
    });

    expect(handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "codex README 요약해줘",
      }),
    );
  });

  it("shows a new chat modal from chat buttons and dispatches submitted details", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const showModal = vi.fn().mockResolvedValue(undefined);

    attachDiscordInteractionHandler(client, handleMessage);
    handlers.get("interactionCreate")?.({
      isButton: () => true,
      customId: "cdc:chat:new:current",
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: { roles: { cache: new Map([["role-operator", { id: "role-operator" }]]) } },
      guild: null,
      reply: vi.fn(),
      showModal,
    });

    expect(showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "현재 폴더에서 새 채팅",
        custom_id: "cdc:chat:submit:current",
      }),
    );
    expect(handleMessage).not.toHaveBeenCalled();

    handlers.get("interactionCreate")?.({
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "cdc:chat:submit:current",
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: { roles: { cache: new Map([["role-operator", { id: "role-operator" }]]) } },
      guild: null,
      reply: vi.fn(),
      fields: {
        getTextInputValue: (fieldId: string) =>
          fieldId === "name" ? "UI 점검" : fieldId === "prompt" ? "버튼 흐름을 점검해줘" : "",
      },
    });

    expect(handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "__cdc_new_chat %7B%22name%22%3A%22UI%20%EC%A0%90%EA%B2%80%22%2C%22cwd%22%3A%22.%22%2C%22useCategory%22%3Atrue%2C%22initialPrompt%22%3A%22%EB%B2%84%ED%8A%BC%20%ED%9D%90%EB%A6%84%EC%9D%84%20%EC%A0%90%EA%B2%80%ED%95%B4%EC%A4%98%22%7D",
      }),
    );
  });

  it("toggles Codex progress thoughts by updating the existing Discord message", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const sentMessage = {
      id: "message-1",
      edit: vi.fn().mockResolvedValue(undefined),
    };
    const handleMessage = vi.fn(async (message) => {
      const queued = await message.reply(
        formatCodexProgressUpdate(
          {
            computerDisplayName: "Local Dev",
            workspaceDisplayName: "CodexDiscordConnector",
            cwd: "/repo",
            prompt: "진행 보여줘",
          },
          {
            status: "파일 탐색 중",
            latestMessage: "이제 두 가지를 바로 바꾸겠습니다.",
            recentEvents: ["생각중...", "2개의 파일 탐색중..."],
          },
        ),
      );

      await queued?.edit(
        formatCodexProgressUpdate(
          {
            computerDisplayName: "Local Dev",
            workspaceDisplayName: "CodexDiscordConnector",
            cwd: "/repo",
            prompt: "진행 보여줘",
          },
          {
            status: "파일 탐색 중",
            latestMessage: "이제 두 가지를 바로 바꾸겠습니다.",
            recentEvents: ["생각중...", "2개의 파일 탐색중..."],
          },
        ),
      );
    });
    const reply = vi.fn().mockResolvedValue(sentMessage);
    const editReply = vi.fn().mockResolvedValue(sentMessage);
    const update = vi.fn().mockResolvedValue(undefined);

    attachDiscordInteractionHandler(client, handleMessage);
    handlers.get("interactionCreate")?.({
      isChatInputCommand: () => true,
      commandName: "codex",
      options: { getString: () => "진행 보여줘" },
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: { roles: { cache: new Map([["role-operator", { id: "role-operator" }]]) } },
      guild: null,
      reply,
      editReply,
      fetchReply: vi.fn().mockResolvedValue(sentMessage),
    });

    await vi.waitFor(() => expect(editReply).toHaveBeenCalled());

    handlers.get("interactionCreate")?.({
      isButton: () => true,
      customId: "cdc:codex:thoughts:open",
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: { roles: { cache: new Map() } },
      guild: null,
      message: sentMessage,
      update,
      reply: vi.fn(),
    });

    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("**생각 / 중간 출력**"),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("이제 두 가지를 바로 바꾸겠습니다."),
      }),
    );
  });

  it("preserves attachments when editing a progress message into a collapsible final answer", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-progress-attachment-"));
    const videoPath = path.join(tempRoot, "review.mp4");

    try {
      await writeFile(videoPath, "fake video");

      const handlers = new Map<string, (message: unknown) => void>();
      const client = {
        on: vi.fn((eventName: string, handler: (message: unknown) => void) => {
          handlers.set(eventName, handler);
          return client;
        }),
      };
      const sentMessage = {
        id: "message-1",
        edit: vi.fn().mockResolvedValue(undefined),
      };
      const handleMessage = vi.fn(async (message) => {
        const queued = await message.reply(
          formatCodexProgressUpdate(
            {
              computerDisplayName: "Local Dev",
              workspaceDisplayName: "CodexDiscordConnector",
              cwd: "/repo",
              prompt: "샘플 보내줘",
            },
            {
              status: "답변 작성 중",
              latestMessage: "샘플을 정리합니다.",
              recentEvents: ["생각중..."],
            },
          ),
        );

        await queued?.edit(
          formatCodexResultUpdate(
            {
              computerDisplayName: "Local Dev",
              workspaceDisplayName: "CodexDiscordConnector",
              cwd: "/repo",
              prompt: "샘플 보내줘",
            },
            {
              result: {
                status: "completed",
                finalMessage: [
                  "우선 판단 가치가 높은 샘플을 보냅니다.",
                  "",
                  "```codex-discord-send",
                  JSON.stringify({
                    message: "검토 포인트입니다.",
                    files: [{ path: videoPath, name: "review.mp4" }],
                  }),
                  "```",
                ].join("\n"),
                sessionId: "session-1",
              },
            },
            { recentEvents: ["생각중..."] },
          ),
        );
      });
      const reply = vi.fn().mockResolvedValue(sentMessage);

      attachDiscordMessageHandler(client, handleMessage);
      handlers.get("messageCreate")?.({
        author: { bot: false, id: "discord-user-1" },
        channelId: "discord-channel-1",
        content: "샘플 보내줘",
        member: { roles: { cache: new Map([["role-operator", { id: "role-operator" }]]) } },
        reply,
        guild: null,
      });

      await vi.waitFor(() => expect(sentMessage.edit).toHaveBeenCalled());
      expect(sentMessage.edit).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("우선 판단 가치가 높은 샘플을 보냅니다."),
          files: [{ attachment: videoPath, name: "review.mp4" }],
        }),
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("toggles desktop-synced thought messages sent directly to a channel", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const sentMessage = {
      id: "synced-thought-1",
      edit: vi.fn().mockResolvedValue(undefined),
    };
    const send = vi.fn().mockResolvedValue(sentMessage);
    const guild = {
      channels: {
        fetch: vi.fn().mockResolvedValue({ send }),
      },
    };
    const update = vi.fn().mockResolvedValue(undefined);

    attachDiscordInteractionHandler(client, vi.fn());

    const guildSurface = createDiscordGuildSurface(guild as never);

    if (!guildSurface?.sendTextMessage) {
      throw new Error("Guild surface did not expose sendTextMessage");
    }

    await guildSurface.sendTextMessage(
      "channel-1",
      formatCollapsibleThoughtMessage({
        collapsedContent: "> 생각중...",
        expandedContent: "> 파일 탐색 중 · rg --files",
      }),
    );

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "> 생각중...",
      }),
    );

    handlers.get("interactionCreate")?.({
      isButton: () => true,
      customId: "cdc:codex:thoughts:open",
      user: { id: "discord-user-1" },
      channelId: "channel-1",
      member: { roles: { cache: new Map() } },
      guild: null,
      message: sentMessage,
      update,
      reply: vi.fn(),
    });

    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "> 파일 탐색 중 · rg --files",
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [
          {
            type: 1,
            components: [
              { type: 2, custom_id: "cdc:codex:thoughts:close", label: "생각 닫기", style: 2 },
              { type: 2, custom_id: "cdc:codex:thoughts:send-process", label: "과정 보내기", style: 2 },
            ],
          },
        ],
      }),
    );
  });

  it("sends the visible process as a separate truncated message", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const sentMessage = {
      id: "process-message-1",
      edit: vi.fn().mockResolvedValue(undefined),
    };
    const send = vi.fn().mockResolvedValue(sentMessage);
    const guild = {
      channels: {
        fetch: vi.fn().mockResolvedValue({ send }),
      },
    };
    const reply = vi.fn().mockResolvedValue(undefined);

    attachDiscordInteractionHandler(client, vi.fn());

    const guildSurface = createDiscordGuildSurface(guild as never);

    if (!guildSurface?.sendTextMessage) {
      throw new Error("Guild surface did not expose sendTextMessage");
    }

    await guildSurface.sendTextMessage(
      "channel-1",
      formatCollapsibleThoughtMessage({
        collapsedContent: "최종 답변입니다.\n\n_생각과 중간 출력은 버튼으로 열 수 있습니다._",
        expandedContent: [
          "최종 답변입니다.",
          "",
          "**생각 / 중간 출력**",
          "파일 탐색 중",
          "x".repeat(2_100),
        ].join("\n"),
      }),
    );

    handlers.get("interactionCreate")?.({
      isButton: () => true,
      customId: "cdc:codex:thoughts:send-process",
      user: { id: "discord-user-1" },
      channelId: "channel-1",
      member: { roles: { cache: new Map() } },
      guild: null,
      message: sentMessage,
      reply,
    });

    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("**생각 / 중간 출력**"),
      }),
    );
    const payload = reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toContain("파일 탐색 중");
    expect(payload.content).not.toContain("최종 답변입니다.");
    expect(payload.content).toContain("... (일부만 표시)");
    expect(payload.content.length).toBeLessThanOrEqual(1_900);
  });

  it("acknowledges unknown buttons without dispatching a command", async () => {
    const handlers = new Map<string, (interaction: unknown) => void>();
    const client = {
      on: vi.fn((eventName: string, handler: (interaction: unknown) => void) => {
        handlers.set(eventName, handler);
        return client;
      }),
    };
    const handleMessage = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);

    attachDiscordInteractionHandler(client, handleMessage);
    handlers.get("interactionCreate")?.({
      isButton: () => true,
      customId: "unknown",
      user: { id: "discord-user-1" },
      channelId: "discord-channel-1",
      member: { roles: { cache: new Map() } },
      reply,
      guild: null,
    });

    expect(handleMessage).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith({
      allowedMentions: { parse: [] },
      ephemeral: true,
      content: "이 버튼은 더 이상 사용할 수 없습니다. `help`를 다시 눌러 최신 버튼을 열어주세요.",
    });
  });
});
