import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_TIMEOUT_MINUTES,
  MAX_TIMEOUT_MINUTES,
  RELAY_COMMANDS,
  parseRelayExtensionButtonId,
  parseRelayExtensionRejectButtonId,
  parseRelayThreadId,
  relayPublicMessages,
  relayCommands,
  relayExtensionActionRows,
  relayThreadAutocompleteChoices,
  releaseUpdateActionRows,
  releaseUpdateNotice,
} from "./index.js";
import { relayLocaleText } from "./i18n.js";

describe("relay bot thread selection", () => {
  it("registers parent selection followed by searchable thread autocomplete", () => {
    const command = RELAY_COMMANDS.find((candidate) => candidate.name === "agent-chat");
    expect(command?.options?.slice(0, 3)).toEqual([
      expect.objectContaining({ name: "parent", type: 7, required: true }),
      expect.objectContaining({ name: "peer", type: 3, required: true, autocomplete: true }),
      expect.objectContaining({ name: "goal", type: 3, required: true }),
    ]);
    expect(command?.options?.find((option) => option.name === "max_rounds"))
      .toEqual(expect.objectContaining({ min_value: 1, max_value: 20 }));
    expect(command?.options?.find((option) => option.name === "timeout_minutes"))
      .toEqual(expect.objectContaining({ min_value: 5, max_value: 1_440 }));
    expect(DEFAULT_MAX_ROUNDS).toBe(20);
    expect(DEFAULT_TIMEOUT_MINUTES).toBe(1_200);
    expect(MAX_TIMEOUT_MINUTES).toBe(1_440);
  });

  it("builds a one-round extension button with an exact conversation ID", () => {
    const conversationId = "d90bcf0b-e471-4f9f-a2cf-c279d14d53d0";
    const customId = `agent-relay:extend:${conversationId}`;
    const rejectCustomId = `agent-relay:reject-extension:${conversationId}`;
    expect(parseRelayExtensionButtonId(customId)).toBe(conversationId);
    expect(parseRelayExtensionButtonId("agent-relay:extend:not-a-uuid")).toBeNull();
    expect(parseRelayExtensionRejectButtonId(rejectCustomId)).toBe(conversationId);
    expect(parseRelayExtensionRejectButtonId("agent-relay:reject-extension:not-a-uuid")).toBeNull();
    const components = relayExtensionActionRows(conversationId)[0]?.toJSON().components;
    expect(components).toEqual([
      expect.objectContaining({
        custom_id: customId,
        label: "왕복 1회 추가",
        disabled: false,
      }),
      expect.objectContaining({
        custom_id: rejectCustomId,
        label: "연장 거절 · 대화 종료",
        disabled: false,
      }),
    ]);
  });

  it("localizes relay commands and extension buttons for every supported locale", () => {
    const conversationId = "d90bcf0b-e471-4f9f-a2cf-c279d14d53d0";
    const expected = {
      ko: ["현재 agent thread와 다른 agent thread 사이의 relay 대화를 시작합니다.", "왕복 1회 추가", "연장 거절 · 대화 종료", "사람이 중간에 멈추려면 두 스레드 중 어느 쪽에서든 `/agent-chat-stop`을 실행하세요.", "등록 서버 업데이트"],
      en: ["Start a relay conversation between this agent thread and another agent thread.", "Add one round trip", "Reject extension and stop", "To stop it manually, run `/agent-chat-stop` in either thread.", "Update registered servers"],
      zh: ["在当前 agent 线程与另一个 agent 线程之间启动中继对话。", "增加 1 次往返", "拒绝延长并结束", "如需人工中途停止，请在任一线程中运行 `/agent-chat-stop`。", "更新已注册服务器"],
      ja: ["現在の agent スレッドと別の agent スレッドの間で relay 会話を開始します。", "往復を1回追加", "延長を拒否して終了", "途中で停止する場合は、どちらかのスレッドで `/agent-chat-stop` を実行してください。", "登録サーバーを更新"],
    } as const;

    for (const [locale, [commandDescription, extendLabel, rejectLabel, stopHint, releaseLabel]] of Object.entries(expected)) {
      expect(relayCommands(locale as keyof typeof expected)[0]?.description).toBe(commandDescription);
      expect(relayLocaleText(locale as keyof typeof expected).stopHint).toBe(stopHint);
      const components = relayExtensionActionRows(
        conversationId,
        false,
        locale as keyof typeof expected,
      )[0]?.toJSON().components;
      expect(components?.map((component) => "label" in component ? component.label : null))
        .toEqual([extendLabel, rejectLabel]);
      expect(
        releaseUpdateActionRows({
          version: "1.3.0",
          sha: "4350badd29956203dda8431663456b89ec0ff8dd",
        }, false, locale as keyof typeof expected)[0]?.toJSON().components[0],
      ).toEqual(expect.objectContaining({
        label: releaseLabel,
        disabled: false,
      }));
    }
  });

  it("mentions configured operators without replacing the release update explanation", () => {
    expect(releaseUpdateNotice("Update registered servers", [
      "1527202348584145018",
      "1527202348584145018",
    ])).toEqual({
      content: "<@&1527202348584145018>\nUpdate registered servers",
      allowedMentions: {
        parse: [],
        roles: ["1527202348584145018"],
      },
    });
  });

  it("accepts autocomplete IDs, thread mentions, and Discord links", () => {
    expect(parseRelayThreadId("123456789012345678")).toBe("123456789012345678");
    expect(parseRelayThreadId("<#123456789012345678>")).toBe("123456789012345678");
    expect(parseRelayThreadId(
      "https://discord.com/channels/111111111111111111/123456789012345678",
    )).toBe("123456789012345678");
    expect(parseRelayThreadId("not-a-thread")).toBeNull();
  });

  it("searches by parent and thread name while keeping active threads first", () => {
    const choices = relayThreadAutocompleteChoices([
      { id: "100000000000000001", name: "old-test", parentName: "gcp-dhlee", archived: true },
      { id: "100000000000000003", name: "relay-design", parentName: "mac-codex", archived: false },
      { id: "100000000000000002", name: "relay-review", parentName: "mac-codex", archived: false },
    ], "mac relay");

    expect(choices).toEqual([
      { name: "mac-codex / relay-design", value: "100000000000000003" },
      { name: "mac-codex / relay-review", value: "100000000000000002" },
    ]);
    expect(relayThreadAutocompleteChoices(
      Array.from({ length: 40 }, (_, index) => ({
        id: String(100000000000000000n + BigInt(index)),
        name: `thread-${index}`,
        parentName: "parent",
        archived: false,
      })),
      "",
    )).toHaveLength(25);
  });

  it("publishes every chunk of a long peer answer and attaches files only once", () => {
    const content = Array.from(
      { length: 100 },
      (_, index) => `Relay 공개 답변 ${index + 1}: ${"내용 ".repeat(20)}`,
    ).join("\n");
    const files = [{
      name: "result.txt",
      data: Buffer.from("result"),
      contentType: "text/plain",
    }];
    const messages = relayPublicMessages(content, files);
    const visible = messages.map((message) => message.content).join("\n");

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.content.length <= 1_850)).toBe(true);
    expect(visible).toContain("Relay 공개 답변 1:");
    expect(visible).toContain("Relay 공개 답변 50:");
    expect(visible).toContain("Relay 공개 답변 100:");
    expect(messages.slice(0, -1).every((message) => message.files.length === 0)).toBe(true);
    expect(messages.at(-1)?.files).toEqual(files);
    expect(messages.flatMap((message) => message.files).map((file) => file.name))
      .toEqual(["result.txt"]);
  });
});
