# Task Knowledge Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable a developer to invoke `/hub-export` in Claude Code or OpenCode, in any project, have the Agent summarize one completed task, and securely save a versioned Task Knowledge asset with exact Wiki links to the owner's My Space.

**Architecture:** A shared Skill (with an OpenCode command adapter), installed per user, instructs the Agent to pipe the task summary to a portable Node CLI. The CLI adds the identity fields, freezes each revision in its own state directory, tracks which revisions the server confirmed, and posts to an isolated Next.js Task Ingestion API using a limited, revocable project credential sent in a dedicated header. A dedicated `task-knowledge` module persists immutable revisions and source-scoped references through its own ports, without altering Folder Sync, the existing Document Graph or Wiki.

**Tech Stack:** Next.js 15, TypeScript 5, Node >=20.19, MariaDB 10.11, existing Vitest/integration harness and Playwright, Claude Code Skill, OpenCode command. Avoid new runtime packages unless a test demonstrates an unavoidable need.

**Spec:** `docs/superpowers/specs/2026-11-04-task-knowledge-export-design.md`

## Global Constraints

- **Trigger:** manual `/hub-export` only; no Stop/Idle Hook, background daemon or persistent Outbox.
- **Destination:** ACTIVE PERSONAL My Space owned by the credential's binding owner, never Team Workspace.
- **Scope:** a binding fixes one ACTIVE FOLDER_SYNC Source at creation; nothing in an artifact can change it. Workspace and owner are derived, never stored on Task rows. The artifact carries no binding field.
- **Summarization:** the Agent does it using current task context; Hub runs no LLM. Full chat, thinking, terminal logs and source bodies must not be uploaded.
- **Identity:** the CLI owns `schemaVersion`, `taskId` and `artifactRevision`, freezes every saved revision by hash, and records which revisions the server confirmed. The Agent only pipes content on stdin.
- **Revision sequence (design §5):** the server accepts revision 1 only for a new task and n = latest + 1 otherwise; an exact replay of an accepted revision is 200; anything else is 409 `REVISION_OUT_OF_ORDER`; both revision 409s carry `latestRevisionNo`; the latest revision only moves forward. The CLI's revision states are unconfirmed, confirmed and rejected; only unconfirmed blocks.
- **References:** WIKI is exact source-relative path or validated Document ID within the binding Source, normalized exactly as Folder Sync does; no title/fuzzy ranking, cross-workspace discovery, or semantic extraction.
- **Payload:** schemaVersion=1, status=completed, <=64 KiB UTF-8 (counted on bytes read), <=32 references. Verification is recorded, not certified.
- **Persistence:** one Task per `(bindingId,taskId)`; immutable revision per `(taskResultId,artifactRevision)`; atomic transaction.
- **Locking (design §6):** writers hold the Workspace row shared (`lockSharedById`), never `FOR UPDATE`, in the global order Snapshot → Source → Workspace → deeper. Binding create: Source share mode → Workspace shared. Ingest: Workspace shared → binding share mode → `task_results` row `FOR UPDATE`. Revoke/rotate: Workspace shared → binding `FOR UPDATE`. Archive/restore: Workspace shared → `task_results` row `FOR UPDATE`. Source is read without a lock. `tests/unit/workspace-lock-modes.test.ts` must keep passing unchanged.
- **Credentials:** independent restricted export credential in `X-Knowledge-Hub-Export-Token`; hash stored server-side; at most one active per binding; no expiry; interactive setup; no token in CLI argv, prompts, logs or Git. Revocation and rotation are enforced live.
- **Caller rule:** `IngestTaskResultService.ingest` is the only public task-knowledge service method without a `CallerContext`, and the ingest route is its only caller (recorded deviation, test-enforced). Caller-less helpers live under `application/internal/` and are not entries.
- **Module boundary:** `src/modules/task-knowledge/**` may not import `next`, `react`, `mariadb`, `infrastructure`, `server`, or `@/modules/sources/**`. Enforced by ESLint in Task 2.
- **Composition:** all services are wired in `src/server/composition.ts`; no second composition root.
- **Compatibility:** preserve SOURCE_MANAGED read-only, Folder Sync Preview/Apply, document graph and current Agent Context contracts.
- **Workflow:** TDD for each task, one focused test run plus full relevant suite, one small commit per independently testable task; run `make verify` and DB-backed tests before PR. Quote bracketed paths in shell commands (zsh treats `[...]` as a glob). `git add` names explicit paths, never a whole `docs` or `tests` directory.

## File/ownership map

| Unit | New / changed files | Responsibility |
| --- | --- | --- |
| Contract | `src/modules/task-knowledge/domain/task-artifact.ts`, `task-references.ts`, `task-errors.ts`; shared fixtures `tests/fixtures/task-artifact/**` | Pure parsers for Agent content and full artifact, canonical hashing, reference validation, error codes |
| Ports | `src/modules/task-knowledge/ports/{task-export-store,unit-of-work,lookups}.ts` | `TaskExportStore`, `TaskKnowledgeUnitOfWork`, and local lookup ports (local models, no sources imports) |
| Storage | `src/infrastructure/database/mariadb/migrations/032-task-knowledge-export.ts`, `migrations/index.ts`, `repositories/task-knowledge.ts`, `task-knowledge-transaction.ts` | Tables, repository, lookup adapters over the existing repository factory (including Folder Sync path normalization), isolated transaction |
| Boundary | `eslint.config.mjs`, `CLAUDE.md`, `tests/unit/task-knowledge-boundary.test.ts`, `tests/unit/task-export-single-exception.test.ts` | Enforce the module boundary and the one caller-less write; record the three deviations |
| Binding | `src/modules/task-knowledge/application/manage-export-binding.ts`, `src/app/api/workspaces/[workspaceId]/task-export-bindings/route.ts`, `.../[bindingId]/route.ts`, `.../[bindingId]/credentials/route.ts`, `src/app/w/[workspaceId]/tasks/setup/page.tsx`, `src/components/task-knowledge/task-export-setup.tsx` | Browser-authenticated create/list/revoke/rotate, one-time token display, Source chooser |
| Ingestion | `src/modules/task-knowledge/application/ingest-task-result.ts`, `src/app/api/task-results/ingest/route.ts`, `src/lib/auth-paths.ts`, `src/lib/site-password.ts` | Credential auth, lock order, revision sequence, HTTP contract, exact-path exemption |
| Resolution | `src/modules/task-knowledge/application/internal/resolve-task-references.ts` | Exact scoped Wiki lookups, external locators, live availability (caller-less helper, not an entry) |
| Read & UI | `src/modules/task-knowledge/application/{read-task-results,manage-task-lifecycle}.ts`, `src/app/w/[workspaceId]/tasks/{page.tsx,[taskResultId]/page.tsx}`, `src/app/api/workspaces/[workspaceId]/task-results/[taskResultId]/lifecycle/route.ts`, `src/components/task-knowledge/{task-list,task-detail}.tsx`, small link in `src/components/knowledge/personal-home.tsx` | Personal-only browsing, archive and restore; no new top-level sidebar |
| CLI | `tools/knowledge-hub/package.json`, `bin/knowledge-hub.mjs`, `src/{configure,export,state,project-config,secret-scan,install-agent}.mjs` | Per-project configuration, per-binding credential, frozen revision state, POST, agent-file installation |
| Agent | `tools/knowledge-hub/agent/hub-export/SKILL.md`, `tools/knowledge-hub/agent/opencode/hub-export.md`, `docs/task-export-setup.md`, `docs/task-export-setup.zh-TW.md` | One shared workflow source, installed per user by the CLI |
| Docs | `docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md`, `docs/superpowers/specs/2026-10-25-google-login-design.md` (pointer), `README.md` and `README.zh-TW.md` (canonical docs tables) | Record scope, the boundary change and the Phase 7 dependency |

Paths above are the intended interfaces, not a license to refactor unrelated modules. The task-knowledge transaction composes the existing MariaDB repository factory for Workspace/Source/Entry/Document lookups through its adapters, and its own store for Task rows; do not widen existing SourceUnitOfWork or document mutation permissions merely to add Task features.

## Review Focus: five easy-to-miss failure classes

1. **Duplicate manual export after timeout:** a committed-but-timed-out `--new` cannot be followed by a second `--new`; `--retry` resends the frozen revision and gets 200; revisions arrive only in sequence (Tasks 4, 7).
2. **Revoked binding or credential during a write:** no successful post-revocation commit; ingest, revoke and rotate meet on the binding row lock and re-read under it, with the Workspace held shared (Tasks 3, 4).
3. **Wiki path collisions or traversal:** no best-guess match; no source-root escape, no cross-source/document leakage; normalization identical to Folder Sync (Tasks 1, 2, 5).
4. **Two worktrees/projects on one machine:** the CLI never uses a binding from a different project key except through explicit `configure --from`, and checks the server's `bindingId` (Task 7).
5. **Agent-invented verification / secret-bearing output / unsafe links:** missing checks never become PASS, secret-named fields and high-signal secret patterns are rejected without echoing values, and unsafe `href` schemes are never rendered (Tasks 1, 7, 9).

---

### Task 1: Pure Task Artifact Contract and Reference Validation

**Files:**
- Create: `src/modules/task-knowledge/domain/task-artifact.ts`
- Create: `src/modules/task-knowledge/domain/task-references.ts`
- Create: `src/modules/task-knowledge/domain/task-errors.ts`
- Create: `tests/fixtures/task-artifact/content/{valid-minimal,valid-full}.json`, `tests/fixtures/task-artifact/content/invalid/*.json`, `tests/fixtures/task-artifact/artifact/{valid,invalid/*}.json` (one file per rejection case below)
- Test: `tests/unit/task-artifact.test.ts`
- Test: `tests/unit/task-references.test.ts`

**Interfaces:**
- `type TaskContentV1` (Agent-authored): `agent: 'claude-code' | 'opencode'`, `status: 'completed'`, `title`, `summary`, `completedAt`, `verification: { status: 'passed' | 'failed' | 'not_run' | 'not_applicable'; checks?: string[] }`, optional `findings`, `decisions`, `changes` string arrays and `references: TaskReferenceInput[]`.
- `type TaskArtifactV1 = TaskContentV1 & { schemaVersion: 1; taskId: string; artifactRevision: number }`. No binding field.
- `parseTaskContent(raw: unknown): TaskContentV1` rejects any CLI-owned field (`schemaVersion`, `taskId`, `artifactRevision`) and any binding field. `parseTaskArtifact(raw: unknown): TaskArtifactV1`. `canonicalTaskHash(artifact: TaskArtifactV1): string` (64-char lowercase SHA-256 hex).
- `validateWikiReferencePath(path: string): string` rejects absolute paths, a leading `/` or `\`, traversal, drive letters and control chars, and returns the input unchanged otherwise. It does **not** normalize: normalization that must match Folder Sync happens in the Task 2 adapter.
- `validateCodeFilePath(path)` (same rules), `validatePrUrl(value)` (https only, no userinfo, no control chars, bounded length), `validateCommitId(value)`; `type TaskReferenceInput` discriminated by `type: 'WIKI' | 'CODE_FILE' | 'COMMIT' | 'PR_URL'`.
- `TaskArtifactError(code, message)`; no raw payload in exception messages.

- [ ] **Step 1: Write failing tests from the requirements.** The fixtures are the single shared corpus; Task 7's CLI tests reuse them.
  - Content: `valid-minimal.json` (no `checks`, no optional arrays) and `valid-full.json` are accepted; accepted output has no unknown keys; content containing `taskId`, `artifactRevision`, `schemaVersion` or `bindingId` is rejected.
  - Artifact: a content fixture plus CLI fields is accepted; missing `taskId`, non-UUID `taskId`, `artifactRevision: 0`, non-integer revision and `schemaVersion: 2` are rejected.
  - Verification: `checks` omitted is accepted and is never read as passed; fake statuses (`PASS`, `ok`) rejected.
  - Required fields: `status: 'running'`, invalid `completedAt`, empty `title`, rejected.
  - Bounds: 65-KiB UTF-8 body, 33 references, oversized single string, rejected; exactly 32 references accepted.
  - Secret-named fields (`token`, `password`, `Authorization`) rejected; the error message does not echo the value.
  - Hash: identical for objects with reordered keys; changes when summary changes; 64 lowercase hex characters.
  - WIKI path: accepts `architecture/auth.md`; rejects `../secrets.md`, `architecture/../../x.md`, `/tmp/note.md`, `\share\note.md`, `C:\\secret.md`, paths with NUL or newline.
  - CODE_FILE path: accepts `src/lib/x.ts`; rejects absolute paths, a leading `\`, `..` segments (even when they would normalize inside the root), drive letters, control chars.
  - PR_URL: accepts `https://github.com/org/repo/pull/1`; rejects `javascript:...`, `data:...`, `http://...`, `https://user:pass@host/...`, control chars, over-length strings.
  - COMMIT: accepts a hex SHA; rejects over-length or whitespace-containing values.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-artifact.test.ts tests/unit/task-references.test.ts`; expect FAIL (modules not present).
- [ ] **Step 3: Implement** with strict typed, bounded runtime validation and canonical stable serialization before SHA-256. `checks` stays optional and is never inferred from status. Import nothing from `sources`.
- [ ] **Step 4: Re-run** the same command; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/domain tests/unit/task-artifact.test.ts tests/unit/task-references.test.ts tests/fixtures/task-artifact && git commit -m 'feat: define task export artifact contract'`.

### Task 2: Module Boundary, MariaDB Tables, Store, and Task-Specific Transaction

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `CLAUDE.md` (fifth module, its boundary, and design §3 deviations 1 and 3)
- Create: `src/infrastructure/database/mariadb/migrations/032-task-knowledge-export.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Create: `src/modules/task-knowledge/ports/task-export-store.ts`
- Create: `src/modules/task-knowledge/ports/unit-of-work.ts`
- Create: `src/modules/task-knowledge/ports/lookups.ts`
- Create: `src/infrastructure/database/mariadb/repositories/task-knowledge.ts`
- Create: `src/infrastructure/database/mariadb/task-knowledge-transaction.ts`
- Test: `tests/unit/task-knowledge-boundary.test.ts`
- Test: `tests/integration/task-export-storage.test.ts`

**Interfaces:**
- `TaskExportStore`:
  - Bindings: `insertBinding(...)`, `getBinding(id)`, `lockBindingShared(id)`, `lockBindingForUpdate(id)`, `listBindings(ownerId, workspaceId)` (joins Source to derive Workspace), `revokeBinding(id)`.
  - Credentials: `insertCredential(...)`, `rotateCredential(bindingId, newHash)` (revokes the active credential and inserts the new one), `findCredentialByHash(hash)`, `revokeCredentialsForBinding(id)`.
  - Tasks: `findTask(bindingId, taskId)`, `lockTaskForUpdate(taskResultId)`, `insertTaskIfAbsent(bindingId, taskId)` (`INSERT … ON DUPLICATE KEY UPDATE id = id`, then selects the row's ID; never throws on the unique key, because `mapDatabaseError` would turn `ER_DUP_ENTRY` into a generic `IntegrityViolationError`). It returns only the ID, never "inserted or not": the pool leaves the connector's `foundRows` default (true), so `affectedRows` is 1 for a fresh insert and for an existing row alike, and must not be branched on, `advanceLatestRevision(taskResultId, revisionNo)` (only ever increases), `getRevision(taskResultId, revisionNo)`, `insertRevision(...)`, `insertReferences(...)`, `listTasks(ownerId, workspaceId, { lifecycle, cursor, limit })`, `getTaskDetail(taskResultId)`, `setTaskLifecycle(taskResultId, lifecycle, actorId)`.
- Local lookup ports in `ports/lookups.ts` (no `sources` import):
  - `TaskWorkspaceLookup`: `lockSharedById(workspaceId)` → `{ workspaceId, kind, status, ownerUserId } | null`. There is no exclusive lock in this port.
  - `TaskSourceLookup`: `getById(sourceId)` (non-locking, used by ingest) and `lockSharedById(sourceId)` (`LOCK IN SHARE MODE`, used only by binding create), both → `{ sourceId, workspaceId, sourceType, status }`. No owner field: Sources have none.
  - `TaskEntryLookup`: `findActiveEntriesByPath(sourceId, rawPath)` → `{ kind: 'FOUND', candidates } | { kind: 'INVALID_PATH' }`. The adapter normalizes `rawPath` with `normalizeImportPath` (from the `sources` domain, allowed in infrastructure), converts its `INVALID_SOURCE_PATH` error into `INVALID_PATH`, and compares `source_entries.source_path` byte-exactly.
  - `TaskDocumentLookup`: `getState(documentId)` → `{ documentId, sourceId, status }`.
- `TaskKnowledgeRepositories = { taskExports; workspaces; sources; entries; documents }` using the types above.
- `TaskKnowledgeUnitOfWork.run<T>(fn: (r: TaskKnowledgeRepositories) => Promise<T>): Promise<T>`; one MariaDB connection and transaction for all of them, taken from the composition root's pool (its `initSql` sets READ COMMITTED, which the lock protocol relies on). It never builds its own pool. Errors pass through `mapDatabaseError`, so lock wait timeouts and deadlocks surface as `WorkspaceBusyError`.

- [ ] **Step 1: Write failing tests.**
  - Boundary (`tests/unit/task-knowledge-boundary.test.ts`, using `ESLint.lintText` with a `filePath` under `src/modules/task-knowledge/`, as `tests/unit/linear-remediation.test.tsx` does): importing `mariadb`, `@/infrastructure/...` or `next/server` reports the `no-restricted-imports` rule; importing `@/modules/sources/domain/import-path` reports that rule with the task-knowledge message; from a file at `src/modules/task-knowledge/application/internal/x.ts`, importing `../../../sources/domain/import-path` is also reported; importing `@/modules/task-knowledge/ports/lookups` reports nothing.
  - Migration up creates all five tables; FK constraints prevent orphan revisions and references.
  - Unique `(binding_id, task_id)` and `(task_result_id, revision_no)` reject duplicates. `task_results` has no `owner_user_id`, `workspace_id` or `status` column; it has `lifecycle` (`ACTIVE`/`ARCHIVED`) with `archived_by`/`archived_at` under the same provenance check style as other lifecycle tables.
  - Collation: `task_id`, `label` and reference `locator` columns compare case-sensitively (`utf8mb4_bin`); `abc` and `ABC` are distinct task IDs.
  - One active credential: inserting a second `ACTIVE` credential for a binding fails on the unique index over the generated column `active_binding_id` (`binding_id` when `status = 'ACTIVE'`, else `NULL`); revoked credentials do not collide.
  - Rotating a credential revokes the old hash in the same transaction; the old hash is rejected on the next lookup.
  - Revoking a binding and its credentials is atomic.
  - `advanceLatestRevision` never lowers the stored value.
  - Rolling back after reference insertion leaves no Task, revision or reference rows.
  - `TaskEntryLookup` finds an entry stored as `architecture/auth.md` from `architecture\auth.md`, `./architecture/auth.md` and `architecture//auth.md`; does not find it from `Architecture/auth.md`; returns `INVALID_PATH` (not a thrown sources error) for a path `normalizeImportPath` rejects.
  - `tests/unit/workspace-lock-modes.test.ts` still passes unchanged.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-knowledge-boundary.test.ts tests/unit/workspace-lock-modes.test.ts` and `npm run test:integration -- tests/integration/task-export-storage.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** migration 032. Declare `utf8mb4_bin` explicitly on every identifier and locator text column (table defaults are `utf8mb4_unicode_ci`).
  - `task_export_bindings`: owner, source, label, status, timestamps. `source_id` is never updated.
  - `task_export_credentials`: `token_hash` binary with unique index, `binding_id`, `status`, `revoked_at`, generated `active_binding_id` with a unique index.
  - `task_results`: `binding_id`, `task_id`, lifecycle with provenance, `latest_revision_no`.
  - `task_result_revisions`: `task_result_id`, `revision_no`, canonical JSON, content hash.
  - `task_result_references`: locator, type, optional resolved Document ID, `RESOLVED | UNRESOLVED | AMBIGUOUS | UNAVAILABLE`, ordinal.
  - Lookup and list indexes.
  - Foreign keys, exactly: credential → binding, binding → `knowledge_sources`, task → binding, revision → task, reference → task. No foreign key on `task_result_references.resolved_document_id` (design §6).
  Implement the store, the lookup adapters and the dedicated UoW without expanding Source domain write APIs.
- [ ] **Step 4: Update** `eslint.config.mjs` with a `src/modules/task-knowledge/**` block: `moduleBoundaryRestrictions` plus its own sources rule over `["@/modules/sources/**", "**/modules/sources/**", "../sources/**", "../../sources/**", "../../../sources/**"]`, message "Task knowledge must reach Sources through its lookup ports; it must not depend on the Sources module." Add the fifth module, its boundary, and design §3 deviations 1 and 3 to `CLAUDE.md`.
- [ ] **Step 5: Re-run** both test commands and `make lint`; expect PASS.
- [ ] **Step 6: Commit** `git add eslint.config.mjs CLAUDE.md src/infrastructure/database/mariadb src/modules/task-knowledge/ports tests/unit/task-knowledge-boundary.test.ts tests/integration/task-export-storage.test.ts && git commit -m 'feat: persist task export bindings and results'`.

### Task 3: Browser-Authenticated Binding, Credential Rotation and Restricted Credential

**Files:**
- Create: `src/modules/task-knowledge/application/manage-export-binding.ts`
- Create: `src/app/api/workspaces/[workspaceId]/task-export-bindings/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/task-export-bindings/[bindingId]/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/task-export-bindings/[bindingId]/credentials/route.ts`
- Create: `src/app/w/[workspaceId]/tasks/setup/page.tsx`
- Create: `src/components/task-knowledge/task-export-setup.tsx`
- Modify: `src/server/composition.ts` (wire `ManageExportBindingService`)
- Test: `tests/integration/task-export-binding.test.ts`
- Test: `tests/unit/task-export-binding-route.test.ts`

**Interfaces:**
- `ManageExportBindingService.create(caller, { workspaceId, sourceId, label })` → `{ bindingId, token }`; `list(caller, workspaceId)` excludes credential material; `revoke(caller, bindingId)`; `rotate(caller, bindingId)` → `{ token }`.
- Routes: `POST/GET /api/workspaces/:workspaceId/task-export-bindings`; `DELETE /api/workspaces/:workspaceId/task-export-bindings/:bindingId`; `POST /api/workspaces/:workspaceId/task-export-bindings/:bindingId/credentials` (rotate). All use `establishTrustedCaller()`. Create checks PERSONAL ACTIVE Workspace owned by the caller and an ACTIVE `FOLDER_SYNC` Source in that Workspace. Tokens come from `randomBytes(32)`, are hashed server-side, and are returned once with `Cache-Control: no-store`.
- Locks (design §6): create locks the Source in share mode (`sources.lockSharedById`) and checks it on the locked row, then the Workspace shared, then inserts. Revoke and rotate lock the Workspace shared, then the binding row `FOR UPDATE`, before changing binding or credential rows. Rotate on a `REVOKED` binding answers 409 `BINDING_REVOKED` and inserts nothing.

- [ ] **Step 1: Write failing tests.**
  - A My Space owner selects an ACTIVE FOLDER_SYNC Source, creates a binding, sees the token once, and later lists bindings without any token.
  - Rotation returns a new token; the previous token fails on its next use; the list still shows one active credential. Rotating a revoked binding answers 409 `BINDING_REVOKED` and leaves no active credential.
  - Create while a Folder Sync Apply holds the Source `FOR UPDATE` waits on the Source before taking the Workspace (no Workspace → Source order).
  - Revocation makes the credential unusable on the next read.
  - Denied: Team Workspace; viewer or other user; Source from a different Workspace; non-FOLDER_SYNC Source; archived Source or Workspace; forged caller identity; rotation or revoke by a non-owner.
  - Response bodies, list responses and logs never expose a token except in the one-time create/rotate response.
  - No route changes a binding's `sourceId`.
  - Route unit: the rotate route maps `BINDING_REVOKED` to 409 with that code and `Cache-Control: no-store`.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-binding.test.ts` and `npx vitest run --config vitest.config.ts tests/unit/task-export-binding-route.test.ts tests/unit/workspace-lock-modes.test.ts`; expect FAIL for the first two.
- [ ] **Step 3: Implement** the service with the lock order above and the owner/Source checks, server-generated binding ID, credential hash, rotation and revocation. Add a minimal setup screen that lists the authenticated Sources and displays the token exactly once, with no persistent browser storage, plus the CLI install and configure commands to copy. Routes use the project's established HTTP identity and error patterns and never accept browser-provided caller grants.
- [ ] **Step 4: Re-run** all three; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application/manage-export-binding.ts 'src/app/api/workspaces/[workspaceId]/task-export-bindings' 'src/app/w/[workspaceId]/tasks/setup' src/components/task-knowledge/task-export-setup.tsx src/server/composition.ts tests/integration/task-export-binding.test.ts tests/unit/task-export-binding-route.test.ts && git commit -m 'feat: issue and rotate restricted My Space task export bindings'`.

### Task 4: Idempotent, Sequenced Task Ingestion with Revocation-Resistant Authorization

**Files:**
- Create: `src/modules/task-knowledge/application/ingest-task-result.ts`
- Modify: `src/server/composition.ts` (wire `IngestTaskResultService`)
- Modify: `CLAUDE.md` (design §3 deviation 2: the one caller-less write, next to the share-link exceptions)
- Test: `tests/integration/task-export-ingest.test.ts`
- Test: `tests/unit/task-export-single-exception.test.ts`

**Interfaces:**
- `IngestTaskResultService.ingest(rawToken: string, rawBody: unknown): Promise<{ state: 'CREATED' | 'EXISTING'; taskResultId: string; revisionNo: number; bindingId: string; workspaceId: string }>`. Error classes for the Task 6 mapping: `CredentialInvalid` (401), `ScopeDenied` (403), `RevisionConflict` (409, carries `latestRevisionNo`), `RevisionOutOfOrder` (409, carries `latestRevisionNo`), `TaskArchived` (409), `PayloadInvalid` (422); `WorkspaceBusyError` from `mapDatabaseError` (lock wait timeout or deadlock) maps to 503.
- Order (design §6): hash the token; read credential and binding unlocked; read the Source (non-locking) to learn the Workspace; `workspaces.lockSharedById` and check kind, status and owner; `lockBindingShared` and re-read the credential, check both; for revision 1, `insertTaskIfAbsent`; then, if the task exists, `lockTaskForUpdate`; then decide:
  - after the task row lock, no revision stored and `latest_revision_no = 0`, and revision 1 → insert revision 1 (CREATED). This is decided from the locked row, never from whether `insertTaskIfAbsent` inserted;
  - no task and revision > 1 → `RevisionOutOfOrder`;
  - task exists, revision already stored with the same hash → EXISTING (also when the task is ARCHIVED);
  - task exists, revision already stored with a different hash → `RevisionConflict`;
  - task ARCHIVED and revision not stored → `TaskArchived`;
  - revision = latest + 1 → insert revision and `advanceLatestRevision` (CREATED);
  - any other revision → `RevisionOutOfOrder`.
  Task, revision and references are written in the same transaction. The raw token is never logged or stored.
- `TaskArtifactV1` (Task 1) and `TaskKnowledgeUnitOfWork` (Task 2) are stable inputs.

- [ ] **Step 1: Write failing tests.**
  - Integration, sequence: first POST of revision 1 creates; exact replay returns EXISTING with the same ID; revision 2 after 1 creates and keeps revision 1; revision 2 for an unknown task, revision 3 after 1, and a late replay of a new revision 2 after 3 is stored all yield `RevisionOutOfOrder`; the stored latest revision never decreases; same revision with a different hash yields `RevisionConflict`.
  - Archived: a new revision into an ARCHIVED task yields `TaskArchived` and writes nothing; an exact replay of an already stored revision of that task returns EXISTING.
  - Concurrency: simultaneous identical ingests of revision 1 yield one task row and one revision row, one answer CREATED and the other EXISTING (not an error); a sequential exact replay of revision 1 answers EXISTING; an ingest running while a Folder Sync Apply holds the same Workspace shared completes without waiting for the Apply.
  - Revocation and rotation: revocation or archival before ingest rejects; a revoke that holds the binding row `FOR UPDATE` while ingest waits on `lockBindingShared` makes the ingest reject after the revoke commits; an ingest that holds the binding share lock first commits, and the revoke then commits after it; rotation invalidates the old token's ingest.
  - Scope: a payload containing a Workspace, Source or binding field is rejected and cannot move the write; the binding owner no longer owning the Workspace yields `ScopeDenied`.
  - Atomicity: a DB failure after the Task insert rolls back every row.
  - Sequence bodies: `RevisionConflict` and `RevisionOutOfOrder` carry the stored `latestRevisionNo`; for revision 2 of an unknown task it is 0.
  - Errors: a forced deadlock (1213) or lock wait timeout (1205) during ingest surfaces as `WorkspaceBusyError` and writes nothing.
  - Single exception (`tests/unit/task-export-single-exception.test.ts`): an entry is, for files directly in `src/modules/task-knowledge/application/` (files under `application/internal/` are helpers and are excluded), any exported function and any public method of an exported class. Every entry takes a `CallerContext`-typed parameter except `IngestTaskResultService.ingest`. A public class member defined as an arrow-function property fails the test outright, so entries cannot hide from the method scan. Parse the class bodies by matching braces, as `parenthesised` does in `tests/unit/share-link-single-exception.test.ts`, rather than by indentation. For callers: in `src/server`, `src/app` and `src/components`, the set of files that call `.ingest(` on the ingest service is a subset of `["app/api/task-results/ingest/route.ts"]` (empty until Task 6, which tightens it to equality).
  - `tests/unit/workspace-lock-modes.test.ts` still passes unchanged.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-ingest.test.ts` and `npx vitest run --config vitest.config.ts tests/unit/task-export-single-exception.test.ts tests/unit/workspace-lock-modes.test.ts`; expect FAIL for the first two.
- [ ] **Step 3: Implement** the service, the lock order and the sequence decision above. Use one transaction. Concurrent first ingests meet on `insertTaskIfAbsent`; the second waits for the first to commit, then sees the row and goes through the normal decision table (EXISTING for identical content, `RevisionConflict` otherwise). Return no token fields. WIKI references may stay UNRESOLVED until Task 5. Add the caller-less write to `CLAUDE.md`.
- [ ] **Step 4: Re-run** all three; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application/ingest-task-result.ts src/server/composition.ts CLAUDE.md tests/integration/task-export-ingest.test.ts tests/unit/task-export-single-exception.test.ts && git commit -m 'feat: ingest completed tasks idempotently and in sequence'`.

### Task 5: Source-Scoped Explicit References

**Files:**
- Create: `src/modules/task-knowledge/application/internal/resolve-task-references.ts`
- Modify: `src/modules/task-knowledge/application/ingest-task-result.ts`
- Test: `tests/integration/task-export-references.test.ts`

**Interfaces:**
- `resolveTaskReferences(r: TaskKnowledgeRepositories, boundSourceId: string, references: readonly TaskReferenceInput[]): Promise<ResolvedTaskReference[]>`. Each result carries the original locator, type, resolution status, nullable Document ID, and ordinal. It is a caller-less helper under `internal/`, used only by the ingest service.
- `readTaskReferenceAvailability(caller: CallerContext, reference: ResolvedTaskReference): Promise<'RESOLVED' | 'UNAVAILABLE'>` (same file) for UI link rendering. A resolved historical ID never grants read access.

- [ ] **Step 1: Write failing tests.**
  - Exact `architecture/auth.md` in the bound Source resolves to its Document ID; the variants that Folder Sync normalizes to the same stored path (`architecture\auth.md`, `./architecture/auth.md`) resolve to the same ID.
  - A path the adapter reports as `INVALID_PATH` is stored as UNRESOLVED; ingest does not fail.
  - The same path in another Source is ignored.
  - Missing, inactive, archived, case-colliding and ambiguous references do not guess.
  - `../../` and absolute paths are rejected by the Task 1 validator before resolution.
  - After a document moves, the previously resolved Task still points to the same ID, with the live path verified on read.
  - Archive or revoke makes the link unavailable and reveals no document title to non-members.
  - CODE_FILE, COMMIT and PR_URL remain external only.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-references.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** exact scoped resolution through `TaskEntryLookup` and `TaskDocumentLookup`. Do **not** call `buildLinkResolver` ranked title matching. Save the result in the Task 4 transaction, and check availability again on every read. Keep the original path and resolution evidence.
- [ ] **Step 4: Re-run** the integration file and `npx vitest run --config vitest.config.ts tests/unit/task-export-single-exception.test.ts`; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application tests/integration/task-export-references.test.ts && git commit -m 'feat: resolve exact bound-source wiki references'`.

### Task 6: Task Ingestion HTTP Contract and Middleware Exemption

**Files:**
- Create: `src/app/api/task-results/ingest/route.ts`
- Modify: `src/lib/site-password.ts` (add `/api/task-results/ingest` to `EXEMPT_EXACT`)
- Modify: `src/lib/auth-paths.ts` (add the same exact path to `isGooglePublicPath`)
- Modify: `docs/superpowers/specs/2026-10-25-google-login-design.md` (one-line pointer to the task export design §7 in its public-paths list)
- Modify: `tests/unit/task-export-single-exception.test.ts` (tighten the caller check to equality)
- Test: `tests/unit/task-export-ingest-route.test.ts`
- Test: extend `tests/unit/site-password.test.ts`, `tests/unit/auth-paths.test.ts`, `tests/unit/google-middleware.test.ts`
- Test: `tests/integration/task-export-http.test.ts`

**Interfaces:**
- `POST /api/task-results/ingest` reads `X-Knowledge-Hub-Export-Token` and the body, counting bytes as they are read and stopping at 64 KiB. It calls the ingest service from `src/server/composition.ts` and returns `{ taskResultId, revisionNo, bindingId, url }`, with 201 for CREATED and 200 for EXISTING. `url` is a same-origin relative path; the CLI joins it with its configured origin, never with a client-supplied Host header. The route does not use the Workspace browser route wrapper, which assumes an interactive session.
- The route also exports `GET`, `HEAD`, `PUT`, `PATCH`, `DELETE` and `OPTIONS` handlers that return 405 with `Allow: POST` and `Cache-Control: private, no-store`, and no `Access-Control-Allow-*` header. Exporting them stops Next.js from answering `OPTIONS` itself with 204.
- Exemption: the exact pathname `/api/task-results/ingest` only, in both gates. The middleware itself is unchanged.
- Status mapping (design §7): 201, 200, 400, 401, 403, 405, 409 (`REVISION_CONFLICT` and `REVISION_OUT_OF_ORDER` with `latestRevisionNo`; `TASK_ARCHIVED`), 413, 422, 503 (including `WorkspaceBusyError`). `Cache-Control: private, no-store` on every response.

- [ ] **Step 1: Write failing tests.**
  - Route unit (importing the route module's handlers): a valid credential returns 201 with `bindingId`, then 200 for the same payload; missing or unknown header returns 401; a body over 64 KiB returns 413 even when `Content-Length` is absent or understated; invalid JSON returns 400; unsupported `schemaVersion` returns 422; each 409 code maps with its code, and both revision 409s include `latestRevisionNo`; each of `GET`, `HEAD`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` returns 405 with `Allow: POST`, `private, no-store` and no CORS header; no raw token or content in logs or error bodies; a `Cookie` session without the export header cannot ingest; `WorkspaceBusyError` returns 503 and never a false success.
  - Site password (`site-password.test.ts`): `/api/task-results/ingest` is exempt; `/api/task-results/ingest/`, `/api/task-results/ingest/extra`, `/api/task-results/Ingest`, `/api/task-results/%69ngest` and `/api/task-results` are not.
  - Google gate (`auth-paths.test.ts`): the same exempt and non-exempt cases for `isGooglePublicPath` and `googleGate`.
  - Middleware (`google-middleware.test.ts`): with Google and a site password both configured, the exact path passes both gates without a session or Basic header; `/api/workspaces/<id>/task-export-bindings` still answers 401 without a session.
  - Integration: end-to-end HTTP with a real credential; a rotated-out credential returns 401; a scope-denied credential returns 403.
  - Single exception: the caller set now equals `["app/api/task-results/ingest/route.ts"]`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-export-ingest-route.test.ts tests/unit/site-password.test.ts tests/unit/auth-paths.test.ts tests/unit/google-middleware.test.ts tests/unit/task-export-single-exception.test.ts` then `npm run test:integration -- tests/integration/task-export-http.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the route and its 405 handlers, the two exact-path entries and the status mapping, using the project's existing error-mapping conventions. Tighten the single-exception caller check. Add the pointer to the Google login spec. Avoid returning links to documents whose read permission has not been established.
- [ ] **Step 4: Re-run** all of them; expect PASS.
- [ ] **Step 5: Commit** `git add src/app/api/task-results src/lib/site-password.ts src/lib/auth-paths.ts docs/superpowers/specs/2026-10-25-google-login-design.md tests/unit/task-export-ingest-route.test.ts tests/unit/site-password.test.ts tests/unit/auth-paths.test.ts tests/unit/google-middleware.test.ts tests/unit/task-export-single-exception.test.ts tests/integration/task-export-http.test.ts && git commit -m 'feat: expose scoped task result ingest API'`.

### Task 7: Portable Shared CLI, Confirmed Revisions and Safe Manual Retry

**Files:**
- Create: `tools/knowledge-hub/package.json` (with `bin` and `files` including `agent/`)
- Create: `tools/knowledge-hub/bin/knowledge-hub.mjs`
- Create: `tools/knowledge-hub/src/configure.mjs`
- Create: `tools/knowledge-hub/src/project-config.mjs`
- Create: `tools/knowledge-hub/src/state.mjs`
- Create: `tools/knowledge-hub/src/secret-scan.mjs`
- Create: `tools/knowledge-hub/src/export.mjs`
- Test: `tests/unit/task-export-cli.test.ts`

**Interfaces:**
- Install: in `tools/knowledge-hub`, `npm pack`, then `npm install -g <tarball>`. Installing from the tarball, not the directory, keeps the installed CLI independent of the checkout's current branch. The package has no dependencies.
- `knowledge-hub configure [--profile <name>] [--from <otherRoot>]` prompts for the HTTPS Hub URL, binding ID, project root (default: the Git top-level, else the working directory) and, if this binding has no credential yet, the token through a hidden prompt or stdin without echo. Credentials are stored once per binding in the per-user configuration directory (`0600` on POSIX; on Windows the CLI prints a profile-ACL warning); project keys reference the binding. `--from` makes this key reference the binding used by `<otherRoot>`, and prints that both now share it. The token is never accepted from argv.
- `knowledge-hub configure --rotate <bindingId>` replaces that binding's stored credential; every key using the binding picks it up.
- Local config key: realpath of the Git top-level (or the working directory outside Git), plus the optional profile.
- State layout: `<state>/<key>/<taskId>/rev-<n>.json` plus `<state>/<key>/<taskId>/meta.json` holding, per revision, the canonical hash, the binding it was sent under, and its state (`unconfirmed` | `confirmed` | `rejected`), plus `knownLatestRevisionNo`. Task IDs are looked up only under the current key. A missing state directory makes `--task` and `--retry` for old tasks exit 2 and affects nothing else.
- State transitions: 200/201 → `confirmed`; network error, timeout, 5xx, 401 and 409 `TASK_ARCHIVED` → stays `unconfirmed`; any other 4xx → `rejected`; `--discard` → `rejected`. A 409 body's `latestRevisionNo` updates `knownLatestRevisionNo`.
- `knowledge-hub export --new`: refused with exit 2 if this key has any unconfirmed revision; the refusal lists every such task with its `title`, `completedAt`, the opening of its `summary`, and its `--retry` command. Otherwise reads `TaskContentV1` JSON from stdin, validates it, runs the secret scan, mints a UUIDv4 `taskId`, sets `artifactRevision` 1 and `schemaVersion` 1, checks CODE_FILE paths against the project root, saves the revision with its hash and binding, then POSTs.
- `knowledge-hub export --retry <taskId>`: resends the task's unconfirmed revision unchanged, after checking its hash and binding. If the task has no unconfirmed revision, prints that and exits 0.
- `knowledge-hub export --task <taskId>`: refused with exit 2 while the task has an unconfirmed revision, or by the recorded-binding refusal. Otherwise reads new content from stdin and saves and sends revision n+1, where n is the larger of the latest confirmed revision and `knownLatestRevisionNo` (unset counts as 0). If `rev-<n+1>.json` exists as `rejected`, the number is reused and the file and its record are replaced; a `confirmed` revision is never replaced.
- Recorded-binding refusal (exit 2, used by `--retry` and `--task`): the current configuration names a different binding than the task was sent under. The message names both binding IDs and offers `--discard <taskId>` or reconfiguring the key to the recorded binding.
- `knowledge-hub export --discard <taskId>`: marks the task's unconfirmed revision `rejected` without sending it; exits 0, or 2 if there is none. When the revision's last send timed out or hit a network error, the output warns that it may already be stored in Hub and recommends `--retry` first. Discarding never contacts Hub.
- Secret scan (`secret-scan.mjs`): refuses content containing the configured export token, a PEM private-key header (`-----BEGIN ... PRIVATE KEY-----`), `AKIA` followed by 16 uppercase alphanumerics, `ghp_` or `github_pat_` tokens. It reports the rule name only.
- On 200/201: checks the response's `bindingId` against the configured binding. On a **response `bindingId` mismatch**: exit 4, nothing marked confirmed, and a message naming both IDs, saying the revision is stored under the server's binding, and offering `configure --rotate <configuredBindingId>` then `--discard <taskId>`. Otherwise marks the revision confirmed and prints the Task URL.
- On failure: prints the status, the Task ID and the exact next step: `--retry` for retryable failures; after 401, `configure --rotate <bindingId>` then `--retry`, or `--discard <taskId>` if the binding was revoked; after `TASK_ARCHIVED`, restore it in My Space then `--retry`, or `--discard <taskId>` if it was archived on purpose; `--task <taskId>` (continuing from the server's `latestRevisionNo`) after `REVISION_CONFLICT` or `REVISION_OUT_OF_ORDER`; for 403, 413 and 422, the reason and that the revision was rejected.
- Exit codes: `0` success; `2` local input or state refused (nothing sent); `3` retryable as is: any network error, timeout or 5xx; `4` will not succeed without a user action: any 4xx, or a binding mismatch.
- `--allow-insecure-localhost` permits `http://localhost` and `http://127.0.0.1` only; any other `http://` URL is refused.
- Node >=20.19 with built-in `fetch`, `crypto`, `fs` and `readline`; no Hub app dependency; no runtime import of Next.js TypeScript.

- [ ] **Step 1: Write failing CLI tests.**
  - Configure in a temp home: no credential lands under the repo; two worktrees of one repo get two keys; `--profile` separates bindings; a key with no configuration never uses another key's credential; `--from` references exactly the named key's binding; `--rotate` once updates both keys that share a binding.
  - URL: `http://` refused without the flag; with the flag only localhost addresses are accepted.
  - `--new`: content with `taskId`, `artifactRevision`, `schemaVersion` or `bindingId` exits 2 with no request; a valid content fixture produces a saved revision 1 with a UUIDv4; the shared fixtures give the same accept/reject result as the Task 1 parsers (conformance); CODE_FILE resolving outside the root exits 2; content containing the configured token or each secret pattern exits 2 and the output names the rule, not the value.
  - Timeout that committed: the first `--new` times out (exit 3); a second `--new` exits 2 and lists the pending task's title, `completedAt`, summary opening and `--retry <id>` (with two unconfirmed tasks under the key, both are listed); `--retry` sends byte-identical content, gets 200, and marks the revision confirmed.
  - Rejected revisions never block: after each of 403, 413, 422, 409 `REVISION_CONFLICT` and 409 `REVISION_OUT_OF_ORDER` on `--new`, a following `--new` with other content succeeds; after 401 and `TASK_ARCHIVED` the revision stays unconfirmed and `--retry` succeeds once the server accepts it.
  - `REVISION_CONFLICT` or `REVISION_OUT_OF_ORDER` with `latestRevisionNo: 3`, then the hinted `--task`: sends revision 4.
  - `--discard`: marks the unconfirmed revision rejected; `--new` is then allowed; `--discard` with nothing unconfirmed exits 2; after a timeout it prints the "may already be stored, `--retry` first" warning.
  - Revoked binding path: 401 prints both the `configure --rotate` and the `--discard` options; the key is reconfigured to a new binding; `--new` is refused; `--retry` exits 2 with the recorded-binding refusal naming both IDs and `--discard`; `--discard` succeeds; `--new` then succeeds under the new binding.
  - Archived on purpose: `TASK_ARCHIVED` prints both the restore and the `--discard` options.
  - Response `bindingId` mismatch prints both IDs, `configure --rotate <configuredBindingId>` and `--discard <taskId>`.
  - Number reuse: `--task` revision 2 rejected with 403, then `--task` again sends revision 2, replacing the rejected `rev-2.json`; a confirmed revision file is never overwritten; with no known latest revision, `--task` on a task whose revision 1 was rejected sends revision 1.
  - State scope: a task created under one key is unknown to `--task` under another key; deleting the state directory makes `--task <old>` exit 2 and `--new` still works.
  - Retry: a 503 keeps the revision unconfirmed and exits 3; a hand-edited saved revision exits 2; the recorded-binding refusal exits 2; `--retry` with nothing unconfirmed exits 0.
  - `--task`: refused while revision 1 is unconfirmed; after confirmation creates revision 2 and leaves revision 1 unchanged; an unknown Task ID exits 2.
  - Responses: 201 and 200 print the URL and exit 0; a response `bindingId` that differs from the configured one exits 4 and confirms nothing; 409 `REVISION_CONFLICT` prints the `--task` command and exits 4; 401 prints the `configure --rotate` hint and exits 4; 400, 403, 405 and 422 exit 4; 500, 502, 503 and 504 exit 3.
  - No export token in stdout, stderr, spawn arguments, exception messages, saved revisions or repo-tracked files, including on Windows path conventions.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-export-cli.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the standalone CLI with direct HTTP requests, hidden credential input, per-binding credential storage, per-key configuration and confirmed revision state. Install nothing into the user's target project.
- [ ] **Step 4: Re-run** the CLI unit tests; expect PASS.
- [ ] **Step 5: Commit** `git add tools/knowledge-hub tests/unit/task-export-cli.test.ts && git commit -m 'feat: add manual task export cli'`.

### Task 8: Claude Code and OpenCode Entry Points, Installed per User

**Files:**
- Create: `tools/knowledge-hub/agent/hub-export/SKILL.md` (canonical workflow)
- Create: `tools/knowledge-hub/agent/opencode/hub-export.md` (adapter)
- Create: `tools/knowledge-hub/src/install-agent.mjs`
- Modify: `tools/knowledge-hub/bin/knowledge-hub.mjs` (register `install-agent`)
- Create: `docs/task-export-setup.md`
- Create: `docs/task-export-setup.zh-TW.md`
- Test: `tests/unit/task-export-agent-instructions.test.ts`

**Interfaces:**
- `knowledge-hub install-agent [--claude] [--opencode]` (both by default) copies the Skill to `~/.claude/skills/hub-export/SKILL.md` and the adapter to OpenCode's user-level commands directory, writing into the adapter the absolute path of the installed Skill. It overwrites only files it installed before (recorded by content hash), and refuses otherwise unless `--force`.
- The user types `/hub-export` in any project. The Skill instructs the Agent to (a) identify the just-completed task in available context, (b) inspect concrete verification evidence and explicit Wiki references, (c) pipe `TaskContentV1` JSON to `knowledge-hub export --new` (or `--task <taskId>` when the user asks to update an exported task), and (d) report the URL, or the CLI's failure line and next command verbatim. Exit code 2 with `--retry` hints means earlier exports are unconfirmed: run each `--retry`; if one fails, report its message and stop. After they succeed, judge by meaning whether a listed task is the same work as the current task (not by equal titles or times); if so, report the retried URL and stop (design §8, Skill rule). Run `--new` again only for clearly different work, and ask the user when unsure. Run `--discard` only when the user explicitly asks to drop that export; never to unblock `--new` on its own. Exit code 3 means the user may retry with `--retry`. Exit code 4 means it will not succeed without a user action; report the printed next step. No MCP, no full conversation, no file writes outside the project.
- The OpenCode adapter delegates to the installed Skill path, so the two cannot diverge.
- Instructions never mention the credential, its file or its header.

- [ ] **Step 1: Write failing tests, requirement-driven.**
  - Skill frontmatter parses; `name` is `hub-export`.
  - The Skill names `export --new`, `export --task`, `export --retry` and `export --discard` and the meaning of exit codes 2, 3 and 4, states the same-task rule after a refused `--new` (retry each, stop on a failed retry, judge sameness by meaning, stop for the same work, ask when unsure), states that `--discard` runs only on the user's explicit request, and names none of the CLI-owned fields as something the Agent sets; the adapter contains a placeholder for the Skill path and no workflow steps of its own.
  - The Skill's steps include: verification from evidence only (no PASS without a recorded check), explicit WIKI references only, no whole-conversation upload, no Stop/Idle or MCP usage.
  - The example content in the docs passes `parseTaskContent` (fixture conformance).
  - `knowledge-hub install-agent` (through the `bin` entry) into a temp home writes both files, fills the Skill path into the adapter, is idempotent, and refuses to overwrite a user-modified file without `--force`.
  - The Skill and adapter text contain no credential file path and no `X-Knowledge-Hub-Export-Token`.
  - Tests check these properties, not exact prose.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-export-agent-instructions.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the shared Skill, the adapter, `install-agent` and its `bin` registration, and the setup docs in English and `zh-TW`, covering the tarball install, `configure`, `configure --from` for worktrees, `configure --rotate`, and the retry rules.
- [ ] **Step 4: Re-run** the tests; expect PASS. Manually check, in a project other than the Hub repo, that `/hub-export` is discovered and runs in Claude Code and in OpenCode on the available versions, and confirm OpenCode's user-level commands directory against that version. If a tool is unavailable, report it as an explicit verification gap, not as success.
- [ ] **Step 5: Commit** `git add tools/knowledge-hub/agent tools/knowledge-hub/src/install-agent.mjs tools/knowledge-hub/bin/knowledge-hub.mjs docs/task-export-setup.md docs/task-export-setup.zh-TW.md tests/unit/task-export-agent-instructions.test.ts && git commit -m 'feat: add shared hub export agent workflow'`.

### Task 9: Authorized Task Reads, Archive/Restore and My Space UI

**Files:**
- Create: `src/modules/task-knowledge/application/read-task-results.ts`
- Create: `src/modules/task-knowledge/application/manage-task-lifecycle.ts`
- Create: `src/app/w/[workspaceId]/tasks/page.tsx`
- Create: `src/app/w/[workspaceId]/tasks/[taskResultId]/page.tsx`
- Create: `src/app/api/workspaces/[workspaceId]/task-results/[taskResultId]/lifecycle/route.ts`
- Create: `src/components/task-knowledge/task-list.tsx`
- Create: `src/components/task-knowledge/task-detail.tsx`
- Modify: `src/components/knowledge/personal-home.tsx` (small discoverable link; *no* main sidebar entry)
- Modify: `src/server/composition.ts` (wire both services)
- Test: `tests/integration/task-export-reads.test.ts`
- Test: `tests/e2e/task-export-my-space.spec.ts`

**Interfaces:**
- `TaskResultReadService.list(caller, workspaceId, { lifecycle, cursor })` and `get(caller, workspaceId, taskResultId)`. The caller must own the requested ACTIVE PERSONAL Workspace. A credential alone never reads.
- `TaskLifecycleService.archive(caller, workspaceId, taskResultId)` and `restore(...)`, owner only. Lock order: Workspace shared, then `lockTaskForUpdate`. Archiving an archived task or restoring an active one is a no-op, as for documents. `POST /api/workspaces/:workspaceId/task-results/:taskResultId/lifecycle` with `{ action: 'archive' | 'restore' }`, via `establishTrustedCaller()`.
- View URLs: `/w/:workspaceId/tasks` (default ACTIVE, with an archived filter) and `/w/:workspaceId/tasks/:taskResultId`. The detail view shows title, agent, completedAt, summary, findings, decisions, changes, verification evidence and checks, revision history, lifecycle, binding status, reference links, and the archive/restore action. Link titles and availability are computed with current authorization. External URLs are never opened automatically.
- Link rendering: an `href` is emitted only for `https:` PR_URLs and for resolved WIKI links to the current viewer's Workspace route. Anything else renders as plain text.

- [ ] **Step 1: Write failing integration and E2E tests.**
  - Owner sees list and detail, including resolved and unresolved references; an unrelated user or another Workspace gets 404 for read and for lifecycle actions.
  - Archive: the task leaves the default list, appears under the archived filter, stays readable; restore returns it; archiving twice and restoring an active task are no-ops; a new ingest into the archived task is refused (Task 4) and succeeds after restore.
  - Revoked binding: existing tasks stay readable and show the revoked status.
  - Archived Source hides the document link rather than leaking its title.
  - Version switch shows the chosen revision.
  - No sidebar item is added; navigation from home is discoverable.
  - Hostile content: Markdown, HTML, `javascript:` and `data:` values render as inert text; no `href` with an unsafe scheme exists in the rendered DOM.
  - Unicode task content renders correctly.
  - `tests/unit/task-export-single-exception.test.ts` and `tests/unit/workspace-lock-modes.test.ts` still pass with the two new services.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-reads.test.ts`, `npx vitest run --config vitest.config.ts tests/unit/task-export-single-exception.test.ts tests/unit/workspace-lock-modes.test.ts` and `npm run test:e2e -- tests/e2e/task-export-my-space.spec.ts`; expect FAIL for the integration and E2E files.
- [ ] **Step 3: Implement** the read and lifecycle services, the route, the pages and the small UI, using `PageHeader`, the frontend design-language tokens and safe text rendering. Keep current My Space restrictions. Do not mutate the document graph or add Task nodes in this phase.
- [ ] **Step 4: Re-run** the tests; expect PASS. Run the accessibility and responsive checks in Playwright.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application/read-task-results.ts src/modules/task-knowledge/application/manage-task-lifecycle.ts 'src/app/w/[workspaceId]/tasks' 'src/app/api/workspaces/[workspaceId]/task-results' src/components/task-knowledge src/components/knowledge/personal-home.tsx src/server/composition.ts tests/integration/task-export-reads.test.ts tests/e2e/task-export-my-space.spec.ts && git commit -m 'feat: browse and archive task knowledge in My Space'`.

### Task 10: End-to-End Verification, Documentation, and Final Review

**Files:**
- Create: `tests/e2e/task-export-flow.spec.ts`
- Update: `docs/task-export-setup.md` and `docs/task-export-setup.zh-TW.md`
- Update: `docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md` (record the narrow integration and the Phase 7 dependency; do not mark Phase 7/9 implemented)
- Update: `README.md` and `README.zh-TW.md` (add the design and plan to the "Current canonical documents" table in both languages)
- Create: `docs/superpowers/verification/2026-11-04-task-knowledge-export-verification.md`

**Interfaces:**
- Complete scenario: browser creates a binding → CLI configures the local project (`--allow-insecure-localhost` against the E2E server) → Skill-shaped content piped to `export --new` → the task appears in My Space with a Wiki link → `export --retry` after a forced timeout returns 200 EXISTING → `export --task` adds revision 2 → archive refuses a new revision, restore allows it → rotation (`configure --rotate`) invalidates the old token → revocation refuses new ingestion while existing tasks stay readable. No browser session can substitute for the export credential in the ingest route.

- [ ] **Step 1: Add E2E coverage** for the flow above, a missing or archived Source, an untrusted foreign Workspace input, and duplicate export. Send one real `OPTIONS` request to `/api/task-results/ingest` on the built server, through the middleware: expect 405, `Allow: POST`, `Cache-Control: private, no-store` and no `Access-Control-Allow-*` header. Include tool-compatibility smoke notes for Claude Code and OpenCode from Task 8's manual check.
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e/task-export-flow.spec.ts`; expect FAIL before wiring, then PASS.
- [ ] **Step 3: Reconcile and document** setup, API errors, exit codes and manual retry behavior. Update the roadmap with the explicit scope and the Phase 7 dependency from design §10. Add the design and plan to both README canonical documents tables. Capture the actual tool output in the verification record. No CI claims without observed evidence.
- [ ] **Step 4: Run** `make verify`, `npm run test:integration` and `npm run test:e2e -- tests/e2e/task-export-flow.spec.ts tests/e2e/task-export-my-space.spec.ts`; every process must exit 0. Inspect the changed-file scope and confirm no accidental Folder Sync or Graph behavior change.
- [ ] **Step 5: Commit** `git add tests/e2e/task-export-flow.spec.ts docs/task-export-setup.md docs/task-export-setup.zh-TW.md docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md docs/superpowers/verification/2026-11-04-task-knowledge-export-verification.md README.md README.zh-TW.md && git commit -m 'test: verify manual task knowledge export end to end'`; request code review, fix verified findings, and run CI before recommending merge.

---

## Plan self-review / execution gate

**Spec coverage:**
- §3 deviations and lock convention: Tasks 2, 3, 4 and 9.
- §4 flow, install and worktree configuration: Tasks 7 and 8.
- §5 contract, CLI-owned identity, revision sequence, frozen revisions and secret scan: Tasks 1, 4 and 7.
- §6 binding, credentials, rotation, storage, archival and lock order: Tasks 2, 3, 4 and 9.
- §7 authentication, exemption, HTTP contract and references: Tasks 5 and 6.
- §8 UI: Task 9.
- §9 failures and verification: Tasks 4, 7, 9 and 10.
- §10 deferrals stay excluded; the Phase 7 dependency is recorded in Task 10.

**Type contract check:** `TaskContentV1`, `TaskArtifactV1` and `TaskReferenceInput` originate in Task 1 and are the CLI's conformance corpus. Services consume only the Task 2 ports, so `task-knowledge` never imports `sources`, and the Workspace port offers only a shared lock. Ingest state, identifiers and error codes stay consistent through Tasks 4, 6 and 7.

**Five review-focus classes** are each assigned above. **Dependency order:** 1→2→3→4→5→6→7→8→9→10, with task-level review gates and frequent commits. `tests/unit/task-export-single-exception.test.ts` and `tests/unit/workspace-lock-modes.test.ts` are re-run in every task that adds a service.

**Approval gate:** This plan is for review only. Do not start code, migration, package installation or worktree implementation until the user approves the plan and selects an execution mode. Recommended mode: **Subagent-driven**, because the credential, Workspace authorization and transactional idempotency boundaries deserve independent review per task, followed by whole-branch review.
