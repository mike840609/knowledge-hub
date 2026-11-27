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
- **`/w/<ws>/agents`** has two layouts, chosen by whether a binding exists. A header action,
  **Task results**, links to `/tasks`.
  - **No binding yet** (and while the first binding's setup line is still on screen): the
    diagram, then three numbered steps, each holding its own control. ① Create a binding
    (the form). ② Run the setup line on that machine (a muted preview until the binding
    exists, then the one-time line). ③ Type a skill in your agent (the skills list).
  - **Bindings exist:** Bindings first (the list, with Rotate token and Revoke, and the
    form behind **Add a machine**), then Skills, then the diagram, then a collapsed "How to
    connect another machine". A freshly issued setup line shows above the list.
- **The diagram** carries the explanation; one caption line is its footnote. Two dashed
  frames: *On your machine* holds the AI agent (Claude Code, OpenCode) and the
  `knowledge-hub` command with its binding token; *Knowledge Hub* holds My Space, with
  Documents (Read) and Task results (Read · Write). Two arrows cross between them, Read and
  Write. The command is drawn on the machine, not inside the Hub, because it is the CLI the
  reader installs, which shares only its name with the product. Task results are drawn
  readable as well as writable because `/hub-search --tasks` and `/hub-read --task` read them.
  Documents are drawn read-only because agents cannot write one yet; when they can, Documents
  gains Write. Colours are the page tokens, so it follows light and dark.
- **Skills** are labelled Read or Write: `/hub-search` and `/hub-read` read, `/hub-export`
  writes a Task Result.
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
