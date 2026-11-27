/**
 * The skills `knowledge-hub install-agent` adds to Claude Code and OpenCode, as the Agents page lists them.
 * `tests/unit/agent-skills-list.test.ts` fails when this differs from `tools/knowledge-hub/agent/`.
 */
export const AGENT_SKILLS = [
  { name: "hub-search", access: "Reads", summary: "Searches the active documents or past task results in My Space." },
  { name: "hub-read", access: "Reads", summary: "Reads one document's current Markdown or one task result." },
  { name: "hub-export", access: "Adds", summary: "Saves the task you just finished as a task result in My Space." },
] as const;
