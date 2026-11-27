# Agents destination

## Intent

Coding agents can already work with My Space. They save finished tasks with `/hub-export`
([task knowledge export](2026-11-04-task-knowledge-export-design.md)), and they search and read
with `/hub-search` and `/hub-read` ([agent read access](2026-11-10-agent-read-access-design.md)).
None of it could be found from the expanded sidebar. Tasks was compact-only; the binding page
sat at `/tasks/setup`, behind Tasks; and no page said which skills exist.

Agents will be able to do more later, such as creating documents. So the place is named
**Agents**, not Tasks: Task Results are one thing agents produce, not the whole feature.

## Decision

- **Page switch.** A personal workspace with search gets a fifth item, **Agents** (`Bot`),
  after Shares. It goes through `knowledgeDestinations`, so the collapsed rail lists it too.
  The rail's separate Tasks item is removed, because it used the same icon. A team sees no
  Agents. This amends [the page switch](2026-11-23-knowledge-destination-icons-design.md)
  ("Which items", "Unchanged").
- **`/w/<ws>/agents`** is one page, in this order:
  1. **Connect an agent**, as three steps:
     - Create a binding, one per machine.
     - Run the setup line it shows once, on that machine.
     - Type a skill in Claude Code or OpenCode.
  2. **Skills**: each skill's command, what it does, and whether it reads or adds. It closes
     with the limits: a skill runs only when typed, and none edits a document. It comes
     before the controls so that it is in view when the page opens.
  3. The binding controls from the old setup page, unchanged: create, rotate, revoke and
     the binding IDs.
  4. A link to **Task results** (`/tasks`).
- **`/tasks/setup` redirects to `/agents`**, so old links and the CLI's messages still land.
  The Tasks page and its empty state link to Agents. The Tasks page's location reads
  `Agents`.
- **The skills list** lives in `src/components/task-knowledge/agent-skills.ts`.
  `tests/unit/agent-skills-list.test.ts` fails when it differs from the skill folders that
  `tools/knowledge-hub/agent/` ships. A new skill must therefore appear on the page.
- **Unchanged.** Authorization is unchanged: bindings exist only in the caller's own My Space,
  and every other workspace answers not found. The credential, the routes and the CLI are
  unchanged. Home's actions menu keeps Open Tasks.

Not now: an activity log of what agents read or wrote, and moving `/tasks` under `/agents`.
Both wait until there is a second kind of agent output.
