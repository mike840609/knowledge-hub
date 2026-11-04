# Task Knowledge Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable a developer to invoke `/hub-export` in Claude Code or OpenCode, in any project, have the Agent summarize one completed task, and securely save a versioned Task Knowledge asset with exact Wiki links to the owner's My Space.

**Architecture:** A shared Skill (with an OpenCode command adapter), installed per user, instructs the Agent to pipe the task summary to a portable Node CLI. The CLI adds the identity fields, freezes the artifact in its own state directory, and posts it to an isolated Next.js Task Ingestion API using a limited, revocable project credential sent in a dedicated header. A dedicated `task-knowledge` module persists immutable revisions and source-scoped references through its own ports, without altering Folder Sync, the existing Document Graph or Wiki.

**Tech Stack:** Next.js 15, TypeScript 5, Node >=20.19, MariaDB 10.11, existing Vitest/integration harness and Playwright, Claude Code Skill, OpenCode command. Avoid new runtime packages unless a test demonstrates an unavoidable need.

**Spec:** `docs/superpowers/specs/2026-11-04-task-knowledge-export-design.md`

## Global Constraints

- **Trigger:** manual `/hub-export` only; no Stop/Idle Hook, background daemon or persistent Outbox.
- **Destination:** ACTIVE PERSONAL My Space owned by the credential's binding owner, never Team Workspace.
- **Scope:** a binding fixes one ACTIVE FOLDER_SYNC Source at creation; nothing in an artifact can change it. Workspace and owner are derived, never stored on Task rows. The artifact carries no binding field.
- **Summarization:** the Agent does it using current task context; Hub runs no LLM. Full chat, thinking, terminal logs and source bodies must not be uploaded.
- **Identity:** the CLI owns `schemaVersion`, `taskId` and `artifactRevision`, and freezes every saved artifact by hash. The Agent only pipes content on stdin.
- **References:** WIKI is exact source-relative path or validated Document ID within the binding Source, normalized exactly as Folder Sync does; no title/fuzzy ranking, cross-workspace discovery, or semantic extraction.
- **Payload:** schemaVersion=1, status=completed, <=64 KiB UTF-8 (counted on bytes read), <=32 references. Verification is recorded, not certified.
- **Persistence:** one Task per `(bindingId,taskId)`; immutable revision per `(taskResultId,artifactRevision)`; replay of the same hash is idempotent (200); differing hash is 409; atomic transaction.
- **Locking:** ingest, revoke and rotate all take the Workspace lock (`workspaces.lockById`) and re-read credential, binding, Source and Workspace rows under it before deciding.
- **Credentials:** independent restricted export credential in `X-Knowledge-Hub-Export-Token`; hash stored server-side; no expiry; interactive setup; no token in CLI argv, prompts, logs or Git. Revocation and rotation are enforced live.
- **Caller rule:** `IngestTaskResultService.ingest` is the only task-knowledge entry without a `CallerContext`, and the ingest route is its only caller (recorded deviation, test-enforced).
- **Module boundary:** `src/modules/task-knowledge/**` may not import `next`, `react`, `mariadb`, `infrastructure`, `server`, or `@/modules/sources/**`. Enforced by ESLint in Task 2.
- **Composition:** all services are wired in `src/server/composition.ts`; no second composition root.
- **Compatibility:** preserve SOURCE_MANAGED read-only, Folder Sync Preview/Apply, document graph and current Agent Context contracts.
- **Workflow:** TDD for each task, one focused test run plus full relevant suite, one small commit per independently testable task; run `make verify` and DB-backed tests before PR. Quote bracketed paths in shell commands (zsh treats `[...]` as a glob).

## File/ownership map

| Unit | New / changed files | Responsibility |
| --- | --- | --- |
| Contract | `src/modules/task-knowledge/domain/task-artifact.ts`, `task-references.ts`, `task-errors.ts`; shared fixtures `tests/fixtures/task-artifact/**` | Pure parsers for Agent content and full artifact, canonical hashing, reference validation, error codes |
| Ports | `src/modules/task-knowledge/ports/{task-export-store,unit-of-work,lookups}.ts` | `TaskExportStore`, `TaskKnowledgeUnitOfWork`, and local lookup ports (local models, no sources imports) |
| Storage | `src/infrastructure/database/mariadb/migrations/032-task-knowledge-export.ts`, `migrations/index.ts`, `repositories/task-knowledge.ts`, `task-knowledge-transaction.ts` | Tables, repository, lookup adapters over the existing repository factory (including Folder Sync path normalization), isolated transaction |
| Boundary | `eslint.config.mjs`, `CLAUDE.md`, `tests/unit/task-knowledge-boundary.test.ts`, `tests/unit/task-export-single-exception.test.ts` | Enforce the module boundary and the one caller-less write; record all four deviations |
| Binding | `src/modules/task-knowledge/application/manage-export-binding.ts`, `src/app/api/workspaces/[workspaceId]/task-export-bindings/route.ts`, `.../[bindingId]/route.ts`, `.../[bindingId]/credentials/route.ts`, `src/app/w/[workspaceId]/tasks/setup/page.tsx`, `src/components/task-knowledge/task-export-setup.tsx` | Browser-authenticated create/list/revoke/rotate, one-time token display, Source chooser |
| Ingestion | `src/modules/task-knowledge/application/ingest-task-result.ts`, `src/app/api/task-results/ingest/route.ts`, `src/lib/auth-paths.ts`, `src/lib/site-password.ts` | Credential auth, lock-and-reread, idempotent persist, HTTP contract, exact-path exemption |
| Resolution | `src/modules/task-knowledge/application/resolve-task-references.ts` | Exact scoped Wiki lookups, external locators, live availability |
| Read & UI | `src/modules/task-knowledge/application/{read-task-results,manage-task-lifecycle}.ts`, `src/app/w/[workspaceId]/tasks/{page.tsx,[taskResultId]/page.tsx}`, `src/app/api/workspaces/[workspaceId]/task-results/[taskResultId]/lifecycle/route.ts`, `src/components/task-knowledge/{task-list,task-detail}.tsx`, small link in `src/components/knowledge/personal-home.tsx` | Personal-only browsing, archive and restore; no new top-level sidebar |
| CLI | `tools/knowledge-hub/package.json`, `bin/knowledge-hub.mjs`, `src/{configure,export,state,project-config,install-agent}.mjs` | Per-project configuration, protected credential, frozen artifact state, POST, agent-file installation |
| Agent | `tools/knowledge-hub/agent/hub-export/SKILL.md`, `tools/knowledge-hub/agent/opencode/hub-export.md`, `docs/task-export-setup.md`, `docs/task-export-setup.zh-TW.md` | One shared workflow source, installed per user by the CLI |
| Docs | `docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md`, `docs/superpowers/specs/2026-10-25-google-login-design.md` (pointer), `README.md` and `README.zh-TW.md` (canonical docs tables) | Record scope, the boundary change and the Phase 7 dependency |

Paths above are the intended interfaces, not a license to refactor unrelated modules. The task-knowledge transaction composes the existing MariaDB repository factory for Workspace/Source/Entry/Document lookups through its adapters, and its own store for Task rows; do not widen existing SourceUnitOfWork or document mutation permissions merely to add Task features.

## Review Focus: five easy-to-miss failure classes

1. **Duplicate manual export after timeout:** `export --retry` resends the frozen artifact and returns the same Task/revision; an edited artifact is refused locally; a different payload at the same revision fails with 409 (Tasks 4, 7).
2. **Revoked binding or credential during a write:** no successful post-revocation commit; ingest, revoke and rotate share the Workspace lock and re-read under it (Tasks 3, 4).
3. **Wiki path collisions or traversal:** no best-guess match; no source-root escape, no cross-source/document leakage; normalization identical to Folder Sync (Tasks 1, 5).
4. **Two worktrees/projects on one machine:** the CLI never uses credentials or a binding from a different project key except through explicit `configure --from` (Task 7).
5. **Agent-invented verification / secret-bearing output / unsafe links:** missing checks never become PASS, forbidden content is rejected without logging secret values, and unsafe `href` schemes are never rendered (Tasks 1, 7, 9).

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
- `validateWikiReferencePath(path: string): string` rejects absolute paths, traversal, drive letters and control chars, and returns the input unchanged otherwise. It does **not** normalize: normalization that must match Folder Sync happens in the Task 2 adapter.
- `validateCodeFilePath(path)`, `validatePrUrl(value)` (https only, no userinfo, no control chars, bounded length), `validateCommitId(value)`; `type TaskReferenceInput` discriminated by `type: 'WIKI' | 'CODE_FILE' | 'COMMIT' | 'PR_URL'`.
- `TaskArtifactError(code, message)`; no raw payload in exception messages.

- [ ] **Step 1: Write failing tests from the requirements.** The fixtures are the single shared corpus; Task 7's CLI tests reuse them.
  - Content: `valid-minimal.json` (no `checks`, no optional arrays) and `valid-full.json` are accepted; accepted output has no unknown keys; content containing `taskId`, `artifactRevision`, `schemaVersion` or `bindingId` is rejected.
  - Artifact: a content fixture plus CLI fields is accepted; missing `taskId`, non-UUID `taskId`, `artifactRevision: 0`, non-integer revision and `schemaVersion: 2` are rejected.
  - Verification: `checks` omitted is accepted and is never read as passed; fake statuses (`PASS`, `ok`) rejected.
  - Required fields: `status: 'running'`, invalid `completedAt`, empty `title`, rejected.
  - Bounds: 65-KiB UTF-8 body, 33 references, oversized single string, rejected; exactly 32 references accepted.
  - Unknown fields and secret-like fields (`token`, `password`, `Authorization`) rejected; the error message does not echo the value.
  - Hash: identical for objects with reordered keys; changes when summary changes; 64 lowercase hex characters.
  - WIKI path: accepts `architecture/auth.md`; rejects `../secrets.md`, `architecture/../../x.md`, `/tmp/note.md`, `C:\\secret.md`, paths with NUL or newline.
  - CODE_FILE path: accepts `src/lib/x.ts`; rejects absolute paths, `..` segments (even when they would normalize inside the root), drive letters, control chars.
  - PR_URL: accepts `https://github.com/org/repo/pull/1`; rejects `javascript:...`, `data:...`, `http://...`, `https://user:pass@host/...`, control chars, over-length strings.
  - COMMIT: accepts a hex SHA; rejects over-length or whitespace-containing values.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-artifact.test.ts tests/unit/task-references.test.ts`; expect FAIL (modules not present).
- [ ] **Step 3: Implement** with strict typed, bounded runtime validation and canonical stable serialization before SHA-256. `checks` stays optional and is never inferred from status. Import nothing from `sources`.
- [ ] **Step 4: Re-run** the same command; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/domain tests/unit/task-artifact.test.ts tests/unit/task-references.test.ts tests/fixtures/task-artifact && git commit -m 'feat: define task export artifact contract'`.

### Task 2: Module Boundary, MariaDB Tables, Store, and Task-Specific Transaction

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `CLAUDE.md` (fifth module, its boundary, and deviations 1–2 and 4 of design §3)
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
- `TaskExportStore`: `insertBinding(...)`, `getBinding(id)`, `listBindings(ownerId, workspaceId)` (joins Source to derive Workspace), `revokeBinding(id)`, `insertCredential(...)`, `rotateCredential(bindingId, newHash)` (revokes the active credential and inserts the new one), `findCredentialByHash(hash)`, `revokeCredentialsForBinding(id)`, `findTask(bindingId, taskId)`, `insertTask(...)`, `getRevision(taskResultId, revisionNo)`, `insertRevision(...)`, `insertReferences(...)`, `listTasks(ownerId, workspaceId, { lifecycle, cursor, limit })`, `getTaskDetail(taskResultId)`, `setTaskLifecycle(taskResultId, lifecycle, actorId)`.
- Local lookup ports in `ports/lookups.ts` (no `sources` import):
  - `TaskWorkspaceLookup`: `lockById(workspaceId)` and `getById(workspaceId)` → `{ workspaceId, kind, status, ownerUserId }`.
  - `TaskSourceLookup`: `getById(sourceId)` → `{ sourceId, workspaceId, sourceType, status }`. No owner field: Sources have none.
  - `TaskEntryLookup`: `findActiveEntriesByPath(sourceId, rawPath)` → candidates. The adapter normalizes `rawPath` with `normalizeImportPath` (from the `sources` domain, allowed in infrastructure) and compares `source_entries.source_path` byte-exactly.
  - `TaskDocumentLookup`: `getState(documentId)` → `{ documentId, sourceId, status }`.
- `TaskKnowledgeRepositories = { taskExports; workspaces; sources; entries; documents }` using the types above.
- `TaskKnowledgeUnitOfWork.run<T>(fn: (r: TaskKnowledgeRepositories) => Promise<T>): Promise<T>`; one MariaDB connection and transaction for all of them.

- [ ] **Step 1: Write failing tests.**
  - Boundary (`tests/unit/task-knowledge-boundary.test.ts`, using `ESLint.lintText` with a `filePath` under `src/modules/task-knowledge/`, as `tests/unit/linear-remediation.test.tsx` does): importing `@/modules/sources/domain/import-path`, `mariadb`, `@/infrastructure/...` or `next/server` reports `no-restricted-imports` with the task-knowledge message; importing `@/modules/task-knowledge/ports/lookups` reports nothing.
  - Migration up creates all five tables; FK constraints prevent orphan revisions and references.
  - Unique `(binding_id, task_id)` and `(task_result_id, revision_no)` reject duplicates. `task_results` has no `owner_user_id`, `workspace_id` or `status` column; it has `lifecycle` (`ACTIVE`/`ARCHIVED`) with `archived_by`/`archived_at` under the same provenance check style as other lifecycle tables.
  - Rotating a credential revokes the old hash in the same transaction; the old hash is rejected on the next lookup; exactly one active credential per binding.
  - Revoking a binding and its credentials is atomic.
  - Rolling back after reference insertion leaves no Task, revision or reference rows.
  - `TaskEntryLookup` finds an entry whose stored path is `architecture/auth.md` from `architecture\auth.md`, `./architecture/auth.md` and `architecture//auth.md`, and does not find it from `Architecture/auth.md`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-knowledge-boundary.test.ts` and `npm run test:integration -- tests/integration/task-export-storage.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** migration 032:
  - `task_export_bindings`: owner, source, label, status, timestamps. `source_id` is never updated.
  - `task_export_credentials`: `token_hash` binary with unique index, `binding_id`, `status`, `revoked_at`.
  - `task_results`: `binding_id`, `task_id`, lifecycle with provenance, latest revision number.
  - `task_result_revisions`: `task_result_id`, `revision_no`, canonical JSON, content hash.
  - `task_result_references`: locator, type, optional resolved Document ID, `RESOLVED | UNRESOLVED | AMBIGUOUS | UNAVAILABLE`, ordinal.
  - Lookup and list indexes and FKs.
  Implement the store, the lookup adapters and the dedicated UoW without expanding Source domain write APIs.
- [ ] **Step 4: Update** `eslint.config.mjs` with a `src/modules/task-knowledge/**` block: `moduleBoundaryRestrictions` plus its own sources rule, message "Task knowledge must reach Sources through its lookup ports; it must not depend on the Sources module." Add the fifth module, its boundary, and design §3 deviations 1, 2 and 4 to `CLAUDE.md`.
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
- Revoke and rotate lock the binding's Workspace (`workspaces.lockById`) before changing rows, so they serialize with ingest (Task 4).

- [ ] **Step 1: Write failing tests.**
  - A My Space owner selects an ACTIVE FOLDER_SYNC Source, creates a binding, sees the token once, and later lists bindings without any token.
  - Rotation returns a new token; the previous token fails on its next use; the list still shows one active credential.
  - Revocation makes the credential unusable on the next read.
  - Denied: Team Workspace; viewer or other user; Source from a different Workspace; non-FOLDER_SYNC Source; archived Source or Workspace; forged caller identity; rotation or revoke by a non-owner.
  - Response bodies, list responses and logs never expose a token except in the one-time create/rotate response.
  - No route changes a binding's `sourceId`.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-binding.test.ts` and `npx vitest run --config vitest.config.ts tests/unit/task-export-binding-route.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the service with the Workspace lock and owner/Source checks, server-generated binding ID, credential hash, rotation and revocation. Add a minimal setup screen that lists the authenticated Sources and displays the token exactly once, with no persistent browser storage, plus the CLI install and configure commands to copy. Routes use the project's established HTTP identity and error patterns and never accept browser-provided caller grants.
- [ ] **Step 4: Re-run** both tests; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application/manage-export-binding.ts src/app/api/workspaces 'src/app/w/[workspaceId]/tasks/setup' src/components/task-knowledge/task-export-setup.tsx src/server/composition.ts tests && git commit -m 'feat: issue and rotate restricted My Space task export bindings'`.

### Task 4: Idempotent Task Ingestion with Revocation-Resistant Authorization

**Files:**
- Create: `src/modules/task-knowledge/application/ingest-task-result.ts`
- Modify: `src/server/composition.ts` (wire `IngestTaskResultService`)
- Modify: `CLAUDE.md` (design §3 deviation 3: the one caller-less write, next to the share-link exceptions)
- Test: `tests/integration/task-export-ingest.test.ts`
- Test: `tests/unit/task-export-single-exception.test.ts`

**Interfaces:**
- `IngestTaskResultService.ingest(rawToken: string, rawBody: unknown): Promise<{ state: 'CREATED' | 'EXISTING'; taskResultId: string; revisionNo: number; workspaceId: string }>`. Error classes for the Task 6 mapping: `CredentialInvalid` (401), `ScopeDenied` (403), `RevisionConflict` (409), `TaskArchived` (409), `PayloadInvalid` (422), `Retryable` (503).
- Order (design §6): hash the token; read credential and binding unlocked to learn the Source and Workspace; `workspaces.lockById`; re-read credential, binding, Source and Workspace under the lock and check all of them; then write Task, revision and references in the same transaction. The raw token is never logged or stored.
- `TaskArtifactV1` (Task 1) and `TaskKnowledgeUnitOfWork` (Task 2) are stable inputs.

- [ ] **Step 1: Write failing tests.**
  - Integration: first POST creates; exact replay returns EXISTING with the same ID; same revision with a different hash yields `RevisionConflict`; revision 2 keeps revision 1; a revision into an ARCHIVED task yields `TaskArchived` and writes nothing; simultaneous identical ingests yield one row.
  - Revocation and rotation: revocation or archival before ingest rejects; a revoke that holds the Workspace lock while ingest waits makes ingest reject after the lock is released (the re-read sees it); rotation invalidates the old token's ingest.
  - Scope: a payload containing a Workspace, Source or binding field is rejected and cannot move the write; the binding owner no longer owning the Workspace yields `ScopeDenied`.
  - Atomicity: a DB failure after the Task insert rolls back every row.
  - Single exception (`tests/unit/task-export-single-exception.test.ts`, same scanning approach as `tests/unit/share-link-single-exception.test.ts`): every exported function and public service method in `src/modules/task-knowledge/application` takes a `CallerContext` except `IngestTaskResultService.ingest`; in `src/server`, `src/app` and `src/components`, only `src/app/api/task-results/ingest/route.ts` calls `ingest`.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-ingest.test.ts` and `npx vitest run --config vitest.config.ts tests/unit/task-export-single-exception.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the service, the lock-and-reread order, and DB unique-constraint conflict handling. Use one transaction; re-query on unique collision to distinguish exact replay from content conflict. Return no token fields. WIKI references may stay UNRESOLVED until Task 5. Add the caller-less write to `CLAUDE.md`.
- [ ] **Step 4: Re-run** both; expect PASS. (The route file does not exist yet; the single-exception test must pass with zero callers and is re-run in Task 6.)
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application/ingest-task-result.ts src/server/composition.ts CLAUDE.md tests/integration/task-export-ingest.test.ts tests/unit/task-export-single-exception.test.ts && git commit -m 'feat: ingest completed tasks idempotently'`.

### Task 5: Source-Scoped Explicit References

**Files:**
- Create: `src/modules/task-knowledge/application/resolve-task-references.ts`
- Modify: `src/modules/task-knowledge/application/ingest-task-result.ts`
- Test: `tests/integration/task-export-references.test.ts`

**Interfaces:**
- `resolveTaskReferences(r: TaskKnowledgeRepositories, boundSourceId: string, references: readonly TaskReferenceInput[]): Promise<ResolvedTaskReference[]>`. Each result carries the original locator, type, resolution status, nullable Document ID, and ordinal.
- `readTaskReferenceAvailability(caller: CallerContext, reference: ResolvedTaskReference): Promise<'RESOLVED' | 'UNAVAILABLE'>` for UI link rendering. A resolved historical ID never grants read access.

- [ ] **Step 1: Write failing tests.**
  - Exact `architecture/auth.md` in the bound Source resolves to its Document ID; the variants that Folder Sync normalizes to the same stored path (`architecture\auth.md`, `./architecture/auth.md`) resolve to the same ID.
  - The same path in another Source is ignored.
  - Missing, inactive, archived, case-colliding and ambiguous references do not guess.
  - `../../` and absolute paths are rejected.
  - After a document moves, the previously resolved Task still points to the same ID, with the live path verified on read.
  - Archive or revoke makes the link unavailable and reveals no document title to non-members.
  - CODE_FILE, COMMIT and PR_URL remain external only.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-references.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** exact scoped resolution through `TaskEntryLookup` and `TaskDocumentLookup`. Do **not** call `buildLinkResolver` ranked title matching. Save the result in the Task 4 transaction, and check availability again on every read. Keep the original path and resolution evidence.
- [ ] **Step 4: Re-run** the integration file; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application tests/integration/task-export-references.test.ts && git commit -m 'feat: resolve exact bound-source wiki references'`.

### Task 6: Task Ingestion HTTP Contract and Middleware Exemption

**Files:**
- Create: `src/app/api/task-results/ingest/route.ts`
- Modify: `src/lib/site-password.ts` (add `/api/task-results/ingest` to `EXEMPT_EXACT`)
- Modify: `src/lib/auth-paths.ts` (add the same exact path to `isGooglePublicPath`)
- Modify: `docs/superpowers/specs/2026-10-25-google-login-design.md` (one-line pointer to the task export design §7 in its public-paths list)
- Test: `tests/unit/task-export-ingest-route.test.ts`
- Test: extend `tests/unit/site-password.test.ts`, `tests/unit/auth-paths.test.ts`, `tests/unit/google-middleware.test.ts`
- Test: `tests/integration/task-export-http.test.ts`

**Interfaces:**
- `POST /api/task-results/ingest` reads `X-Knowledge-Hub-Export-Token` and the body, counting bytes as they are read and stopping at 64 KiB. It calls the ingest service from `src/server/composition.ts` and returns `{taskResultId, revisionNo, url}`, with 201 for CREATED and 200 for EXISTING. `url` is a same-origin relative path; the CLI joins it with its configured origin, never with a client-supplied Host header. The route does not use the Workspace browser route wrapper, which assumes an interactive session. The route exports only `POST`; other methods get 405.
- Exemption: the exact pathname `/api/task-results/ingest` only, in both gates. The middleware itself is unchanged.
- Status mapping (design §7): 201, 200, 400, 401, 403, 405, 409 (`REVISION_CONFLICT`, `TASK_ARCHIVED`), 413, 422, 503. `Cache-Control: private, no-store` on every response.

- [ ] **Step 1: Write failing tests.**
  - Route unit: a valid credential returns 201, then 200 for the same payload; missing or unknown header returns 401; a body over 64 KiB returns 413 even when `Content-Length` is absent or understated; invalid JSON returns 400; unsupported `schemaVersion` returns 422; `TaskArchived` maps to 409 with its code; GET and OPTIONS return 405; no raw token or content in logs or error bodies; a `Cookie` session without the export header cannot ingest; a lock wait timeout returns 503 and never a false success.
  - Site password (`site-password.test.ts`): `/api/task-results/ingest` is exempt; `/api/task-results/ingest/`, `/api/task-results/ingest/extra`, `/api/task-results/Ingest`, `/api/task-results/%69ngest` and `/api/task-results` are not.
  - Google gate (`auth-paths.test.ts`): the same exempt and non-exempt cases for `isGooglePublicPath` and `googleGate`.
  - Middleware (`google-middleware.test.ts`): with Google and a site password both configured, the exact path passes both gates without a session or Basic header; `/api/workspaces/<id>/task-export-bindings` still answers 401 without a session.
  - Integration: end-to-end HTTP with a real credential; a rotated-out credential returns 401; a scope-denied credential returns 403. Re-run `tests/unit/task-export-single-exception.test.ts`: the route is now the one caller.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-export-ingest-route.test.ts tests/unit/site-password.test.ts tests/unit/auth-paths.test.ts tests/unit/google-middleware.test.ts tests/unit/task-export-single-exception.test.ts` then `npm run test:integration -- tests/integration/task-export-http.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the route, the two exact-path entries and the status mapping, using the project's existing error-mapping conventions. Add the pointer to the Google login spec. Avoid returning links to documents whose read permission has not been established.
- [ ] **Step 4: Re-run** all of them; expect PASS.
- [ ] **Step 5: Commit** `git add src/app/api/task-results src/lib/site-password.ts src/lib/auth-paths.ts docs/superpowers/specs/2026-10-25-google-login-design.md tests && git commit -m 'feat: expose scoped task result ingest API'`.

### Task 7: Portable Shared CLI, Frozen Artifacts and Safe Manual Retry

**Files:**
- Create: `tools/knowledge-hub/package.json` (with `bin` and `files` including `agent/`)
- Create: `tools/knowledge-hub/bin/knowledge-hub.mjs`
- Create: `tools/knowledge-hub/src/configure.mjs`
- Create: `tools/knowledge-hub/src/project-config.mjs`
- Create: `tools/knowledge-hub/src/state.mjs`
- Create: `tools/knowledge-hub/src/export.mjs`
- Test: `tests/unit/task-export-cli.test.ts`

**Interfaces:**
- Install: `npm install -g <hub-checkout>/tools/knowledge-hub` puts `knowledge-hub` on PATH. The package has no dependencies.
- `knowledge-hub configure [--profile <name>] [--from <otherRoot>]` prompts for the HTTPS Hub URL, binding ID, project root (default: the Git top-level, else the working directory) and the token, through a hidden prompt or stdin without echo. It writes settings and the credential to the per-user configuration directory, never under the repo; the credential file is `0600` on POSIX, and on Windows the CLI prints a profile-ACL warning. `--from` copies the configuration of the key at `<otherRoot>` to this key, and prints that both now share a binding. The token is never accepted from argv.
- Local config key: realpath of the Git top-level (or the working directory outside Git), plus the optional profile.
- `knowledge-hub export --new`: reads `TaskContentV1` JSON from stdin, validates it, mints a UUIDv4 `taskId`, sets `artifactRevision` 1 and `schemaVersion` 1, checks CODE_FILE paths against the project root, saves the artifact to `<state>/<key>/<taskId>/rev-1.json` together with its canonical hash and the binding ID, then POSTs.
- `knowledge-hub export --retry <taskId>`: loads the latest saved revision, refuses to send if its hash differs from the recorded hash or its recorded binding differs from the current configuration, and POSTs it unchanged.
- `knowledge-hub export --task <taskId>`: reads new content from stdin and saves and sends revision n+1 under the same rules.
- Output: prints the Task URL on 200/201. On failure prints the status, the Task ID and the exact next command (`--retry` for retryable failures; `--task` after a 409 `REVISION_CONFLICT`; "restore it in My Space" after `TASK_ARCHIVED`).
- Exit codes: `0` success; `2` local input rejected (nothing sent); `3` retryable (network error, timeout, 503); `4` final (401, 403, 409, 413, 422).
- `--allow-insecure-localhost` permits `http://localhost` and `http://127.0.0.1` only; any other `http://` URL is refused.
- Node >=20.19 with built-in `fetch`, `crypto`, `fs` and `readline`; no Hub app dependency; no runtime import of Next.js TypeScript.

- [ ] **Step 1: Write failing CLI tests.**
  - Configure in a temp home: the credential never lands under the repo; two worktrees of one repo get two keys; `--profile` separates bindings; a key with no configuration never uses another key's credential; `--from` copies exactly the named key.
  - URL: `http://` refused without the flag; with the flag only localhost addresses are accepted.
  - `--new`: content with `taskId`, `artifactRevision`, `schemaVersion` or `bindingId` is rejected with exit 2 and no request; a valid content fixture produces a saved artifact with a UUIDv4 and revision 1; the shared fixtures give the same accept/reject result as the Task 1 parsers (conformance); CODE_FILE resolving outside the root is rejected with exit 2.
  - Retry: a timeout or 503 keeps the saved artifact and exits 3; `--retry` sends byte-identical content; a hand-edited saved artifact is refused with exit 2; a binding mismatch is refused with exit 2.
  - `--task`: creates `rev-2.json` with revision 2 and leaves `rev-1.json` unchanged; an unknown Task ID exits 2.
  - Responses: 201 and 200 print the URL and exit 0; 409 `REVISION_CONFLICT` prints the `--task` command and exits 4; 401 and 403 exit 4.
  - No export token in stdout, stderr, spawn arguments, exception messages, saved artifacts or repo-tracked files, including on Windows path conventions.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-export-cli.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the standalone CLI with direct HTTP requests, hidden credential input, per-key configuration and frozen state. Install nothing into the user's target project.
- [ ] **Step 4: Re-run** the CLI unit tests; expect PASS.
- [ ] **Step 5: Commit** `git add tools/knowledge-hub tests/unit/task-export-cli.test.ts && git commit -m 'feat: add manual task export cli'`.

### Task 8: Claude Code and OpenCode Entry Points, Installed per User

**Files:**
- Create: `tools/knowledge-hub/agent/hub-export/SKILL.md` (canonical workflow)
- Create: `tools/knowledge-hub/agent/opencode/hub-export.md` (adapter)
- Create: `tools/knowledge-hub/src/install-agent.mjs`
- Create: `docs/task-export-setup.md`
- Create: `docs/task-export-setup.zh-TW.md`
- Test: `tests/unit/task-export-agent-instructions.test.ts`

**Interfaces:**
- `knowledge-hub install-agent [--claude] [--opencode]` (both by default) copies the Skill to `~/.claude/skills/hub-export/SKILL.md` and the adapter to OpenCode's user-level commands directory, writing into the adapter the absolute path of the installed Skill. It overwrites only files it installed before (recorded by content hash), and refuses otherwise unless `--force`.
- The user types `/hub-export` in any project. The Skill instructs the Agent to (a) identify the just-completed task in available context, (b) inspect concrete verification evidence and explicit Wiki references, (c) pipe `TaskContentV1` JSON to `knowledge-hub export --new` (or `--task <taskId>` when the user asks to update an exported task), and (d) report the URL, or the CLI's failure line and next command verbatim. Exit code 3 means the user may retry with `--retry`; exit code 4 means retrying the same content will not help. No MCP, no full conversation, no file writes outside the project.
- The OpenCode adapter delegates to the installed Skill path, so the two cannot diverge.
- Instructions never mention the credential, its file or its header.

- [ ] **Step 1: Write failing tests, requirement-driven.**
  - Skill frontmatter parses; `name` is `hub-export`.
  - The Skill names `export --new`, `export --task` and `export --retry`, and none of the CLI-owned fields as something the Agent sets; the adapter contains a placeholder for the Skill path and no workflow steps of its own.
  - The Skill's steps include: verification from evidence only (no PASS without a recorded check), explicit WIKI references only, no whole-conversation upload, no Stop/Idle or MCP usage.
  - The example content in the docs passes `parseTaskContent` (fixture conformance).
  - `install-agent` into a temp home writes both files, fills the Skill path into the adapter, is idempotent, and refuses to overwrite a user-modified file without `--force`.
  - The Skill and adapter text contain no credential file path and no `X-Knowledge-Hub-Export-Token`.
  - Tests check these properties, not exact prose.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-export-agent-instructions.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the shared Skill, the adapter, `install-agent`, and the setup docs in English and `zh-TW`, covering install, `configure`, `configure --from` for worktrees, and the retry rules.
- [ ] **Step 4: Re-run** the tests; expect PASS. Manually check, in a project other than the Hub repo, that `/hub-export` is discovered and runs in Claude Code and in OpenCode on the available versions, and confirm OpenCode's user-level commands directory against that version. If a tool is unavailable, report it as an explicit verification gap, not as success.
- [ ] **Step 5: Commit** `git add tools/knowledge-hub/agent tools/knowledge-hub/src/install-agent.mjs docs/task-export-setup.md docs/task-export-setup.zh-TW.md tests/unit/task-export-agent-instructions.test.ts && git commit -m 'feat: add shared hub export agent workflow'`.

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
- `TaskLifecycleService.archive(caller, workspaceId, taskResultId)` and `restore(...)`, owner only, under the Workspace lock; `POST /api/workspaces/:workspaceId/task-results/:taskResultId/lifecycle` with `{ action: 'archive' | 'restore' }`, via `establishTrustedCaller()`.
- View URLs: `/w/:workspaceId/tasks` (default ACTIVE, with an archived filter) and `/w/:workspaceId/tasks/:taskResultId`. The detail view shows title, agent, completedAt, summary, findings, decisions, changes, verification evidence and checks, revision history, lifecycle, binding status, reference links, and the archive/restore action. Link titles and availability are computed with current authorization. External URLs are never opened automatically.
- Link rendering: an `href` is emitted only for `https:` PR_URLs and for resolved WIKI links to the current viewer's Workspace route. Anything else renders as plain text.

- [ ] **Step 1: Write failing integration and E2E tests.**
  - Owner sees list and detail, including resolved and unresolved references; an unrelated user or another Workspace gets 404 for read and for lifecycle actions.
  - Archive: the task leaves the default list, appears under the archived filter, stays readable; restore returns it; archiving twice or restoring an active task is a no-op or a 409 consistent with document lifecycle; a new ingest into the archived task is refused (Task 4) and succeeds after restore.
  - Revoked binding: existing tasks stay readable and show the revoked status.
  - Archived Source hides the document link rather than leaking its title.
  - Version switch shows the chosen revision.
  - No sidebar item is added; navigation from home is discoverable.
  - Hostile content: Markdown, HTML, `javascript:` and `data:` values render as inert text; no `href` with an unsafe scheme exists in the rendered DOM.
  - Unicode task content renders correctly.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-reads.test.ts` and `npm run test:e2e -- tests/e2e/task-export-my-space.spec.ts`; expect FAIL.
- [ ] **Step 3: Implement** the read and lifecycle services, the route, the pages and the small UI, using `PageHeader`, the frontend design-language tokens and safe text rendering. Keep current My Space restrictions. Do not mutate the document graph or add Task nodes in this phase.
- [ ] **Step 4: Re-run** the tests; expect PASS. Run the accessibility and responsive checks in Playwright.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application 'src/app/w/[workspaceId]/tasks' src/app/api/workspaces src/components/task-knowledge src/components/knowledge/personal-home.tsx src/server/composition.ts tests && git commit -m 'feat: browse and archive task knowledge in My Space'`.

### Task 10: End-to-End Verification, Documentation, and Final Review

**Files:**
- Create: `tests/e2e/task-export-flow.spec.ts`
- Update: `docs/task-export-setup.md` and `docs/task-export-setup.zh-TW.md`
- Update: `docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md` (record the narrow integration and the Phase 7 dependency; do not mark Phase 7/9 implemented)
- Update: `README.md` and `README.zh-TW.md` (add the design and plan to the "Current canonical documents" table in both languages)
- Create: `docs/superpowers/verification/2026-11-04-task-knowledge-export-verification.md`

**Interfaces:**
- Complete scenario: browser creates a binding → CLI configures the local project (`--allow-insecure-localhost` against the E2E server) → Skill-shaped content piped to `export --new` → the task appears in My Space with a Wiki link → `export --retry` returns 200 EXISTING → `export --task` adds revision 2 → archive refuses a new revision, restore allows it → rotation invalidates the old token → revocation refuses new ingestion while existing tasks stay readable. No browser session can substitute for the export credential in the ingest route.

- [ ] **Step 1: Add E2E coverage** for the flow above, a missing or archived Source, an untrusted foreign Workspace input, and duplicate export. Include tool-compatibility smoke notes for Claude Code and OpenCode from Task 8's manual check.
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e/task-export-flow.spec.ts`; expect FAIL before wiring, then PASS.
- [ ] **Step 3: Reconcile and document** setup, API errors, exit codes and manual retry behavior. Update the roadmap with the explicit scope and the Phase 7 dependency from design §10. Add the design and plan to both README canonical documents tables. Capture the actual tool output in the verification record. No CI claims without observed evidence.
- [ ] **Step 4: Run** `make verify`, `npm run test:integration` and `npm run test:e2e -- tests/e2e/task-export-flow.spec.ts tests/e2e/task-export-my-space.spec.ts`; every process must exit 0. Inspect the changed-file scope and confirm no accidental Folder Sync or Graph behavior change.
- [ ] **Step 5: Commit** `git add docs tests/e2e README.md README.zh-TW.md && git commit -m 'test: verify manual task knowledge export end to end'`; request code review, fix verified findings, and run CI before recommending merge.

---

## Plan self-review / execution gate

**Spec coverage:**
- §3 deviations: Tasks 2 and 4.
- §4 flow, install and worktree configuration: Tasks 7 and 8.
- §5 contract, CLI-owned identity and frozen drafts: Tasks 1 and 7.
- §6 binding, credentials, rotation, storage, archival and lock order: Tasks 2, 3, 4 and 9.
- §7 authentication, exemption, HTTP contract and references: Tasks 5 and 6.
- §8 UI: Task 9.
- §9 failures and verification: Tasks 4, 7, 9 and 10.
- §10 deferrals stay excluded; the Phase 7 dependency is recorded in Task 10.

**Type contract check:** `TaskContentV1`, `TaskArtifactV1` and `TaskReferenceInput` originate in Task 1 and are the CLI's conformance corpus. Services consume only the Task 2 ports, so `task-knowledge` never imports `sources`. Ingest state, identifiers and error codes stay consistent through Tasks 4, 6 and 7.

**Five review-focus classes** are each assigned above. **Dependency order:** 1→2→3→4→5→6→7→8→9→10, with task-level review gates and frequent commits.

**Approval gate:** This plan is for review only. Do not start code, migration, package installation or worktree implementation until the user approves the plan and selects an execution mode. Recommended mode: **Subagent-driven**, because the credential, Workspace authorization and transactional idempotency boundaries deserve independent review per task, followed by whole-branch review.
