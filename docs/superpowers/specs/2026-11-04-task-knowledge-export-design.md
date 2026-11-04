# Knowledge Hub — Task Knowledge Export Design

**Status:** Approved, 2026-11-04; revised after two design reviews (same day). Manual MVP. The automatic-ingestion direction is deferred (§10).
**Scope:** Manual Skill/Command trigger + Agent-generated summary + shared CLI + Task Ingestion API + My Space.

## 1. Why and success

After completing a Claude Code or OpenCode task, a developer invokes `/hub-export`. The Agent produces a factual, structured summary of the task, and a shared CLI uploads it securely. Knowledge Hub stores the result as a reusable knowledge asset and resolves explicitly referenced Wiki documents. This is not a task manager, conversation recorder, or alternative to the existing company wiki.

Success: one command from a configured project yields a new Task Result, visible only to its My Space owner, with verification status and traceable Wiki references. No browser copy/paste is required per task.

## 2. Approved decisions and alternatives

| Concern | MVP choice | Deferred alternative |
| --- | --- | --- |
| Trigger | Manual `/hub-export` | Stop/Idle Hooks and automatic detection |
| Summary | Current Claude Code/OpenCode Agent | Hub-hosted LLM |
| Tooling | Shared Skill + CLI, installed per user; OpenCode command adapter | MCP write server |
| Target | Owner's My Space only | Team Workspace auto-export |
| Source binding | One-time Local Project → My Space → FOLDER_SYNC Wiki Source | Per-task selection |
| Connections | Explicit Wiki references scoped to bound Source | LLM semantic matching |
| Storage | Independent Task Knowledge asset and revision | Converting to editable Wiki |
| Reliability | Idempotent API, CLI-owned task identity and frozen drafts, manual retry | Persistent Outbox and daemon |
| Future | MCP retrieval, automatic Hooks, graph integration | Not required to ship MVP |

## 3. Existing system boundaries

The existing `sources` module owns folder snapshots, SourceEntry mappings, and revisions. Keep Folder Sync's immutable snapshot/Preview/Confirm/Apply contract and SOURCE_MANAGED read-only policy unchanged. The existing My Space has an owner and lifecycle; the existing graph supports DOCUMENT and UNRESOLVED nodes, not Task nodes. Use MariaDB and Next.js; no GPU, LLM service, embeddings, Graph DB or CodeGraph required.

**Recorded deviations from `CLAUDE.md`** (the implementation PR reflects each in `CLAUDE.md`, and the first two in `eslint.config.mjs`):

1. **Module:** the feature lives in a fifth module, `src/modules/task-knowledge/`, not inside `knowledge`. It is held to the same boundary as `knowledge`: no `next`, `react`, `mariadb`, `infrastructure` or `server` imports, and no import of `@/modules/sources/**`. It reaches Workspace, Source, SourceEntry and Document data only through its own ports, which the infrastructure adapter implements. Path normalization that must match Folder Sync is done in that adapter, which may use the `sources` domain.
2. **Composition root:** the feature is wired in `src/server/composition.ts`, the only composition root. No second root is created.
3. **A write without a caller.** `CLAUDE.md` requires a caller for every write. `IngestTaskResultService.ingest` is the one task-knowledge entry that writes without a `CallerContext`: its authority is the export credential, which names exactly one binding and one permitted act (`task-result:create`). It is reached only from `POST /api/task-results/ingest`. Every other task-knowledge entry takes a caller. A test enforces both facts, in the style of `tests/unit/share-link-single-exception.test.ts`.
4. **Phase 7:** the export credential is a non-human, credential-scoped principal. It is not a delegation of a human's identity, and it does not decide the Phase 7 Agent-identity model (§10).

## 4. User flow

1. A browser-authenticated user in an ACTIVE PERSONAL My Space selects an ACTIVE FOLDER_SYNC Wiki Source and creates an Export Binding and a restricted credential.
2. Once per machine, the user installs the CLI (`npm install -g <hub-checkout>/tools/knowledge-hub`) and runs `knowledge-hub install-agent`, which copies the shared Skill and the OpenCode command into the user-level directories of each tool. They then work in any project, not only the Hub repo.
3. Once per project, the user runs `knowledge-hub configure` there. The CLI stores, locally and outside the repo, the Hub URL, the binding ID, the project root (the root for CODE_FILE paths) and the credential. Credential input must not appear in shell history, Agent prompts, command arguments or Git. In another worktree of the same project, `knowledge-hub configure --from <otherRoot>` copies that configuration on purpose; there is never a silent fallback.
4. The user completes a task and invokes `/hub-export`.
5. The Agent writes the summary content (§5, Agent-authored fields) as JSON to the CLI's stdin: `knowledge-hub export --new`. The CLI mints the Task ID, sets revision 1, saves the full artifact in its own state directory, records its hash, and posts HTTPS to Knowledge Hub. The Agent never writes files outside the project and never sets identity fields. It must not invent tests, changes or references.
6. On a retryable failure the CLI keeps the saved artifact and prints `knowledge-hub export --retry <taskId>`, which resends it unchanged.
7. Server derives owner/workspace/source from the restricted credential and verifies current state. The server atomically persists the task, revision and its references, and replies with the result URL.

This MVP does not auto-detect task completion. Only completed tasks can be exported; an incomplete/failed task must not be labeled completed. `/hub-export` must not send full conversation history or hidden reasoning.

## 5. Artifact contract

**Agent-authored fields** (what the Agent pipes to the CLI): `agent`, `status: completed`, non-empty `title`, `summary`, `completedAt`, `verification.status` (`passed`, `failed`, `not_run`, `not_applicable`); optional `verification.checks`, `findings`, `decisions`, `changes`, `references`.

**CLI-owned fields** (added by the CLI, never accepted from the Agent): `schemaVersion: 1`, `taskId` (UUIDv4), `artifactRevision` (positive integer). The binding is not an artifact field: the server takes it from the credential.

Verification is self-reported evidence, not certification by Hub. A missing check list is never read as a pass.

Reference types:
- **WIKI:** exact Source-relative path or validated Document ID.
- **CODE_FILE:** project-relative path only. No absolute path, no `..` segment, no drive letter, no control characters. The CLI checks that it resolves inside the project root; the file need not still exist (a task may delete it). The server stores the relative path as text.
- **COMMIT:** opaque identifier, bounded length and charset.
- **PR_URL:** `https:` scheme only, no userinfo, no control characters, bounded length.

Non-WIKI references stay external and are rendered as links only when they pass the scheme rule above. No full source contents, raw terminal logs or environment variables. MVP limit: 64 KiB artifact, 32 references, bounded string fields; reject unsafe, unknown and oversized data without silent truncation. The local client should scan for forbidden content, but this is not a guarantee that all secrets can be detected.

**Task identity and frozen drafts.** The CLI mints Task IDs; the Agent never does. Each saved artifact is frozen: the CLI records its canonical hash when it saves it and refuses to send a file whose hash no longer matches. `export --retry <taskId>` resends the latest saved revision unchanged, so a timeout followed by a retry yields the same Task. Changed content for an existing task is an explicit new revision: `knowledge-hub export --task <taskId>` reads new Agent-authored content from stdin and saves revision n+1. The CLI records, per task, the binding it was first sent under, and refuses `--retry` or `--task` under a different binding. A 409 response prints the `--task` command to send the change as a new revision.

## 6. Project Source Binding / security

**Binding** holds `ownerUserId`, `sourceId`, a non-sensitive `label`, `status` (`ACTIVE` / `REVOKED`), and timestamps. The Source is fixed when the binding is created and never changes; to use another Source, create another binding. Workspace is **not** stored on the binding: it is derived as `Source → Workspace` on every request. Owner is held once on the binding and is the only owner record for its Task Results. Local absolute paths are never sent to Hub.

**Credentials:** each binding has one active credential at a time, high-entropy (`randomBytes(32)`), scoped only to `task-result:create` for that binding, with no expiry (rotation is the remedy). The server stores its SHA-256 hash, never the plaintext. The token is shown once in the browser-authenticated creation or rotation response, with `Cache-Control: no-store`. **Rotation** issues a new token and revokes the previous one in one transaction; the old token fails on its next use. **Revoking** a binding revokes its credential. Credentials cannot confer generic `document.write` or `source.manage`.

**Local storage:** the CLI keeps the credential in a per-user file under the user's configuration directory, created with mode `0600` on POSIX. On Windows, where `chmod` does not apply, the file lives under the user profile and the CLI prints a warning that protection depends on the profile's ACL. No OS keychain integration in MVP; no new runtime package. The CLI accepts the token through a hidden interactive prompt or stdin, never as ordinary argv.

**Local config** is keyed by the realpath of the project's Git top-level directory (or of the working directory when the project is not in Git), plus an optional `--profile <name>` for several bindings in one project. Each worktree is a separate key. `configure --from` is the only way two keys share a binding, and it is an explicit act.

**Archival and revocation.** Task Result lifecycle is `ACTIVE` / `ARCHIVED`, as everywhere in the product; there is no hard delete. The owner may archive and restore a Task Result from My Space. Ingesting a new revision into an ARCHIVED task is refused (409, `TASK_ARCHIVED`): a credential cannot change a lifecycle the owner set. Revoking a binding stops new ingestion immediately; existing Task Results remain readable by their owner and show the binding's revoked status.

**Write checks.** Each ingest checks credential status, binding status, Workspace `PERSONAL` and `ACTIVE`, that the binding owner is the Workspace owner, and that the Source is an `ACTIVE` `FOLDER_SYNC` Source of that Workspace. ("Source ownership" in the `SOURCE_MANAGED` / `HUB_MANAGED` sense is unrelated and not consulted: Task Results never write to the Source.) The order is fixed so that revocation cannot lose a race:
1. Hash the token; read credential and binding without a lock to learn the Source and so the Workspace.
2. Lock the Workspace (`workspaces.lockById`).
3. Re-read credential, binding, Source and Workspace under that lock, and apply every check above to the re-read rows.
4. Write.

Revoke and rotate take the same Workspace lock before changing credential or binding rows. Never accept caller-provided Owner, Workspace or Source identity. Team or cross-workspace writes are forbidden.

## 7. Ingestion and references

**Authentication.** The export credential travels in `X-Knowledge-Hub-Export-Token`. It does not use `Authorization`, because the site password (HTTP Basic) acts on that header. `POST /api/task-results/ingest` is the only route exempt from the site-password gate and the Google session gate, exempt by exact pathname: no trailing slash, no case folding, no prefix. The route answers only `POST` (others 405) and authenticates solely by the export credential. A custom header also forces a CORS preflight, which a cross-site browser request cannot pass. This is a deliberate change to the security boundary; `docs/superpowers/specs/2026-10-25-google-login-design.md` gets a pointer to this section.

**Responses.** `POST /api/task-results/ingest`:
- 201: new revision created.
- 200: exact replay (same revision, same canonical hash).
- 400: malformed JSON.
- 401: credential missing, unknown or revoked.
- 403: credential is live, but its binding, Workspace or Source no longer allows the write.
- 405: any method other than `POST`.
- 409: same revision with differing content (`REVISION_CONFLICT`), or the task is archived (`TASK_ARCHIVED`).
- 413: body over 64 KiB, measured on the bytes actually read, not on `Content-Length`.
- 422: valid JSON that fails the artifact contract, including an unsupported `schemaVersion`.
- 503: retryable (lock wait timeout, database unavailable).

Response bodies are private and uncached (`Cache-Control: private, no-store`).

**Identity and concurrency.** Task identity is unique by `(bindingId, taskId)`; revision is unique by `(taskResultId, artifactRevision)`. The owner is reached through the binding, so it is not part of the key. Same revision with the same canonical content hash is a no-op replay; different content is rejected. Concurrent POSTs cannot produce duplicate tasks or partial revision/reference rows. A new revision retains prior revisions.

**References.** Explicit Wiki resolution uses **only** `(bound sourceId, exact sourcePath)` or a validated Document ID. The sourcePath is normalized exactly as Folder Sync normalized `source_entries.source_path` (`normalizeImportPath`), and compared byte-exactly; this happens in the infrastructure adapter, so the two can never drift. Never use existing Wiki Link title ranking to assert a unique Task reference. Only ACTIVE Source, SourceEntry and Document are eligible. Missing: UNRESOLVED; multiple/ambiguous: AMBIGUOUS; later revoked/archived: UNAVAILABLE. Save the original locator and resolved Document ID. Following a reference always rechecks live authorization/lifecycle. A stored historical ID is not a capability.

## 8. My Space UI

A small Task Results list/detail view within My Space, without a new top-level sidebar entry. Show title, agent, completedAt, summary, findings, decisions, changes, verification and checks, linked Wiki/external references, lifecycle, binding status, and revision history, with archive and restore actions for the owner. Existing Folder Sync, Document Graph, and Agent Context APIs remain unchanged. Task Result is a distinct Knowledge Asset, not a Wiki Document. All text, including Markdown- or HTML-looking content, renders as inert text.

## 9. Failures and tests

- Agent has partial context: summarize only supported facts, do not infer passing tests.
- Export aborted/offline: the saved artifact is retained; retry is explicit (`export --retry`). No background daemon in MVP.
- Timeout then retry: same saved artifact, same Task ID, same hash; the server answers 200 or 201 without duplicating the task.
- Saved artifact edited by hand or by the Agent: the CLI refuses to send it.
- Changed content for an exported task: `export --task` creates the next revision; prior revisions remain.
- Archived task: a new revision is refused until the owner restores it.
- Replay/concurrent upload: unique constraints + transaction enforce idempotency.
- Revocation concurrent with ingest: the Workspace lock and post-lock re-read decide; no commit after revocation wins.
- Workspace revoked/archived or credential revoked: reject without fallback to another Workspace.
- Source moved/archived or paths collide: preserve original reference, do not guess.
- Data policy: reject overly broad content, secret-like data and traversal paths; do not log secrets.
- Both Claude Code and OpenCode use the same Schema and the same `/hub-export` workflow, from one shared Skill source, in projects other than the Hub repo.

Definition of done: one manual command in either tool, in an ordinary project, produces a factual Task Result in My Space, handles failure safely, and provides accurate explicit Wiki references with no cross-workspace disclosure. Unit, integration, middleware and E2E testing required.

## 10. Deferred

Automatic Hook/Plugin, persistent retry Outbox, MCP, complete conversation history, Team auto-export, semantic relations, CodeGraph, Task nodes in the general Graph, PDF/binary storage, historical Session backfill, automatic Wiki updates, credential expiry and OS keychain storage.

**Phase 7 relation.** The export credential is a non-human principal limited to `task-result:create`. The roadmap's Phase 7 open question (whether an Agent acts as a delegated human identity or as a generalised Principal) remains open. This MVP does not answer it, and does not create a precedent for it: the export credential is a narrow, revocable write grant and carries no human's identity. Phase 7 must decide the general model; the roadmap records this dependency.

Later work must be designed separately and aligned with the existing Phase 7–9 Roadmap.
