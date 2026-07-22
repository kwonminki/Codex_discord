# Localization Guide

This guide is for AI agents and contributors installing the connector in English or adding another UI language.

## Built-in locales

| Code | Language | Notes |
| --- | --- | --- |
| `ko` | Korean | Default and canonical source strings |
| `en` | English | Built-in translation catalog |
| `zh` | Simplified Chinese | Built-in catalog with English fallback for untranslated strings |
| `ja` | Japanese | Built-in catalog with English fallback for untranslated strings |

Choose a locale during setup:

```bash
pnpm connect install --direct --locale en
```

The generated values are:

```json
{
  "discord": {
    "locale": "en"
  }
}
```

```bash
CONNECT_LOCALE="en"
```

`CONNECT_LOCALE` overrides the config file when both are present. Existing config files without `discord.locale` remain compatible and use Korean.

Restart only the Discord bot after changing locale. The worker does not render Discord UI. Confirm that the bot ready log appears and slash command descriptions are registered again.

## What is localized

- Setup prompts and setup guidance
- Discord slash command descriptions and choices shown to users
- Connector-owned message content, embed titles, embed fields, buttons, select placeholders, and modal labels
- `/howtouse` instructions delivered to Codex or Claude Code
- Connector-generated agent prompts such as fix-tests and compact

The localization boundary deliberately preserves:

- User messages and prompts
- Agent progress explanations and final answers
- Shell commands, stdout, stderr, and file paths
- Survey options written by an agent or user
- Discord custom IDs
- Slash command names, option names, and option values
- Internal `__cdc_*` commands
- `codex-discord-send` and `codex-discord-survey` fence names and JSON keys
- Session IDs, channel IDs, role IDs, and model names

## Add another language

Use a short language code such as `ja`, `de`, or `fr`. Do not duplicate `responses.ts`, `messageHandler.ts`, or other runtime logic.

1. For a complete catalog, copy `packages/core/src/locales/en.ts`. For an incremental catalog with English fallback, follow `ja.ts` or `zh.ts` and use `deriveConnectorLocale`.
2. Rename the exported catalog and translate only target values and message values. Keep every Korean source and object key unchanged.
3. Add the locale code to `ConnectorLocale`, import the catalog, register it in `localeCatalogs`, and add useful aliases in `packages/core/src/locales/index.ts`.
4. Do not add a user README for the locale. This repository intentionally maintains user-facing READMEs only in Korean and English.
5. Add tests for alias resolution, one exact string, one dynamic template, slash command descriptions, a modal, and `/howtouse`.
6. Run the complete verification commands.

```bash
pnpm typecheck
pnpm test
git diff --check
```

7. Install with the new locale and perform a Discord smoke test.

```bash
pnpm connect install --direct --locale <code>
```

Check `/status`, `/chat-new`, `/howtouse`, a permission or question prompt, progress, and a final answer. Verify that UI text is translated while the original user prompt and agent answer remain untouched.

## Catalog structure

Each locale exports `ConnectorLocaleCatalog`:

```ts
export const exampleLocale: ConnectorLocaleCatalog = {
  code: "xx",
  label: "Example language",
  messages: {
    "답변": "Translated answer label",
  },
  templates: [
    { source: "위치: {value}", target: "Translated location: {value}" },
  ],
  fragments: {
    "... (일부만 표시)": "... translated fragment",
  },
};
```

- `messages` handles exact lines. Markdown bold wrappers are preserved automatically.
- `templates` handles complete dynamic lines. Placeholder names must match in source and target.
- `fragments` is for small phrases embedded inside JSON examples or stable wrapper text. Use it sparingly because fragment replacement is broader.
- Korean is the canonical source catalog. `ko.ts` is intentionally a no-op.

## First-install agent behavior

An installation agent should infer the desired UI language from the user's current conversation. Ask only when the language is ambiguous.

- Korean conversation: select `ko`.
- English conversation: select `en`.
- Simplified Chinese conversation: select `zh`.
- Japanese conversation: select `ja`.
- Another language: explain that a small locale catalog will be added, follow this guide, run all tests, then install with the new code.

Maintain user-facing README translations only for Korean and English unless repository policy changes. Chinese, Japanese, and future locales do not require separate README files.

Do not translate source code ad hoc during installation and do not patch every Korean string in place. A new locale should remain a reviewable catalog and registry change so future upstream updates stay mergeable.
