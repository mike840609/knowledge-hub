# Task export setup

Save a task you finished with Claude Code or OpenCode as a task result in your
Knowledge Hub My Space. The export goes through one restricted binding: it can
only add task results to one folder-sync Source in your own My Space, and it is
never sent unless you ask for it (`/hub-export`).

[繁體中文](task-export-setup.zh-TW.md)

## 1. Install the command

Node.js 20.19 or later is required. From a checkout of the Hub repository:

```bash
cd tools/knowledge-hub
npm pack                       # writes knowledge-hub-<version>.tgz
npm install -g ./knowledge-hub-*.tgz
knowledge-hub help
```

The tarball has no dependencies; you can copy it to another machine and install it
there the same way.

## 2. Create a binding

In Knowledge Hub open **My Space → Tasks → Set up export**, choose the folder-sync
Source the results belong to, and create the binding. The page shows a secret
once, and the exact `configure` command for this binding. Copy the secret now;
it is not shown again.

## 3. Configure each project

Run the command the page shows from the project root, then paste the secret at
the hidden prompt:

```bash
knowledge-hub configure --hub-url https://km.example.com --binding-id <binding-id>
```

The secret is never passed on the command line. It is stored once per binding in
your user config directory, readable only by you; a second project that uses the
same binding asks for nothing.

- **Git worktrees and other checkouts:** reuse an already configured project with
  `knowledge-hub configure --from <path-to-configured-project>`.
- **Two bindings in one project:** add `--profile <name>` to `configure` and to
  every `export`.
- **Rotating the secret:** rotate it on the setup page, then run
  `knowledge-hub configure --rotate <binding-id>` and paste the new one. Every
  project using that binding picks it up.

## 4. Install the `/hub-export` command

```bash
knowledge-hub install-agent              # Claude Code and OpenCode
knowledge-hub install-agent --claude     # Claude Code only
```

This installs a Claude Code Skill at `~/.claude/skills/hub-export/SKILL.md` and an
OpenCode command at `~/.config/opencode/commands/hub-export.md` that points at the
same Skill. It never overwrites a file you edited; `--force` replaces it.

## 5. Export a task

After finishing a task, type `/hub-export`. The Agent writes a short description
of the task, pipes it to `knowledge-hub export --new`, and reports the URL and the
Task ID. To update that export later, ask the Agent to update it; it runs
`knowledge-hub export --task <task-id>`.

The content the Agent writes looks like this:

<!-- example-content -->
```json
{
  "agent": "claude-code",
  "status": "completed",
  "title": "Fix login redirect loop",
  "summary": "Stopped the sign-in page from redirecting to itself when the session cookie had expired.",
  "completedAt": "2026-11-04T10:00:00Z",
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
