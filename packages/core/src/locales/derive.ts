import { enLocale } from "./en.js";
import type { ConnectorLocaleCatalog } from "./types.js";

export function deriveConnectorLocale(input: {
  code: string;
  label: string;
  messages: Readonly<Record<string, string>>;
  templates?: Readonly<Record<string, string>>;
  fragments?: Readonly<Record<string, string>>;
}): ConnectorLocaleCatalog {
  return {
    code: input.code,
    label: input.label,
    messages: {
      ...enLocale.messages,
      ...input.messages,
    },
    templates: (enLocale.templates ?? []).map((template) => ({
      source: template.source,
      target: input.templates?.[template.source] ?? template.target,
    })),
    fragments: {
      ...enLocale.fragments,
      ...input.fragments,
    },
  };
}
