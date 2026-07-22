import { enLocale } from "./en.js";
import { jaLocale } from "./ja.js";
import { koLocale } from "./ko.js";
import { zhLocale } from "./zh.js";
import type { ConnectorLocaleCatalog, ConnectorLocaleTemplate } from "./types.js";

export type ConnectorLocale = "ko" | "en" | "zh" | "ja";

const localeCatalogs: Readonly<Record<ConnectorLocale, ConnectorLocaleCatalog>> = {
  ko: koLocale,
  en: enLocale,
  zh: zhLocale,
  ja: jaLocale,
};

const localeAliases: Readonly<Record<string, ConnectorLocale>> = {
  ko: "ko",
  "ko-kr": "ko",
  korean: "ko",
  한국어: "ko",
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  english: "en",
  영어: "en",
  zh: "zh",
  "zh-cn": "zh",
  "zh-hans": "zh",
  chinese: "zh",
  中文: "zh",
  简体中文: "zh",
  중국어: "zh",
  ja: "ja",
  "ja-jp": "ja",
  japanese: "ja",
  日本語: "ja",
  일본어: "ja",
};

export const SUPPORTED_CONNECTOR_LOCALES = Object.freeze(
  Object.keys(localeCatalogs) as ConnectorLocale[],
);

export function resolveConnectorLocale(
  value: string | null | undefined,
  fallback: ConnectorLocale = "ko",
): ConnectorLocale {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  const locale = localeAliases[normalized];

  if (!locale) {
    throw new Error(
      `Unsupported connector locale "${value}". Supported locales: ${SUPPORTED_CONNECTOR_LOCALES.join(", ")}.`,
    );
  }

  return locale;
}

export function connectorLocaleCatalog(locale: ConnectorLocale): ConnectorLocaleCatalog {
  return localeCatalogs[locale];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyTemplate(value: string, template: ConnectorLocaleTemplate): string | null {
  const placeholders: string[] = [];
  const placeholderPattern = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
  let pattern = "^";
  let cursor = 0;

  for (const match of template.source.matchAll(placeholderPattern)) {
    pattern += escapeRegex(template.source.slice(cursor, match.index));
    pattern += "([\\s\\S]+?)";
    const name = match[1] ?? "value";
    placeholders.push(name);
    cursor = (match.index ?? 0) + match[0].length;
  }

  pattern += `${escapeRegex(template.source.slice(cursor))}$`;
  const match = value.match(new RegExp(pattern));

  if (!match) {
    return null;
  }

  const values = new Map(placeholders.map((name, index) => [name, match[index + 1] ?? ""]));
  return template.target.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name: string) => values.get(name) ?? "");
}

function translateLine(value: string, catalog: ConnectorLocaleCatalog): string {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const body = value.slice(leading.length, value.length - trailing.length || undefined);
  const direct = catalog.messages[body];

  if (direct !== undefined) {
    return `${leading}${direct}${trailing}`;
  }

  const bold = body.match(/^\*\*(.+)\*\*$/s);
  if (bold) {
    const translated = translateLine(bold[1] ?? "", catalog);
    return `${leading}**${translated}**${trailing}`;
  }

  for (const template of catalog.templates ?? []) {
    const translated = applyTemplate(body, template);
    if (translated !== null) {
      return `${leading}${translated}${trailing}`;
    }
  }

  let translated = body;
  for (const [source, target] of Object.entries(catalog.fragments ?? {})) {
    translated = translated.replaceAll(source, target);
  }

  return `${leading}${translated}${trailing}`;
}

export function localizeConnectorText(value: string, locale: ConnectorLocale): string {
  if (locale === "ko" || value.length === 0) {
    return value;
  }

  const catalog = connectorLocaleCatalog(locale);
  return value
    .split("\n")
    .map((line) => line.trimStart().startsWith(">>>") ? line : translateLine(line, catalog))
    .join("\n");
}

export type { ConnectorLocaleCatalog, ConnectorLocaleTemplate } from "./types.js";
