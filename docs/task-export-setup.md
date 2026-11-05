# Task export setup

Save a task you finished with Claude Code or OpenCode as a task result in your
Knowledge Hub My Space. The export goes through one restricted binding: it can
only add task results to your own My Space, and it is
never sent unless you ask for it (`/hub-export`).

[繁體中文](task-export-setup.zh-TW.md)

## 1. Create a binding

In Knowledge Hub open **My Space → Tasks → Set up export**, give the binding a
label (for example the machine it runs on), and create it. The page shows one
setup line for this binding, once. The line contains the binding's secret, so
copy it now; it is not shown again.

## 2. Run the setup line, once per machine

Node.js 20.19 or later is required. Run the line the page shows:

```bash
npm install -g https://km.example.com/cli/knowledge-hub.tgz && knowledge-hub install-agent && knowledge-hub configure --hub-url https://km.example.com --binding-id <binding-id> --token <secret>
```

- `npm install -g` installs the `knowledge-hub` command the Hub itself serves, so
  its version always matches the server.
- `install-agent` installs a Claude Code Skill at
  `~/.claude/skills/hub-export/SKILL.md` and an OpenCode command at
  `~/.config/opencode/commands/hub-export.md` that points at the same Skill. It
  never overwrites a file you edited; `--force` replaces it. `--claude` installs
  the Claude Code Skill only.
- `configure` stores the Hub URL, the binding and the secret in your user config
  directory, readable only by you. It never prints the secret and never writes it
  into a project. Without `--token` it asks for the secret at a hidden prompt instead.

**Treat the line as a secret.** It carries the secret, so it stays in your shell
history and, while it runs, in the process list that other users of a shared
machine can read. Run it only on your own machine, and if the line was shown or
pasted anywhere else, rotate the secret on the setup page: that makes the old
line useless at once.

That is all: every project and worktree on this machine can now export. There is
nothing to configure per project.

- **Another machine:** create another binding for it on the setup page and run
  its line there. Do not rotate this one's secret for it: rotating stops the
  machine that uses the old secret. Both machines export to the same My Space.
- **A second binding on one machine:** add `--profile <name>` to `configure` and to every
  `export`.
- **Rotating the secret:** rotate it on the setup page, which shows a new setup
  line; running it replaces the stored secret. Or run
  `knowledge-hub configure --rotate <binding-id>` and paste the new secret at the
  prompt (or add `--token <secret>`).

A Wiki reference the Agent writes as a path links to the page when exactly one
synced folder in My Space has that path.

## 3. Export a task

After finishing a task, type `/hub-export`. The Agent writes a short description
of the task, pipes it to `knowledge-hub export --new`, and reports the URL and the
Task ID. To update that export later, ask the Agent to update it; it runs
`knowledge-hub export --task <task-id>`.

The content the Agent writes looks like this; the command adds the completion time:

<!-- example-content -->
```json
{
  "agent": "claude-code",
  "status": "completed",
  "title": "Fix login redirect loop",
  "summary": "Stopped the sign-in page from redirecting to itself when the session cookie had expired.",
  "verification": { "status": "passed", "checks": ["npm test -- auth: 12 passed"] },
  "references": [
    { "type": "WIKI", "path": "architecture/auth.md" },
    { "type": "CODE_FILE", "path": "src/auth/redirect.ts" }
  ]
}
```

## When an export does not go through

Every export is saved locally before it is sent, and the command prints the next
step. The exit code says what kind of step it is:

| Exit | Meaning | What to do |
|---|---|---|
| 0 | Saved in Knowledge Hub | Nothing |
| 2 | Refused locally; nothing was sent | Fix the content, or retry the listed exports first |
| 3 | No trustworthy answer (network, timeout, server error) | `knowledge-hub export --retry <task-id>` later |
| 4 | Needs your action (rotated secret, archived task, rejected revision) | Follow the printed next step |

- An export that got no answer **may already be stored**. Retry it with
  `knowledge-hub export --retry <task-id>`: the Hub recognises an exact replay, so a
  retry never creates a second copy.
- While an earlier export is unconfirmed, `--new` is refused and lists it. Retry
  it first.
- `knowledge-hub export --discard <task-id>` drops an unconfirmed export locally.
  It removes nothing from Knowledge Hub; prefer `--retry` when the export may
  already be stored.

## What Knowledge Hub answers

`POST /api/task-results/ingest` takes only the export secret, in its own header;
a browser session or an `Authorization` header is never accepted there.

| HTTP | Meaning | CLI exit |
|---|---|---|
| 201 / 200 | New revision stored / exact replay of a stored one | 0 |
| 401 | Secret unknown, rotated or revoked | 4 (`configure --rotate`, or `--discard`) |
| 403 | The binding's My Space no longer accepts writes | 4 |
| 409 | `TASK_ARCHIVED` (restore, then `--retry`), `REVISION_CONFLICT`, `REVISION_OUT_OF_ORDER` | 4 |
| 413 / 422 | Over 64 KiB / fails the content contract | 4 |
| 5xx, timeout | No trustworthy answer | 3 (`--retry`) |
