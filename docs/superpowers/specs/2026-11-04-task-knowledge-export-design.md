# Knowledge Hub — Task Knowledge Export Design

**Status:** Approved, 2026-11-04; revised after seven design reviews (same day). Manual MVP. The automatic-ingestion direction is deferred (§10).
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
| Binding | One-time per-user setup → the owner's My Space; no Source is chosen (Amendment 2) | Per-task Workspace selection |
| Connections | Explicit Wiki references resolved across the My Space's ACTIVE FOLDER_SYNC Sources | LLM semantic matching |
| Storage | Independent Task Knowledge asset and revision | Converting to editable Wiki |
| Reliability | Idempotent API, CLI-owned task identity, confirmed revision sequence, manual retry | Persistent Outbox and daemon |
| Future | MCP retrieval, automatic Hooks, graph integration | Not required to ship MVP |

**Amendment (2026-11-04, during implementation).** The binding first named one FOLDER_SYNC Source, chosen at setup. The Source served only Wiki path resolution, yet it made export impossible for a user with no synced folder. The binding now names the owner's My Space, and a Wiki path is resolved by exact match across that My Space's ACTIVE FOLDER_SYNC Sources: one match resolves, a path present in several Sources is AMBIGUOUS, none is UNRESOLVED. Resolution never leaves the My Space, so no cross-Workspace guarantee changes. §4, §6 and §7 below are written for the amended binding.

**Amendment 2 (2026-11-05): one setup per machine.** A real run showed setup was four install steps from a Hub checkout plus a `configure` in every project and worktree, although a binding no longer names anything project-specific. Now:

- **Install from the Hub.** The Hub serves the CLI it was built with at `GET /cli/knowledge-hub.tgz`, packed from `tools/knowledge-hub` (`npm pack`) before `next dev` and `next build`, so `npm install -g <hub>/cli/knowledge-hub.tgz` needs no checkout and installs the server's own version. The path is public by exact match (site password and Google sign-in exempt, like the ingest route) because npm sends no session; the tarball holds only the CLI and the Skill, the same for every user, never data, config or a credential.
- **Configure once per user.** Config is keyed by profile only (`default`, or `--profile <name>` for a second binding), not by project. One `configure` serves every project and worktree; `configure --from` is removed. Revision state is kept per profile, so an unconfirmed export blocks `--new` from any project until it is retried.
- **The CLI dates the task.** `completedAt` is optional in Agent content; when it is absent the CLI sets the current time before saving revision 1 (or the new revision), so a retry still resends identical bytes. The Agent no longer guesses a time it cannot read.
- **One line on the setup page.** `npm install -g <hub>/cli/knowledge-hub.tgz && knowledge-hub install-agent && knowledge-hub configure --hub-url <hub> --binding-id <id>`, then the token at the hidden prompt (Amendment 4 puts `--token <token>` on the line itself).

§4, §5, §6 and §8 below are written for this setup.

**Amendment 3 (2026-11-05): Tasks in the primary navigation.** The MVP kept Task Results off the sidebar, reachable from Home's actions menu, because how often anyone would open them was unknown. The owner now expects to export from coding agents routinely, so the list is a daily destination and three clicks behind a menu is the wrong cost. My Space's primary navigation gains a `Tasks` row (personal Workspaces only, like Inbox, Home, Shares and Insights), and Home's actions menu drops its link, since that menu offers only what the navigation does not. Nothing else changes: the row is navigation, not authorization, and the pages keep their own owner checks. It does not settle the Phase 9 question (§10) of whether Task Results are Knowledge or Agent Memory.

**Amendment 4 (2026-11-06): the setup line carries the token.** The setup line now ends with `--token <token>`, so one paste installs and configures, with no second paste at the hidden prompt. This reverses the rule that the token is never ordinary argv, at the owner's explicit request, for convenience. What it costs: the token, a long-lived credential limited to `task-result:create` into the owner's My Space, now sits in the shell's history, in the process list other local users can read while `configure` runs, and in terminal scrollback, and it is easy to paste somewhere by mistake. What still holds: the page shows the token only when a binding is created or rotated (the Hub keeps only its hash and cannot show it again); the CLI never prints it and never writes it into a project, revision state or output, only into the `0600` credential file; rotating or revoking on the setup page makes a leaked line useless at once; `configure` without `--token` still reads the hidden prompt or stdin, and `configure --rotate` accepts `--token` too. The setup guides tell the reader to treat the line as a secret, run it only on their own machine, and rotate if it was shown or pasted anywhere. This supersedes §4's "never as ordinary argv" and Amendment 2's "then the token at the hidden prompt".

## 3. Existing system boundaries

The existing `sources` module owns folder snapshots, SourceEntry mappings, and revisions. Keep Folder Sync's immutable snapshot/Preview/Confirm/Apply contract and SOURCE_MANAGED read-only policy unchanged. The existing My Space has an owner and lifecycle; the existing graph supports DOCUMENT and UNRESOLVED nodes, not Task nodes. Use MariaDB and Next.js; no GPU, LLM service, embeddings, Graph DB or CodeGraph required.

The feature is wired in `src/server/composition.ts`, the only composition root, and follows the Workspace shared write lock design (`docs/superpowers/specs/2026-10-07-workspace-shared-write-lock-design.md`): its writers hold the Workspace row in share mode and never take it `FOR UPDATE` (§6).

**Recorded deviations from `CLAUDE.md`** (the implementation PR records each in `CLAUDE.md`; the first is also enforced in `eslint.config.mjs`):

1. **Module:** the feature lives in a fifth module, `src/modules/task-knowledge/`, not inside `knowledge`. It is held to the same boundary as `knowledge`: no `next`, `react`, `mariadb`, `infrastructure` or `server` imports, and no import of `@/modules/sources/**`. It reaches Workspace, Source, SourceEntry and Document data only through its own ports, which the infrastructure adapter implements. Path normalization that must match Folder Sync is done in that adapter, which may use the `sources` domain; the adapter converts any `sources` error into a task-knowledge outcome.
2. **A write without a caller.** `CLAUDE.md` requires a caller for every write. `IngestTaskResultService.ingest` is the one task-knowledge entry that writes without a `CallerContext`: its authority is the export credential, which names exactly one binding and one permitted act (`task-result:create`). It is reached only from `POST /api/task-results/ingest`. Every other public method of a task-knowledge service takes a caller. A test enforces both facts, in the style of `tests/unit/share-link-single-exception.test.ts`.
3. **Phase 7:** the export credential is a non-human, credential-scoped principal. It is not a delegation of a human's identity, and it does not decide the Phase 7 Agent-identity model (§10).

## 4. User flow

1. A browser-authenticated user in an ACTIVE PERSONAL My Space creates an Export Binding for it (a label only) and a restricted credential.
2. Once per machine, the user runs the setup page's one line (each machine takes its own binding, so rotating one machine's token never stops another; the setup page says so): `npm install -g <hub>/cli/knowledge-hub.tgz` installs the CLI the Hub serves; `knowledge-hub install-agent` copies the shared Skill and the OpenCode command into the user-level directories of each tool. They then work in any project, not only the Hub repo.
3. In the same line, `knowledge-hub configure` stores, per user and outside every repo, the Hub URL (with `--allow-insecure-localhost` only for a local development server), the binding ID and the credential. It serves every project and worktree. Credential input must not appear in shell history, Agent prompts, command arguments or Git.
4. The user completes a task and invokes `/hub-export`.
5. The Agent writes the summary content (§5, Agent-authored fields) as JSON to the CLI's stdin: `knowledge-hub export --new`. The CLI mints the Task ID, sets revision 1, saves the full artifact in its own state directory, records its hash, and posts HTTPS to Knowledge Hub. The Agent never writes files outside the project and never sets identity fields. It must not invent tests, changes or references.
6. On a retryable failure the CLI keeps the saved artifact as unconfirmed and prints `knowledge-hub export --retry <taskId>`, which resends it unchanged.
7. Server derives owner and Workspace from the restricted credential and verifies current state. The server atomically persists the task, revision and its references, and replies with the result URL and the binding ID.

This MVP does not auto-detect task completion. Only completed tasks can be exported; an incomplete/failed task must not be labeled completed. `/hub-export` must not send full conversation history or hidden reasoning.

## 5. Artifact contract

**Agent-authored fields** (what the Agent pipes to the CLI): `agent`, `status: completed`, non-empty `title`, `summary`, `verification.status` (`passed`, `failed`, `not_run`, `not_applicable`); optional `completedAt` (the CLI sets the current time when it is absent; the stored artifact always has it), `verification.checks`, `findings`, `decisions`, `changes`, `references`.

**CLI-owned fields** (added by the CLI, never accepted from the Agent): `schemaVersion: 1`, `taskId` (UUIDv4), `artifactRevision` (positive integer). The binding is not an artifact field: the server takes it from the credential.

Verification is self-reported evidence, not certification by Hub. A missing check list is never read as a pass.

Reference types:
- **WIKI:** exact Source-relative path or validated Document ID.
- **CODE_FILE:** project-relative path only. No absolute path, no leading `/` or `\`, no `..` segment, no drive letter, no control characters. These lexical rules are the whole check: the path is a label, never opened by the CLI or the server, and the file need not still exist (a task may delete it). The server stores the relative path as text.
- **COMMIT:** opaque identifier, bounded length and charset.
- **PR_URL:** `https:` scheme only, no userinfo, no control characters, bounded length.

Non-WIKI references stay external and are rendered as links only when they pass the scheme rule above. No full source contents, raw terminal logs or environment variables. MVP limit: 64 KiB artifact, 32 references, bounded string fields; reject (never strip) unsafe, unknown and oversized data, without silent truncation.

**Forbidden content.** The schema is closed, so a field the contract does not name (including any secret-named one) is already rejected. In addition, the CLI refuses content that contains its own configured export token, or any of a small set of high-signal secret patterns (a PEM private-key header, an AWS access key ID `AKIA…`, GitHub tokens `ghp_…`/`github_pat_…`), and reports only which rule matched, never the value. This is a safety net, not a guarantee that every secret is detected.

**Task identity.** The CLI mints Task IDs; the Agent never does.

**Revision sequence.** The CLI keeps its state per profile: each task created under the key, with every saved revision's canonical hash, the binding it was sent under, its state, and a sticky `mayBeStored` flag (set by any send whose outcome the CLI could not trust: network error, timeout or 5xx; never cleared by a later answer). Task IDs are looked up only within the profile. Losing the state directory is harmless except that old tasks can no longer be revised from this machine (`--task` exits 2).

A saved revision is in one of three states:
- **unconfirmed:** saved, and not yet answered with 200/201 or a final rejection. This covers network errors, timeouts, 5xx, and the two recoverable rejections: 401 (fix with `configure --rotate`, then `--retry`) and 409 `TASK_ARCHIVED` (restore in My Space, then `--retry`).
- **confirmed:** the server answered 200 or 201 with the configured `bindingId`. On success the CLI prints the Task URL, the **Task ID**, and the `export --task <taskId>` command for a later update, because neither the URL nor My Space shows the CLI's Task ID.
- **rejected:** the server answered any other 4xx, or answered 200/201 with a different `bindingId` (the **response `bindingId` mismatch**: the revision is stored under the server's binding, which the CLI records as the binding the task was sent under, replacing the configured one. A later `--task` from the corrected key therefore meets the recorded-binding refusal, and the user continues with `--new`; the CLI never sends that task under a second binding). A rejected revision blocks nothing. The CLI prints why, and the next step.

Commands:
- `export --new` mints a task and saves revision 1. It is refused (exit 2) while this profile has an unconfirmed revision. The refusal lists every task with an unconfirmed revision, each with its `title`, `completedAt`, `summary` opening and `--retry` command, so the Agent can tell whether one of them is the same work (§8, Skill rule). A timeout that actually committed therefore leads to `--retry` (answered 200), not to a second Task.
- `export --retry <taskId>` resends the task's unconfirmed revision unchanged. If none is unconfirmed, it says so and exits 0.
- `export --task <taskId>` reads new content and saves revision n+1, where n is the latest revision the server is known to hold: the larger of the latest confirmed revision and the latest number reported in a 409 body, with "none known" counting as 0. If revision n+1 already exists locally as rejected, its number is reused and its record replaced. It is refused while the task has an unconfirmed revision, and refused (the **recorded-binding refusal**) when the current configuration names a different binding than the one the task was sent under.
- `export --discard <taskId>` marks the task's unconfirmed revision rejected without sending it. It is the explicit way out when an unconfirmed revision should not or cannot be sent: its binding was revoked, the key now uses another binding, or the task was archived on purpose. A revision with `mayBeStored` set (any earlier send ended in a network error, timeout or 5xx, which a proxy may return after the server committed) may already be stored on the server, even if a later send was answered with 401; the CLI says so and recommends `--retry` first to find out. Discarding never removes anything from Hub.

Every message that leaves a revision unconfirmed names the way forward and, where the forward path may not exist, `--discard` as the alternative:
- 401: "`configure --rotate <bindingId>` then `--retry`; if the binding was revoked, `--discard <taskId>`".
- 409 `TASK_ARCHIVED`: "restore it in My Space then `--retry`; if you archived it on purpose, `--discard <taskId>`".
- Recorded-binding refusal (exit 2): names both binding IDs and "`--discard <taskId>`, or reconfigure this key to the recorded binding".


The response `bindingId` mismatch is not in this list because it already rejected the revision: its message names both IDs, says the revision is stored under the server's binding, and offers `configure --rotate <configuredBindingId>` to fix the token configured for this key. Nothing is left to retry or discard, so a later automatic `--retry` cannot store the task a second time.

Server rules:
- The server accepts revision 1 only for a task it does not have, and revision n only when n = latest + 1. An exact replay of any revision it already accepted answers 200. Any other revision number answers 409 `REVISION_OUT_OF_ORDER`. The stored latest revision only moves forward.
- Same task and revision with different content answers 409 `REVISION_CONFLICT`. It arises in ordinary use when a revision whose send timed out had in fact committed, was then discarded, and its number was reused for new content; the 409's `latestRevisionNo` lets the next `--task` move past it. A late retry of an already stored revision answers 200 or `REVISION_CONFLICT`, never `REVISION_OUT_OF_ORDER`, which only means a skipped number (n > latest + 1).
- Both 409 revision bodies carry `latestRevisionNo`, the owner's own data behind a valid credential, so `--task` can continue from it. It is 0 when the task does not exist.

**Frozen revisions.** The CLI refuses to send a saved revision whose file no longer matches its recorded hash. The hash lives in the same user-writable state directory, so this catches accidental edits, not deliberate tampering; `REVISION_CONFLICT` and `REVISION_OUT_OF_ORDER` on the server are the real backstop.

## 6. Project Binding / security

**Binding** holds `ownerUserId`, `workspaceId` (the owner's My Space), a non-sensitive `label`, `status` (`ACTIVE` / `REVOKED`), and timestamps. The Workspace is fixed when the binding is created and never changes. Owner is held once on the binding and is the only owner record for its Task Results. The binding names no Source: Task Results never write to a Source, and Wiki references are resolved across the Workspace's synced folders (§7). Local absolute paths are never sent to Hub.

**Credentials:** each binding has at most one active credential, high-entropy (`randomBytes(32)`), scoped only to `task-result:create` for that binding, with no expiry (rotation is the remedy). The server stores its SHA-256 hash, never the plaintext. The token is shown once in the browser-authenticated creation or rotation response, with `Cache-Control: no-store`. **Rotation** issues a new token and revokes the previous one in one transaction; the old token fails on its next use. **Revoking** a binding revokes its credential. Credentials cannot confer generic `document.write` or `source.manage`.

**Local storage:** the CLI keeps one credential file per binding under the user's configuration directory, created with mode `0600` on POSIX. On Windows, where `chmod` does not apply, the file lives under the user profile and the CLI prints a warning that protection depends on the profile's ACL. Profiles reference a binding; they do not copy its credential, so one rotation is entered once (`knowledge-hub configure --rotate <bindingId>`) and every profile that uses the binding picks it up. No OS keychain integration in MVP; no new runtime package. The CLI accepts the token through a hidden interactive prompt, stdin or, since Amendment 4, `--token`.

**Local config** is per user, keyed by profile: `default`, or `--profile <name>` for another binding. Every project and worktree uses it; no project is configured on its own. The CLI checks the `bindingId` in every 200/201 response against the configured one and stops with an error if they differ (a token pasted under the wrong binding).

**Archival and revocation.** Task Result lifecycle is `ACTIVE` / `ARCHIVED`, as everywhere in the product; there is no hard delete. The owner may archive and restore a Task Result from My Space; archiving an archived task or restoring an active one is a no-op, as for documents. A new revision into an ARCHIVED task is refused (409, `TASK_ARCHIVED`): a credential cannot change a lifecycle the owner set. An exact replay of a revision already accepted still answers 200, because it changes nothing. Revoking a binding stops new ingestion immediately; existing Task Results remain readable by their owner and show the binding's revoked status.

**Write checks.** Each ingest checks credential status, binding status, that the binding's Workspace is `PERSONAL` and `ACTIVE`, and that the binding owner is the Workspace owner. No Source is consulted: Task Results never write to one.

**Lock order.** Every task-knowledge writer follows the global order Snapshot → Source → Workspace → deeper, and takes the Workspace row in share mode (`lockSharedById`), never `FOR UPDATE`:
- **Binding create:** lock the Workspace shared and check its kind, status and owner on the locked row; then insert. The binding's foreign key to the Workspace takes a share lock on that row, which the writer already holds.
- **Ingest:** hash the token and read credential and binding without a lock, to learn the Workspace. Lock the Workspace shared and check its kind, status and owner on the locked row. Lock the binding row in share mode and re-read the credential, then check both. Lock the existing `task_results` row `FOR UPDATE`, if there is one, and check its lifecycle and latest revision. Resolve references with non-locking reads (§7). Write.
- **Revoke and rotate:** lock the Workspace shared, then the binding row `FOR UPDATE`, then change binding and credential rows. Rotate refuses a `REVOKED` binding (409 `BINDING_REVOKED`), so a live credential never belongs to a revoked binding. A revoke that commits first is seen by ingest's re-read under the binding lock; a revoke that waits commits after the ingest. In both cases no ingest commits after the revoke has committed.
- **Archive and restore:** lock the Workspace shared, then the `task_results` row `FOR UPDATE`.

Reference resolution reads Sources, SourceEntries and Documents without locks; a Folder Sync Apply running at the same time changes only which documents a path matches, which is a snapshot judgement either way. All transactions run READ COMMITTED on the composition root's pool (its `initSql` sets the level; a pool built any other way would not), so each re-read under a lock sees the latest committed row.

**Foreign keys** are limited to rows that never take part in Folder Sync writes, so they add no lock waits against an Apply: credential → binding, binding → Workspace (covered by binding create's order above), task → binding, revision → task, reference → task. `task_result_references.resolved_document_id` has **no** foreign key: documents are never hard-deleted, and availability is re-checked on every read.

Never accept caller-provided Owner, Workspace or Source identity. Team or cross-workspace writes are forbidden.

## 7. Ingestion and references

**Authentication.** The export credential travels in `X-Knowledge-Hub-Export-Token`. It does not use `Authorization`, because the site password (HTTP Basic) acts on that header. `POST /api/task-results/ingest` is the only task-knowledge route exempt from the site-password gate and the Google session gate, exempt by exact pathname: no trailing slash, no case folding, no prefix. The route authenticates solely by the export credential. A custom header also forces a CORS preflight; the route answers that preflight with 405 and no `Access-Control-Allow-*` header, so a cross-site browser request cannot proceed. This is a deliberate change to the security boundary; `docs/superpowers/specs/2026-10-25-google-login-design.md` gets a pointer to this section.

**Responses.** `POST /api/task-results/ingest`:
- 201: new revision created. Body `{ taskResultId, revisionNo, bindingId, url }`.
- 200: exact replay of an accepted revision. Same body.
- 400: malformed JSON.
- 401: credential missing, unknown or revoked (including through binding revocation, which revokes it).
- 403: credential is live, but its Workspace no longer allows the write.
- 405: any other method, including `OPTIONS`. The route exports explicit handlers for every other method, so Next.js does not answer `OPTIONS` itself.
- 409: `REVISION_CONFLICT` (same revision, different content) or `REVISION_OUT_OF_ORDER` (§5), both with `latestRevisionNo`; or `TASK_ARCHIVED`.
- 413: body over 64 KiB, measured on the bytes actually read, not on `Content-Length`.
- 422: valid JSON that fails the artifact contract, including an unsupported `schemaVersion`.
- 500: any other unexpected error; nothing is reported as success. The CLI treats it as retryable, which is safe because ingest is idempotent.
- 503: retryable: lock wait timeout or deadlock (both already mapped to `WorkspaceBusyError` by `mapDatabaseError`; the transaction rolled back), or no database connection could be obtained: the task-knowledge unit of work catches a failure of `pool.getConnection()` (which the existing unit of work leaves outside `mapDatabaseError`) and throws a named `DatabaseUnavailableError`, which the route maps to 503. Nothing has been written at that point.

**Order.** The size limit comes first, because the route must stop reading (413). The credential is judged next (401, 403), and only a caller holding a live one gets 400 or 422: a stranger learns nothing about the contract, and nothing it sends reaches the parser (pre-merge review, 2026-11-05).

Every response, including 405, is private and uncached (`Cache-Control: private, no-store`).

**Identity and concurrency.** Task identity is unique by `(bindingId, taskId)`; revision is unique by `(taskResultId, artifactRevision)`. The owner is reached through the binding, so it is not part of the key. Concurrent POSTs cannot produce duplicate tasks or partial revision/reference rows. A new revision retains prior revisions.

**References.** Explicit Wiki resolution uses **only** an exact sourcePath matched across the binding Workspace's ACTIVE `FOLDER_SYNC` Sources, or a validated Document ID of an ACTIVE document whose ACTIVE Source lies in that Workspace. A path matching documents in more than one Source is AMBIGUOUS. The sourcePath is normalized exactly as Folder Sync normalized `source_entries.source_path` (`normalizeImportPath`), and compared byte-exactly; this happens in the infrastructure adapter, so the two can never drift. A path that passed the contract's lexical check (§5) but that `normalizeImportPath` still rejects (for example `.` or `./`) is stored as UNRESOLVED; traversal, absolute paths, drive letters and control characters never get this far, because the contract rejects the whole artifact (422). Never use existing Wiki Link title ranking to assert a unique Task reference. Only ACTIVE Source, SourceEntry and Document are eligible. Missing: UNRESOLVED; multiple/ambiguous: AMBIGUOUS; later revoked/archived: UNAVAILABLE. Save the original locator and resolved Document ID. Following a reference always rechecks live authorization/lifecycle. A stored historical ID is not a capability.

## 8. My Space UI

A small Task Results list/detail view within My Space, reached from a `Tasks` row in My Space's primary navigation (Amendment 3). Show title, agent, completedAt, summary, findings, decisions, changes, verification and checks, linked Wiki/external references, lifecycle, binding status, and revision history, with archive and restore actions for the owner. Existing Folder Sync, Document Graph, and Agent Context APIs remain unchanged. Task Result is a distinct Knowledge Asset, not a Wiki Document. All text, including Markdown- or HTML-looking content, renders as inert text.

**Skill rule for a refused `--new`.** When `export --new` exits 2 because earlier exports are unconfirmed, the Agent runs each printed `--retry` command. If a `--retry` fails, it reports the CLI's message and next step to the user and stops. After the retries succeed, the Agent judges whether one of the listed tasks describes the same work as the task it was asked to export. It judges by meaning (what was done, in which area, with what outcome), not by equal titles or times, which differ between two summaries of one task. If it is the same work, it reports the retried URL and stops; it does not run `--new` again. Only for clearly different work does it run `--new` with the new content. When unsure, it asks the user.

**Skill rule for `--discard`.** The Agent runs `--discard` only when the user explicitly asks to drop that export. It never discards to unblock `--new` on its own; it reports the CLI's printed options to the user instead.

## 9. Failures and tests

- Agent has partial context: summarize only supported facts, do not infer passing tests.
- Export aborted/offline: the saved revision is retained as unconfirmed; retry is explicit (`export --retry`). No background daemon in MVP.
- Timeout that actually committed, then `/hub-export` again: `--new` is refused and names the pending task; `--retry` answers 200; the Agent stops there for the same task (§8).
- Revision finally rejected (403, 413, 422, `REVISION_CONFLICT`, `REVISION_OUT_OF_ORDER`): it becomes rejected and blocks nothing; `--task` continues from the server's `latestRevisionNo` where one is given. An unconfirmed revision that should never be sent (revoked binding, key moved to another binding, task archived on purpose) is dropped with `--discard`, which every such message names; the Agent discards only on the user's request.
- Saved revision edited by hand or by the Agent: the CLI refuses to send it.
- Changed content for an exported task: `export --task <taskId>`, with the Task ID the CLI printed on success, creates the next revision after the latest one the server is known to hold (§5); prior revisions remain.
- Skipped revision number: 409 `REVISION_OUT_OF_ORDER`; a late retry of a stored revision answers 200 or `REVISION_CONFLICT`; the latest revision never moves backwards.
- Archived task: a new revision is refused until the owner restores it; an exact replay still answers 200.
- Replay/concurrent upload: unique constraints + transaction enforce idempotency.
- Revocation concurrent with ingest: the binding lock and the re-read under it decide; no commit after revocation wins.
- Folder Sync Apply in the binding's Workspace while an ingest runs: both hold the Workspace shared, so neither waits on the other.
- Workspace revoked/archived or credential revoked: reject without fallback to another Workspace.
- Source moved/archived or paths collide: preserve original reference, do not guess.
- Data policy: reject overly broad content, secret-like data and traversal paths; do not log secrets.
- Both Claude Code and OpenCode use the same Schema and the same `/hub-export` workflow, from one shared Skill source, in projects other than the Hub repo.

Definition of done: one manual command in either tool, in an ordinary project, produces a factual Task Result in My Space, handles failure safely, and provides accurate explicit Wiki references with no cross-workspace disclosure. Unit, integration, middleware and E2E testing required.

## 10. Deferred

Automatic Hook/Plugin, persistent retry Outbox, MCP, complete conversation history, Team auto-export, semantic relations, CodeGraph, Task nodes in the general Graph, PDF/binary storage, historical Session backfill, automatic Wiki updates, credential expiry and OS keychain storage.

**Agent-offered export (drafted 2026-11-05, not built).** Instead of a hook, the shared Skill could have the Agent *offer* an export at the end of a completed task; only a clear yes sends, through the unchanged §4 workflow. Drafted rules: offer only where a new `knowledge-hub status` exits 0 (binding and credential present; prints no credential); "completed" means the user asked for work, the Agent did it in this conversation, it is ending its turn reporting it done (not asking, blocked or failing), and no check it ran is left failing; one question naming the title, silence or anything unclear is a no; at most once per task, never again after a no; a follow-up on an exported task offers `--task`, never a second `--new`. Claude Code loads Skills on its own judgement; OpenCode support is unverified. Build it with its own spec amendment when the manual trigger has been used for real.

**Phase 7 relation.** The export credential is a non-human principal limited to `task-result:create`. The roadmap's Phase 7 open question (whether an Agent acts as a delegated human identity or as a generalised Principal) remains open. This MVP does not answer it, and does not create a precedent for it: the export credential is a narrow, revocable write grant and carries no human's identity. Phase 7 must decide the general model; the roadmap records this dependency.

**Phase 9 relation.** The roadmap's Phase 9 places Agent Memory outside canonical Knowledge. Task Results sit close to that line: they are written by an Agent's summary, not by a human author. They stay on the Knowledge side here because a human triggers each export, owns it in My Space, and reads it as a reviewable record, and because nothing reads them back into an Agent (no MCP, no retrieval). If a later phase lets Agents read Task Results as memory, that phase decides whether they move to the Agent Memory side. Starting this narrow slice before Phase 7–9 is the separate decision the roadmap asks for when later-phase work starts out of order; Task 10 records it there.

Later work must be designed separately and aligned with the existing Phase 7–9 Roadmap.
