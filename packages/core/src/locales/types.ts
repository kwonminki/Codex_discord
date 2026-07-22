export interface ConnectorLocaleTemplate {
  source: string;
  target: string;
}

export interface ConnectorLocaleCatalog {
  code: string;
  label: string;
  messages: Readonly<Record<string, string>>;
  templates?: readonly ConnectorLocaleTemplate[];
  fragments?: Readonly<Record<string, string>>;
}
