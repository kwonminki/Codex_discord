import { describe, expect, it } from "vitest";

import {
  RELAY_COMMANDS,
  parseRelayThreadId,
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
