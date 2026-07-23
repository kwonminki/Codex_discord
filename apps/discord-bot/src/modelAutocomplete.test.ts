import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadCodexModelChoices,
  modelAutocompleteChoices,
} from "./modelAutocomplete.js";

describe("model autocomplete", () => {
  it("loads visible Codex models from the local Codex cache", async () => {
    const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-models-"));

    try {
      await writeFile(path.join(codexHome, "models_cache.json"), JSON.stringify({
        models: [
          { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list" },
          { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide" },
          { slug: "gpt-5.4-mini", display_name: "GPT-5.4-Mini", visibility: "list" },
        ],
      }));

      await expect(loadCodexModelChoices(codexHome)).resolves.toEqual([
        { name: "GPT-5.6-Sol", value: "gpt-5.6-sol" },
        { name: "GPT-5.4-Mini", value: "gpt-5.4-mini" },
      ]);
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  });

  it("offers context-specific models while retaining default and the current custom model", () => {
    expect(modelAutocompleteChoices({
      agent: "codex",
      query: "5.6",
      currentModel: "custom-codex",
      codexModels: [
        { name: "GPT-5.6-Sol", value: "gpt-5.6-sol" },
        { name: "GPT-5.4", value: "gpt-5.4" },
      ],
    })).toEqual([
      { name: "GPT-5.6-Sol", value: "gpt-5.6-sol" },
    ]);

    expect(modelAutocompleteChoices({
      agent: "claude",
      query: "",
      currentModel: "claude-fable-5[1m]",
    })).toEqual([
      { name: "default", value: "default" },
      { name: "claude-fable-5[1m]", value: "claude-fable-5[1m]" },
      { name: "Claude Fable", value: "fable" },
      { name: "Claude Opus", value: "opus" },
      { name: "Claude Sonnet", value: "sonnet" },
      { name: "Claude Haiku", value: "haiku" },
    ]);
  });
});
