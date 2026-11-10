const AGENT_NAMES: Record<string, string> = { "claude-code": "Claude Code", opencode: "OpenCode" };

/** The label a reader sees for the agent that wrote a Task Result. */
export const agentName = (agent: string) => AGENT_NAMES[agent] ?? agent;
