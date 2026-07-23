import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentKind } from "./agentSettings.js";

export interface ModelAutocompleteChoice {
  name: string;
  value: string;
}

interface CachedCodexModels {
  expiresAt: number;
  choices: ModelAutocompleteChoice[];
}

const CODEX_MODEL_CACHE_TTL_MS = 30_000;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const CLAUDE_MODEL_CHOICES: ModelAutocompleteChoice[] = [
  { name: "Claude Fable", value: "fable" },
  { name: "Claude Opus", value: "opus" },
  { name: "Claude Sonnet", value: "sonnet" },
  { name: "Claude Haiku", value: "haiku" },
];
const codexModelCache = new Map<string, CachedCodexModels>();

function modelChoice(value: unknown, displayName?: unknown): ModelAutocompleteChoice | null {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 100) {
    return null;
  }

  const normalizedValue = value.trim();
  const normalizedName =
    typeof displayName === "string" && displayName.trim().length > 0
      ? displayName.trim()
      : normalizedValue;

  return {
    name: normalizedName.slice(0, 100),
    value: normalizedValue,
  };
}

function parseCodexModelChoices(raw: string): ModelAutocompleteChoice[] {
  const parsed = JSON.parse(raw) as { models?: unknown };
  if (!Array.isArray(parsed.models)) {
    return [];
  }

  return parsed.models.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      return [];
    }

    const model = candidate as {
      slug?: unknown;
      display_name?: unknown;
      visibility?: unknown;
    };
    if (model.visibility !== undefined && model.visibility !== "list") {
      return [];
    }

    const choice = modelChoice(model.slug, model.display_name);
    return choice ? [choice] : [];
  });
}

export async function loadCodexModelChoices(
  codexHome: string | null | undefined,
  now = Date.now(),
): Promise<ModelAutocompleteChoice[]> {
  if (!codexHome?.trim()) {
    return [];
  }

  const cachePath = path.join(path.resolve(codexHome), "models_cache.json");
  const cached = codexModelCache.get(cachePath);
  if (cached && cached.expiresAt > now) {
    return cached.choices;
  }

  try {
    const choices = parseCodexModelChoices(await readFile(cachePath, "utf8"));
    codexModelCache.set(cachePath, {
      expiresAt: now + CODEX_MODEL_CACHE_TTL_MS,
      choices,
    });
    return choices;
  } catch {
    return cached?.choices ?? [];
  }
}

export function modelAutocompleteChoices(input: {
  agent: AgentKind;
  query: string;
  currentModel?: string | null;
  codexModels?: ModelAutocompleteChoice[];
}): ModelAutocompleteChoice[] {
  const candidates = [
    { name: "default", value: "default" },
    modelChoice(input.currentModel),
    ...(input.agent === "claude" ? CLAUDE_MODEL_CHOICES : input.codexModels ?? []),
  ].filter((choice): choice is ModelAutocompleteChoice => Boolean(choice));
  const unique = [...new Map(
    candidates.map((choice) => [choice.value.toLocaleLowerCase(), choice]),
  ).values()];
  const terms = input.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

  return unique
    .filter((choice) => {
      const searchable = `${choice.name} ${choice.value}`.toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    })
    .slice(0, MAX_AUTOCOMPLETE_CHOICES);
}
