# Task Knowledge Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable a developer to invoke `/hub-export` in Claude Code or OpenCode, have the Agent summarize one completed task, and securely save a versioned Task Knowledge asset with exact Wiki links to the owner's My Space.

**Architecture:** A shared Skill (with an OpenCode command adapter) instructs the Agent to write a Task Artifact v1. A portable Node CLI validates and posts it to an isolated Next.js Task Ingestion API using a limited, revocable project credential. A dedicated MariaDB module persists immutable revisions and source-scoped references without altering Folder Sync, the existing Document Graph or Wiki.

**Tech Stack:** Next.js 15, TypeScript 5, Node >=20.19, MariaDB 10.11, existing Vitest/integration harness and Playwright, Claude Code Skill, OpenCode command/Skill. Avoid new runtime packages unless a test demonstrates an unavoidable need.

**Spec:** `docs/superpowers/specs/2026-11-04-task-knowledge-export-design.md`

## Global Constraints

- **Trigger:** manual `/hub-export` only; no Stop/Idle Hook, background daemon or persistent Outbox.
- **Destination:** ACTIVE PERSONAL My Space owned by the authenticated credential owner, never Team Workspace.
- **Scope:** binding selects exactly one ACTIVE FOLDER_SYNC Source; arbitrary Workspace/Source IDs in artifact cannot change it.
- **Summarization:** agent does it using current task context; Hub runs no LLM. Full chat, thinking, terminal logs and source bodies must not be uploaded.
- **References:** WIKI is exact source-relative path or validated Document ID within binding Source; no title/fuzzy ranking, cross-workspace discovery, or semantic extraction.
- **Payload:** schemaVersion=1, status=completed, <=64 KiB UTF-8, <=32 references, stable taskId and positive artifactRevision. Verification is recorded, not certified.
- **Persistence:** one task per `(ownerUserId,bindingId,taskId)`; immutable revision per `(taskResultId,artifactRevision)`; replay same hash is idempotent; differing hash is 409; atomic transaction.
- **Credentials:** independent restricted export credential, hash stored server-side, interactive setup, no token in CLI argv/prompts/logs. Revocation is enforced live.
- **Compatibility:** preserve SOURCE_MANAGED read-only, Folder Sync Preview/Apply, document graph and current Agent Context contracts.
- **Workflow:** TDD for each task, one focused test run plus full relevant suite, one small commit per independently testable task; run `make verify` and DB-backed tests before PR.

## File/ownership map

| Unit | New / changed files | Responsibility |
| --- | --- | --- |
| Contract | `src/modules/task-knowledge/domain/task-artifact.ts`, `task-references.ts`, `task-errors.ts` | Pure parser, canonical hashing, reference normalization, error codes |
| Storage | `src/infrastructure/database/mariadb/migrations/032-task-knowledge-export.ts`, `migrations/index.ts`, `repositories/task-knowledge.ts`, `task-knowledge-transaction.ts`, `src/modules/task-knowledge/ports/{task-export-store,unit-of-work}.ts` | Binding/credential/task/revision/reference tables, repository, isolated transaction |
| Binding | `src/modules/task-knowledge/application/manage-export-binding.ts`, `src/app/api/workspaces/[workspaceId]/task-export-bindings/route.ts`, `.../[bindingId]/route.ts`, `src/app/w/[workspaceId]/tasks/setup/page.tsx`, `src/components/task-knowledge/task-export-setup.tsx` | Browser-authenticated issue/list/revoke, one-time token display, Source chooser |
| Ingestion | `src/modules/task-knowledge/application/ingest-task-result.ts`, `src/app/api/task-results/ingest/route.ts`, `src/server/task-export-services.ts` | Restricted auth, Workspace lock, idempotent persist, HTTP contract |
| Resolution | `src/modules/task-knowledge/application/resolve-task-references.ts` | Exact scoped Wiki lookups, external locators, live availability |
| Read & UI | `src/modules/task-knowledge/application/read-task-results.ts`, `src/app/w/[workspaceId]/tasks/{page.tsx,[taskId]/page.tsx}`, `src/components/task-knowledge/{task-list,task-detail}.tsx`, and localized entry point in `src/components/knowledge/personal-home.tsx` | Personal-only browsing; no new top-level sidebar |
| CLI | `tools/knowledge-hub/package.json`, `bin/knowledge-hub.mjs`, `src/{configure,export,project-config}.mjs` | Local per-project configuration, protected credential, artifact validation and POST |
| Agent | `.claude/skills/hub-export/SKILL.md`, `.opencode/commands/hub-export.md`, `docs/task-export-setup.md` | Shared workflow and simple tool-specific entry point |

Paths above are the intended interfaces, not a license to refactor unrelated modules. The task-knowledge transaction should compose the existing MariaDB repository factory for Workspace/Source/Entry lookups, and its own store for Task rows; do not widen existing SourceUnitOfWork or document mutation permissions merely to add Task features.

## Review Focus: five easy-to-miss failure classes

1. **Duplicate manual export after timeout:** re-running with the same artifact must return the same Task/revision; collision with different payload must fail (Task 4/8).
2. **Revoked binding during a write:** no successful post-revocation commit; lock order/lifecycle checks are consistent with existing Workspace writers (Task 3/4).
3. **Wiki path collisions or traversal:** no best-guess match; no source-root escape, no cross-source/document leakage (Task 1/5).
4. **Two worktrees/projects on one machine:** the CLI must not silently use credentials or a Source mapping from a different project (Task 7).
5. **Agent-invented verification / secret-bearing output:** missing checks must not become PASS, and forbidden content is rejected without logging secret values (Task 1/8/9).

---

### Task 1: Pure Task Artifact Contract and Reference Normalization

**Files:**
- Create: `src/modules/task-knowledge/domain/task-artifact.ts`
- Create: `src/modules/task-knowledge/domain/task-references.ts`
- Create: `src/modules/task-knowledge/domain/task-errors.ts`
- Test: `tests/unit/task-artifact.test.ts`
- Test: `tests/unit/task-references.test.ts`

**Interfaces:**
- Produces `export type TaskArtifactV1`, `parseTaskArtifact(raw: unknown): TaskArtifactV1`, `canonicalTaskHash(artifact: TaskArtifactV1): string` (64-char lowercase SHA-256 hex).
- Produces `normalizeWikiReferencePath(path: string): string` (canonical Source-relative path; throws on absolute/traversal/control chars) and `type TaskReferenceInput` discriminated by `type: 'WIKI' | 'CODE_FILE' | 'COMMIT' | 'PR_URL'`.
- Produces precise `TaskArtifactError(code, message)`; no raw payload included in exception messages.
- `TaskArtifactV1` fields: `schemaVersion: 1`, `bindingId: string`, `taskId: string`, `artifactRevision: number`, `agent: 'claude-code' | 'opencode'`, `status: 'completed'`, `title: string`, `summary: string`, `completedAt: string`, `verification: { status: 'passed' | 'failed' | 'not_run' | 'not_applicable'; checks: string[] }`, optional `findings`, `decisions`, `changes` string arrays and `references: TaskReferenceInput[]`.

- [ ] **Step 1: Write failing tests.** `parseTaskArtifact` accepts the smallest valid completed artifact; rejects `status: 'running'`, omitted `taskId`, `artifactRevision: 0`, a 65-KiB UTF-8 body, 33 references, unknown fields, invalid date, fake verification status, and secret-like fields; accepted result has no unknown keys. Hash is identical for JSON objects with reordered keys, and changes when summary changes. Path parser rejects `../secrets.md`, `/tmp/note.md`, `C:\\secret.md`, controls and source-root escape; accepts `architecture/auth.md`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-artifact.test.ts tests/unit/task-references.test.ts`; expect FAIL (modules not present).
- [ ] **Step 3: Implement** exports with strict typed, bounded runtime validation; reuse `normalizeImportPath` normalization rules where appropriate, but do not permit `..` segments even if they normalize inside root. Use canonical stable serialization before SHA-256. Ensure check descriptions do not get inferred from verification status.
- [ ] **Step 4: Re-run** the same command; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/domain tests/unit/task-artifact.test.ts tests/unit/task-references.test.ts && git commit -m 'feat: define task export artifact contract'`.

### Task 2: MariaDB Tables, Store, and Task-Specific Transaction

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/032-task-knowledge-export.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Create: `src/modules/task-knowledge/ports/task-export-store.ts`
- Create: `src/modules/task-knowledge/ports/unit-of-work.ts`
- Create: `src/infrastructure/database/mariadb/repositories/task-knowledge.ts`
- Create: `src/infrastructure/database/mariadb/task-knowledge-transaction.ts`
- Test: `tests/integration/task-export-storage.test.ts`

**Interfaces:**
- `TaskExportStore` supports `insertBinding(...)`, `getBinding(id)`, `listBindings(ownerId, workspaceId)`, `revokeBinding(id, ownerId)`, `insertCredential(...)`, `findCredentialByHash(hash)`, `revokeCredentialsForBinding(id)`, `findTask(ownerId,bindingId,taskId)`, `insertTask(...)`, `getRevision(taskId,revisionNo)`, `insertRevision(...)`, `insertReferences(...)`, `listTasks(ownerId,workspaceId,cursor,limit)`, `getTaskDetail(taskId)`.
- `TaskKnowledgeRepositories = { taskExports: TaskExportStore; workspaces: WorkspaceRepository; sources: SourceRepository; entries: EntryRepository; documents: DocumentRepository }`.
- `TaskKnowledgeUnitOfWork.run<T>(fn: (r: TaskKnowledgeRepositories) => Promise<T>): Promise<T>`; implementation composes existing repository factory and one task store using the *same* MariaDB connection and transaction.

- [ ] **Step 1: Write failing DB integration tests.** Migration up creates all five tables; FK constraints prevent orphan revisions; unique `(owner_user_id,binding_id,task_id)` and `(task_result_id,revision_no)` reject duplicates; revoking a binding and credentials is atomic; rolling back after reference insertion leaves no Task, revision or reference rows.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-storage.test.ts`; expect FAIL because migration/ports are absent.
- [ ] **Step 3: Implement migration version 32** with `task_export_bindings`, `task_export_credentials`, `task_results`, `task_result_revisions`, `task_result_references`. Store `token_hash` as binary hash with unique index, scope rows by owner/workspace/binding, add lookup/list indexes and FKs. Revision keeps original canonical JSON and content hash; reference keeps original locator, optional resolved Document ID, `RESOLVED | UNRESOLVED | AMBIGUOUS | UNAVAILABLE`. Implement the store and dedicated UoW without expanding Source domain write APIs.
- [ ] **Step 4: Re-run** integration file; expect PASS.
- [ ] **Step 5: Commit** `git add src/infrastructure/database/mariadb src/modules/task-knowledge/ports tests/integration/task-export-storage.test.ts && git commit -m 'feat: persist task export bindings and results'`.

### Task 3: Browser-Authenticated Project Binding and Restricted Credential

**Files:**
- Create: `src/modules/task-knowledge/application/manage-export-binding.ts`
- Create: `src/app/api/workspaces/[workspaceId]/task-export-bindings/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/task-export-bindings/[bindingId]/route.ts`
- Create: `src/app/w/[workspaceId]/tasks/setup/page.tsx`
- Create: `src/components/task-knowledge/task-export-setup.tsx`
- Modify: `src/server/composition.ts` minimally for browser-authenticated binding service
- Test: `tests/integration/task-export-binding.test.ts`
- Test: `tests/unit/task-export-binding-route.test.ts`

**Interfaces:**
- `ManageExportBindingService.create(caller: CallerContext, input: { workspaceId: string; sourceId: string; label: string }): Promise<{ bindingId: string; projectKey: string; token: string }>`; `list(caller, workspaceId)` excludes raw credentials; `revoke(caller,bindingId): Promise<void>`.
- `POST/GET /api/workspaces/:workspaceId/task-export-bindings`, `DELETE /api/workspaces/:workspaceId/task-export-bindings/:bindingId`; all use `establishTrustedCaller()` and check PERSONAL ACTIVE owner, ACTIVE FOLDER_SYNC source in same Workspace. Token generated from `randomBytes(32)`, hashed server-side, returned once in POST response with `Cache-Control: no-store`.

- [ ] **Step 1: Write failing tests.** A My Space owner can select an ACTIVE FOLDER_SYNC Source, create a binding and view a token once in the setup screen, list later without token, and revoke; Team Workspace, viewer/other user, mismatched Source, archived Source/Workspace, and forged caller identity are denied; revocation makes credential unusable on next read; response/body/log never exposes token except in one-time successful creation response.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-binding.test.ts` and `npx vitest run --config vitest.config.ts tests/unit/task-export-binding-route.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** service with locked Workspace owner validation and Source check, stable server-generated binding ID and projectKey, credential hash, revocation; add a minimal setup screen using the authenticated list of Sources, and display token exactly once with no persistent browser storage. Routes use established project HTTP identity/error patterns but never use browser-provided caller grants.
- [ ] **Step 4: Re-run** both tests; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application/manage-export-binding.ts src/app/api/workspaces src/app/w/[workspaceId]/tasks/setup src/components/task-knowledge/task-export-setup.tsx src/server/composition.ts tests && git commit -m 'feat: issue restricted My Space task export bindings'`.

### Task 4: Idempotent Task Ingestion with Revocation-Resistant Authorization

**Files:**
- Create: `src/modules/task-knowledge/application/ingest-task-result.ts`
- Test: `tests/integration/task-export-ingest.test.ts`

**Interfaces:**
- `IngestTaskResultService.ingest(rawToken: string, rawBody: unknown): Promise<{ state: 'CREATED' | 'EXISTING'; taskResultId: string; revisionNo: number; workspaceId: string }>`.
- Token hashes to a live credential, resolves Binding, locks Workspace under the existing governance lock convention, validates PERSONAL/ACTIVE/owner match, and commits task/revision/references in one transaction. Raw token is not logged or stored in result.
- `TaskArtifactV1` from Task 1 and `TaskKnowledgeUnitOfWork` from Task 2 are stable inputs.

- [ ] **Step 1: Write failing integration tests.** First POST creates; exact replay returns EXISTING and same ID; same revision with a different hash yields a 409-mappable domain conflict; revision 2 keeps revision 1; simultaneous identical ingests yield one row; revocation/archival before or concurrent with ingest cannot commit after revocation wins; token cannot move owner/Workspace/Source by modifying payload; DB failure after task insert rolls back every row.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-ingest.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** service, lock ordering and DB unique-constraint conflict handling. Use one transaction; re-query on unique collision to distinguish exact replay from content conflict. Return no sensitive token fields. Initial reference persistence may keep WIKI as UNRESOLVED until Task 5 adds resolution.
- [ ] **Step 4: Re-run** integration file; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application/ingest-task-result.ts tests/integration/task-export-ingest.test.ts && git commit -m 'feat: ingest completed tasks idempotently'`.

### Task 5: Source-Scoped Explicit References

**Files:**
- Create: `src/modules/task-knowledge/application/resolve-task-references.ts`
- Modify: `src/modules/task-knowledge/application/ingest-task-result.ts`
- Test: `tests/integration/task-export-references.test.ts`

**Interfaces:**
- `resolveTaskReferences(r: TaskKnowledgeRepositories, boundSourceId: string, references: readonly TaskReferenceInput[]): Promise<ResolvedTaskReference[]>`, where each result includes original locator, type, resolution status, nullable Document ID, ordinal.
- `readTaskReferenceAvailability(caller: CallerContext, reference: ResolvedTaskReference): Promise<'RESOLVED' | 'UNAVAILABLE'>` for UI link rendering. A resolved historical ID never grants read access.

- [ ] **Step 1: Write failing tests.** Exact `architecture/auth.md` in bound Source resolves to its Document ID; same path in another Source is ignored; missing, inactive, archived, path case collision and ambiguous references do not guess; `../../` and absolute paths are rejected; after a document moves, previously resolved Task still points to same ID with newly verified live path; archive/revoke makes link unavailable and does not reveal a document title to nonmembers; CODE_FILE/COMMIT/PR_URL remain external only.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-references.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** precise scoped resolution using existing SourceEntry/Document repositories. Do **not** call `buildLinkResolver` ranked title matching. Save result in same Task 4 transaction; check availability again on every read. Keep original path and resolution evidence.
- [ ] **Step 4: Re-run** integration file; expect PASS.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application tests/integration/task-export-references.test.ts && git commit -m 'feat: resolve exact bound-source wiki references'`.

### Task 6: Task Ingestion HTTP Contract

**Files:**
- Create: `src/server/task-export-services.ts`
- Create: `src/app/api/task-results/ingest/route.ts`
- Test: `tests/unit/task-export-ingest-route.test.ts`
- Test: `tests/integration/task-export-http.test.ts`

**Interfaces:**
- `POST /api/task-results/ingest` reads `Authorization: Bearer <credential>` and JSON body capped at 64 KiB, calls `IngestTaskResultService`, sends `{taskResultId, revisionNo, url}` with 201 for CREATED / 200 for EXISTING; `url` is a same-origin relative path, and CLI joins it with its configured HTTPS origin (never a client-supplied Host header). Do not use normal Workspace browser route wrapper because it assumes an interactive session.
- Error mapping: 400/422 invalid request, 401 credential invalid, 403 unauthorized or revoked scope, 409 revision/hash conflict, 429/503 retryable. `Cache-Control: private, no-store` on every response.

- [ ] **Step 1: Write failing tests.** Valid restricted token returns 201 then 200 on same payload; browser Cookie without Export Credential cannot ingest; missing/malformed Bearer returns 401; oversized payload rejected before JSON parse; invalid JSON/unsupported version returns 400/422; no raw token/content in log or error; expired/revoked token fails; transient DB errors return retriable class without false success.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-export-ingest-route.test.ts` then `npm run test:integration -- tests/integration/task-export-http.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** simple route and isolated service composition with the project's existing error mapping conventions; no dependency on UI browser session. Avoid returning links to documents whose read permission has not been established.
- [ ] **Step 4: Re-run** both test files; expect PASS.
- [ ] **Step 5: Commit** `git add src/server/task-export-services.ts src/app/api/task-results tests && git commit -m 'feat: expose scoped task result ingest API'`.

### Task 7: Portable Shared CLI and Safe Manual Retry

**Files:**
- Create: `tools/knowledge-hub/package.json`
- Create: `tools/knowledge-hub/bin/knowledge-hub.mjs`
- Create: `tools/knowledge-hub/src/configure.mjs`
- Create: `tools/knowledge-hub/src/project-config.mjs`
- Create: `tools/knowledge-hub/src/export.mjs`
- Test: `tests/unit/task-export-cli.test.ts`

**Interfaces:**
- `knowledge-hub configure` prompts for HTTPS Hub URL, bindingId and restricted token (hidden prompt or stdin without echo); saves per-project local config outside the repo, keyed by canonical Git common-dir with an explicit profile override for independent Source bindings, keeps token in secure OS storage when possible and otherwise uses permission-restricted user storage with clear warning. Never take secret from argv.
- `knowledge-hub export --input <file>` validates artifact and local binding, POSTs with Bearer header, prints task URL on 200/201, reports status on errors, and keeps input file unchanged so `export --input` is a reliable explicit retry. No background daemon or automatic retries.
- CLI is Node >=20.19 with built-in fetch/crypto/fs; no Hub app dependency and no need to import Next.js TypeScript at runtime. Use fixture JSON/schema conformance tests against Task 1.

- [ ] **Step 1: Write failing CLI tests.** Configure in temp user home never writes token under repo; two projects/worktrees select the correct binding and do not silently cross-use another's; reject insecure URL except explicit local development; malformed input never calls fetch; 201 and 200 both print URL; network timeout or 503 keeps file and exits nonzero; retry sends identical taskId/revision/content; no bearer token in stdout/stderr, spawn args, exception or local Git-tracked files; Windows path conventions do not cause credentials to leak.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-export-cli.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the standalone CLI, direct HTTP request, hidden credential input and per-project mapping; make `--input` required so Agent saves JSON before sending and can retry it. Prefer core Node and no package installation in the user's target project beyond the CLI itself.
- [ ] **Step 4: Re-run** CLI unit tests; expect PASS.
- [ ] **Step 5: Commit** `git add tools/knowledge-hub tests/unit/task-export-cli.test.ts && git commit -m 'feat: add manual task export cli'`.

### Task 8: Claude Code and OpenCode Manual Entry Points

**Files:**
- Create: `.claude/skills/hub-export/SKILL.md`
- Create: `.opencode/commands/hub-export.md`
- Create: `docs/task-export-setup.md`
- Test: `tests/unit/task-export-agent-instructions.test.ts`

**Interfaces:**
- User types `/hub-export`. Skill instructs the Agent to (a) identify just-completed task in available context, (b) inspect concrete verification evidence and explicit Wiki references, (c) write a valid TaskArtifactV1 to a local user-controlled temporary file, (d) call `knowledge-hub export --input <file>`, (e) report success URL or exact failure and the retry path. No need to invoke MCP or copy full conversation.
- OpenCode command delegates to the shared Skill; use `.claude/skills/hub-export/SKILL.md` as the canonical prompt to prevent divergence. Instructions must never ask the Agent to read or print auth secrets.

- [ ] **Step 1: Write failing instruction/fixture tests.** YAML frontmatter and Skill name match; Claude slash invocation and OpenCode command discovery work with the supported versions; both instructions reference the same JSON schema, no MCP, no Stop/Idle; contain explicit prohibition on fabricated PASS, cross-source Wiki guesses and uploading whole conversation; an example summary validates via Task 1 parser; invocation clearly reports a retryable file path on POST failure.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/task-export-agent-instructions.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** shared Skill, minimal OpenCode command adapter and setup docs. Include environment-specific smoke steps for both tools; use supported manual slash-command syntax rather than relying on automatic Skill discovery alone.
- [ ] **Step 4: Re-run** instruction tests; expect PASS. Manually test `/hub-export` discovery in Claude Code and OpenCode on the versions available; if unavailable, report as an explicit verification gap rather than claiming success.
- [ ] **Step 5: Commit** `git add .claude/skills/hub-export .opencode/commands/hub-export.md docs/task-export-setup.md tests/unit/task-export-agent-instructions.test.ts && git commit -m 'feat: add shared hub export agent workflow'`.

### Task 9: Authorized Task Reads and My Space UI

**Files:**
- Create: `src/modules/task-knowledge/application/read-task-results.ts`
- Create: `src/app/w/[workspaceId]/tasks/page.tsx`
- Create: `src/app/w/[workspaceId]/tasks/[taskId]/page.tsx`
- Create: `src/components/task-knowledge/task-list.tsx`
- Create: `src/components/task-knowledge/task-detail.tsx`
- Modify: `src/components/knowledge/personal-home.tsx` (small discoverable link; *no* main sidebar entry)
- Test: `tests/integration/task-export-reads.test.ts`
- Test: `tests/e2e/task-export-my-space.spec.ts`

**Interfaces:**
- `TaskResultReadService.list(caller: CallerContext, workspaceId: string, cursor?: string): Promise<TaskResultPage>` and `get(caller: CallerContext, workspaceId: string, taskResultId: string): Promise<TaskResultDetail>`. Caller must be owner of requested ACTIVE PERSONAL Workspace; never permit credential-only API token to read.
- View URLs: `/w/:workspaceId/tasks`, `/w/:workspaceId/tasks/:taskId`. Detail shows title, agent, completedAt, summary, findings, decisions, changes, verification evidence, immutable revision history and safe reference links. Link titles/availability are computed with current authorization; external URLs are not opened automatically.

- [ ] **Step 1: Write failing integration and E2E tests.** Owner sees list/detail including resolved and unresolved references; unrelated user or another Workspace receives 404; archived Source hides document link rather than leaking title; version switch shows appropriate revision; no sidebar item is added; navigation from home is discoverable; Unicode and hostile Markdown/HTML task content is rendered as inert text, never executed.
- [ ] **Step 2: Run** `npm run test:integration -- tests/integration/task-export-reads.test.ts` and targeted `npm run test:e2e -- tests/e2e/task-export-my-space.spec.ts`; expect FAIL.
- [ ] **Step 3: Implement** authorized read service, server routes and small UI using `PageHeader`, frontend design-language tokens, safe text rendering. Maintain current My Space restrictions; do not mutate document graph or add task nodes in this phase.
- [ ] **Step 4: Re-run** tests; expect PASS. Run React/TS accessibility and responsive checks in Playwright.
- [ ] **Step 5: Commit** `git add src/modules/task-knowledge/application/read-task-results.ts src/app/w src/components/task-knowledge src/components/knowledge/personal-home.tsx tests && git commit -m 'feat: browse task knowledge in My Space'`.

### Task 10: End-to-End Verification, Documentation, and Final Review

**Files:**
- Create: `tests/e2e/task-export-flow.spec.ts`
- Update: `docs/task-export-setup.md`
- Update: `docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md` (record narrow integration, do not mark Phase 7/9 implemented)
- Create: `docs/superpowers/verification/2026-11-04-task-knowledge-export-verification.md`

**Interfaces:**
- Complete scenario: browser creates/revokes binding → CLI configures local project → Skill-generated fixture → CLI exports → task appears in My Space with Wiki link → same artifact re-POST returns EXISTING → revoked binding refuses new ingestion. No browser session can substitute for Export Credential in the ingest route.

- [ ] **Step 1: Add E2E coverage** for working My Space end-to-end, missing/archived Source, untrusted foreign Workspace input, duplicate export and revoked token; include tool-compatibility smoke notes for Claude/OpenCode and manual verification of command discovery.
- [ ] **Step 2: Run targeted E2E** `npm run test:e2e -- tests/e2e/task-export-flow.spec.ts`; expect FAIL before fixtures/integration are complete, then PASS once wired.
- [ ] **Step 3: Reconcile and document** setup, API errors and manual retry behavior; update roadmap with explicit scope; capture actual tool run output in verification record. No CI claims without observed evidence.
- [ ] **Step 4: Run** `make verify`, `npm run test:integration`, `npm run test:e2e -- tests/e2e/task-export-flow.spec.ts tests/e2e/task-export-my-space.spec.ts`; expect every process exit 0. Inspect changed-file scope and check there is no accidental Folder Sync/Graph behavior change.
- [ ] **Step 5: Commit** `git add docs tests/e2e && git commit -m 'test: verify manual task knowledge export end to end'`; request code review, fix verified findings, and run CI before recommending merge.

---

## Plan self-review / execution gate

**Spec coverage:** trigger (8), schema (1), My Space binding/credential (2–3), permission + idempotency (4/6), references (5), CLI + manual retry (7), Agent output (8), UI (9), E2E + roadmap (10). Deferrals remain excluded. **Type contract check:** TaskArtifactV1 and TaskReferenceInput originate in Task 1; all services consume the same dedicated TaskKnowledgeUnitOfWork from Task 2; returned ingest state and identifiers stay consistent through Tasks 4/6/7. **Five review-focus tests** are each assigned above. **Dependency order:** 1→2→3→4→5→6→7→8→9→10, with task-level review gates and frequent commits. Most decisions are explicit; implementation remains intentionally unwritten.

**Approval gate:** This plan is for review only. Do not start code, migration, package installation or worktree implementation until the user approves the plan and selects an execution mode. Recommended mode: **Subagent-driven**, because the credential, Workspace authorization and transactional idempotency boundaries deserve independent review per task, followed by whole-branch review.
