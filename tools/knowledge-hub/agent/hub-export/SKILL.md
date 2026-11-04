---
name: hub-export
description: Export the task you just completed in this project to the user's My Space in Knowledge Hub, as a reviewable task result. Use only when the user asks for it (for example by typing /hub-export).
---

# Export the completed task to Knowledge Hub

The user asked you to save the task you just finished as a task result in their
Knowledge Hub My Space. You write a small JSON description of the task; the
`knowledge-hub` command checks it, keeps a local copy and sends it. You never
contact Knowledge Hub any other way: no MCP, no HTTP of your own,
and no Stop or Idle hook — an export happens only because the user asked for this one.

## 1. Identify the task

Find the task you just completed in this conversation. If there is no completed
task, or you cannot tell which one the user means, ask the user and stop.

Never send the whole conversation, a transcript or tool logs. Describe the task
in your own words, short and specific.

## 2. Write the task content

Write one JSON object with exactly these fields:

```json
{
  "agent": "claude-code",
  "status": "completed",
  "title": "Fix login redirect loop",
  "summary": "What was done and why, in a few sentences.",
  "completedAt": "2026-11-04T10:00:00Z",
  "verification": { "status": "passed", "checks": ["npm test -- auth: 12 passed"] },
  "findings": ["Something learned that is worth keeping."],
  "decisions": ["A decision taken and its reason."],
  "changes": ["A change made."],
  "references": [
    { "type": "WIKI", "path": "architecture/auth.md" },
    { "type": "CODE_FILE", "path": "src/auth/redirect.ts" },
    { "type": "COMMIT", "id": "9dd98f9" },
    { "type": "PR_URL", "url": "https://github.com/org/repo/pull/1" }
  ]
}
```

- `agent` is `claude-code` in Claude Code and `opencode` in OpenCode. `status` is always `completed`.
- `completedAt` is when you finished, as an ISO 8601 time with a time zone.
- `findings`, `decisions`, `changes` and `references` are optional; leave out a list you have nothing for.
- Set no other field. The command adds the identity fields itself and refuses content that sets them.

Verification is evidence, not opinion. Record a check only when you ran it in
this task and saw its result, and quote the command and its outcome.
Never write `"passed"` without a check you actually ran and saw pass. If you ran nothing,
use `"not_run"`; if a run failed, use `"failed"`; if nothing could be checked,
use `"not_applicable"`.

Wiki references only when the user or the work named that page explicitly: a
`WIKI` reference is a path relative to the user's synced knowledge folder (or a
Knowledge Hub document id the user gave you). Never guess a page from a topic.
`CODE_FILE` paths are relative to the project root. Do not put secrets, keys or
passwords anywhere in the content.

## 3. Send it

Pipe the JSON to the command on stdin, from the project root:

- A new task: `knowledge-hub export --new`
- When the user asks to update the export of a task, use that task's Task ID:
  `knowledge-hub export --task <task-id>`. For "update the export
  I just did", use the Task ID the command printed for that export.

Do not write the JSON to a file outside the project; pipe it.

## 4. Act on the result

- Exit 0: report the URL and the Task ID the command printed.
- Exit 2 without `--retry` hints means the command refused the content locally (for example an absolute `CODE_FILE` path, a suspected secret, or content over 64 KiB): correct your own JSON (make the path relative, remove the secret, shorten the text), run the same command again, and tell the user what you changed.
- Exit 2 with `--retry` hints means earlier exports from this project are not confirmed yet, and `--new` was refused. Run each `knowledge-hub export --retry <task-id>` it lists, one at a time. If one fails, report its message and stop. After they succeed, judge by meaning whether a listed task is the same work as the current task — not by titles or times being equal. If it is the same work, report the retried URL and stop. Run `--new` again only for clearly different work; when unsure, ask the user.
- Exit 3: Knowledge Hub could not be reached or gave no trustworthy answer. Report the printed message; the user can run the printed `knowledge-hub export --retry <task-id>` later.
- Exit 4: it will not succeed without a user action. Report the printed message and the next command verbatim, and stop.

Run `knowledge-hub export --discard <task-id>` only when the user explicitly asks to drop that export — never on your own to unblock `--new`.

Always report the outcome to the user: the URL and the Task ID on success, or the
command's failure line and next command verbatim.
