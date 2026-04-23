export interface RegisteredAgent {
  computerId: string;
  displayName: string;
  capabilities: string[];
  send(message: unknown): Promise<void>;
}

export interface AgentSummary {
  computerId: string;
  displayName: string;
  capabilities: string[];
  status: "online";
}

export interface AgentRegistry {
  register(agent: RegisteredAgent): void;
  get(computerId: string): RegisteredAgent | undefined;
  list(): AgentSummary[];
}

export function createAgentRegistry(): AgentRegistry {
  const agents = new Map<string, RegisteredAgent>();

  return {
    register(agent) {
      agents.set(agent.computerId, agent);
    },
    get(computerId) {
      return agents.get(computerId);
    },
    list() {
      return Array.from(agents.values(), (agent) => ({
        computerId: agent.computerId,
        displayName: agent.displayName,
        capabilities: [...agent.capabilities],
        status: "online" as const,
      }));
    },
  };
}
