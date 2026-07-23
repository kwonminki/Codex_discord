import { describe, expect, it } from "vitest";

import { splitDiscordMessageContent } from "../src/index.js";

describe("Discord message splitting", () => {
  it("preserves every section while balancing fenced code blocks", () => {
    const source = [
      "first section",
      "```ts",
      ...Array.from({ length: 120 }, (_, index) => `console.log("line-${index + 1}");`),
      "```",
      "last section @operator",
    ].join("\n");
    const chunks = splitDiscordMessageContent(source, 500);
    const visible = chunks.join("\n");

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true);
    expect(visible).toContain("first section");
    expect(visible).toContain('console.log("line-60");');
    expect(visible).toContain("last section [at]operator");
    expect(chunks.every((chunk) => (chunk.match(/```/g)?.length ?? 0) % 2 === 0)).toBe(true);
  });
});
