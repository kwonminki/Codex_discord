import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_TIMEOUT_MINUTES,
  MAX_TIMEOUT_MINUTES,
  RELAY_COMMANDS,
  parseRelayExtensionButtonId,
  parseRelayExtensionRejectButtonId,
  parseRelayThreadId,
  relayCommands,
  relayExtensionActionRows,
  relayThreadAutocompleteChoices,
} from "./index.js";

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
      ko: ["현재 agent thread와 다른 agent thread 사이의 relay 대화를 시작합니다.", "왕복 1회 추가", "연장 거절 · 대화 종료"],
      en: ["Start a relay conversation between this agent thread and another agent thread.", "Add one round trip", "Reject extension and stop"],
      zh: ["在当前 agent 线程与另一个 agent 线程之间启动中继对话。", "增加 1 次往返", "拒绝延长并结束"],
      ja: ["現在の agent スレッドと別の agent スレッドの間で relay 会話を開始します。", "往復を1回追加", "延長を拒否して終了"],
    } as const;

    for (const [locale, [commandDescription, extendLabel, rejectLabel]] of Object.entries(expected)) {
      expect(relayCommands(locale as keyof typeof expected)[0]?.description).toBe(commandDescription);
      const components = relayExtensionActionRows(
        conversationId,
        false,
        locale as keyof typeof expected,
      )[0]?.toJSON().components;
      expect(components?.map((component) => "label" in component ? component.label : null))
        .toEqual([extendLabel, rejectLabel]);
    }
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
});
