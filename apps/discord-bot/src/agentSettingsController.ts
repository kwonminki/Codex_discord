import type { ManagedDiscordChannelContext } from "./channelContext.js";
import {
  DEFAULT_AGENT_SETTINGS,
  effectiveAgentSettings,
  normalizeAgentDefaultSettings,
  normalizeAgentEffort,
  type AgentDefaultSettings,
  type AgentEffort,
  type AgentKind,
} from "./agentSettings.js";

export interface AgentSettingsControllerOptions {
  updateDefaults?: (
    agent: AgentKind,
    patch: { model?: string | null; effort?: AgentEffort },
  ) => Promise<AgentDefaultSettings>;
  updateSession?: (
    discordChannelId: string,
    patch: { model?: string | null; effort?: AgentEffort | null },
  ) => Promise<void>;
}

export function agentKindForContext(context: ManagedDiscordChannelContext): AgentKind {
  return context.agentMain ?? (context.channelMode === "claude-code" ? "claude" : "codex");
}

export function createAgentSettingsController(options: AgentSettingsControllerOptions = {}) {
  const modelsByChannel = new Map<string, string | null>();
  const effortsByChannel = new Map<string, AgentEffort | null>();
  let runtimeDefaults: AgentDefaultSettings | null = null;

  function get(channelId: string, context: ManagedDiscordChannelContext) {
    const agent = agentKindForContext(context);
    const defaults = runtimeDefaults ?? normalizeAgentDefaultSettings(context.agentDefaults);
    const modelOverride = modelsByChannel.has(channelId)
      ? modelsByChannel.get(channelId) ?? null
      : context.agentModelOverride ?? null;
    const effortOverride = effortsByChannel.has(channelId)
      ? effortsByChannel.get(channelId) ?? null
      : context.agentEffortOverride ?? null;

    return effectiveAgentSettings({
      agent,
      defaults,
      override: context.agentMain ? null : { model: modelOverride, effort: effortOverride },
    });
  }

  async function updateModel(
    channelId: string,
    context: ManagedDiscordChannelContext,
    model: string | null,
  ): Promise<void> {
    const agent = agentKindForContext(context);

    if (context.agentMain) {
      if (options.updateDefaults) {
        runtimeDefaults = await options.updateDefaults(agent, { model });
      } else {
        const current = runtimeDefaults ?? normalizeAgentDefaultSettings(context.agentDefaults);
        runtimeDefaults = normalizeAgentDefaultSettings({
          ...current,
          [agent]: { ...current[agent], model },
        });
      }
      return;
    }

    await options.updateSession?.(channelId, { model });
    modelsByChannel.set(channelId, model);
  }

  async function updateEffort(
    channelId: string,
    context: ManagedDiscordChannelContext,
    requestedEffort: AgentEffort | "default",
  ): Promise<void> {
    const agent = agentKindForContext(context);

    if (context.agentMain) {
      const effort = requestedEffort === "default"
        ? DEFAULT_AGENT_SETTINGS[agent].effort
        : normalizeAgentEffort(agent, requestedEffort);

      if (options.updateDefaults) {
        runtimeDefaults = await options.updateDefaults(agent, { effort });
      } else {
        const current = runtimeDefaults ?? normalizeAgentDefaultSettings(context.agentDefaults);
        runtimeDefaults = normalizeAgentDefaultSettings({
          ...current,
          [agent]: { ...current[agent], effort },
        });
      }
      return;
    }

    const effort = requestedEffort === "default" ? null : normalizeAgentEffort(agent, requestedEffort);
    await options.updateSession?.(channelId, { effort });
    effortsByChannel.set(channelId, effort);
  }

  function codexReasoningEffort(channelId: string, context: ManagedDiscordChannelContext) {
    const effort = get(channelId, context).effort;
    return effort === "max" ? "xhigh" as const : effort;
  }

  return {
    agentFor: agentKindForContext,
    get,
    updateModel,
    updateEffort,
    codexReasoningEffort,
  };
}
