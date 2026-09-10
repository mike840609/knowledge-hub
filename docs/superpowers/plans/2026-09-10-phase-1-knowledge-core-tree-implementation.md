# Phase 1 Knowledge Core & Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Knowledge Core & Tree behavior on top of the Phase 0 Workspace foundation so Knowledge Hub has stable UUIDv7 document identity, immutable revisions, safe hierarchy mutation, lifecycle provenance, source mapping primitives, Workspace-aware caller access, and a read-only browser that Phase 2 can reuse without bypassing core rules.

**Architecture:** Keep the Phase 0 modular monolith and MariaDB transaction/repository boundaries. Inherit `Workspace`, `WorkspaceMembership`, `KnowledgeSource.workspace_id`, application-generated UUIDv7 with MariaDB native `UUID`, explicit `CallerContext`, READ COMMITTED canonical mutation transactions, lifecycle provenance, and one-document-one-TreeNode uniqueness. Phase 1 adds only the SourceEntry→TreeNode schema refinement plus complete Knowledge application services. Human Hub mutations and future source projection mutations use separate interfaces while sharing Workspace policy, domain rules, repositories, locks, and transactions. The browser consumes read application services only; Workspace administration, ingestion, Title Resolution, matching, diff, Preview/Confirm/Apply, authoring, search, MCP, publishing, Agent actor modeling, and Agent Memory remain outside this phase.

**Tech Stack:** Next.js App Router, React, TypeScript strict, Tailwind CSS, shadcn/ui Base UI, MariaDB 10.11, official `mariadb` Node.js connector, Vitest unit/integration tests, Playwright Chromium E2E, npm.

**Spec:** `docs/superpowers/specs/2026-09-10-phase-1-knowledge-core-tree-design.md`

## Global Constraints

- Phase 0 Foundation & Architecture must be implemented and verified before Phase 1 completion can be claimed.
- Phase 0 canonical scope is `User → WorkspaceMembership → Workspace → KnowledgeSource → Tree/Document`; `User.org_code` is identity metadata, not Knowledge authorization.
- Every KnowledgeSource has exactly one `workspace_id`; Document workspace scope is derived through Source and is not duplicated on Document.
- Preserve module direction: `identity`, `workspaces`, `sources → knowledge`; Knowledge must not import scanner/sync implementations.
- Public application read/write services receive `CallerContext` explicitly as the first parameter; caller identity does not come from command/query payload or ambient global request state.
- Existing resource operations resolve authoritative Source → Workspace and enforce Workspace policy. UI workspace selection or a client-supplied workspaceId is never authorization evidence.
- Phase 0–2 WorkspaceMembership is a local/mock foundation guard. Company production multi-user governance requires Phase 3.
- Preserve stable `KnowledgeDocument.id`; path, filename, title, hash, TreeNode ID, Workspace ID, external ID, and tKMS ID never replace Document identity.
- Revision content is exactly `title + markdown + metadata`; hierarchy, path, position, locator, Workspace navigation state, and lifecycle are not revision content.
- SOURCE_MANAGED canonical Title Resolution is Phase 2 responsibility.
- KnowledgeRevision is immutable; no update/delete revision repository method is allowed.
- Lifecycle remains `ACTIVE | ARCHIVED`; lifecycle-bearing Source/Entry/TreeNode/Document rows maintain `updated_by`, `archived_by`, and `archived_at` as current-state provenance. Complete append-only history remains Phase 3 responsibility.
- Workspace provisioning/create/rename/archive/restore, membership administration, roles/capabilities, Team/SSO Group mapping, and production ACL are Phase 3 responsibilities.
- Phase 0–2 provenance continues to reference trusted users. Do not add `actor_kind`, polymorphic actor FKs, or an Agent Principal model in Phase 1.
- `SOURCE_MANAGED` is not editable through Hub commands. Do not introduce `force`, `bypassOwnership`, `isSync`, or UI-controlled escape flags.
- Source projection is an internal application boundary for Phase 2; do not expose it as a public Web mutation endpoint.
- A KnowledgeSource is the logical Tree root; Workspace is a Source container, not a synthetic Tree folder.
- A Document has exactly one DOCUMENT TreeNode and cannot move across Source through normal Tree operations; ordinary Tree/Sync operations cannot transfer a Source across Workspace.
- Folder archive does not implicitly cascade to active descendants.
- Source archive is a visibility gate and does not rewrite every descendant lifecycle status.
- Default reads exclude archived Sources/Documents/Tree nodes unless `includeArchived: true` is explicitly requested.
- Every canonical mutation transaction uses READ COMMITTED on one MariaDB connection plus required Source/Document `FOR UPDATE` locks.
- Tests that claim concurrency safety use at least two real MariaDB connections, not mocks.
- Phase 1 does not add folder upload/scanning, Title Resolution, matching heuristics, diff, Preview/Confirm/Apply, Workspace administration, rich editor, keyword search, vectors, Company SSO, tKMS, MCP, binary storage, Agent actor modeling, or Agent Memory.

---

## 1. Starting State and Reconciliation Gate

The Phase 0 implementation used by this plan must implement the current Workspace-first Phase 0 design, not the superseded org-scoped model.

Reviewed baseline: `3dda1e3` (Phase 0 merge). Verification evidence: `docs/superpowers/verification/2026-09-10-phase-0-foundation-verification.md`. This identifies reviewed code, not a claim that Phase 1 checks have run.

| Existing implementation | Phase 1 disposition |
| --- | --- |
| `knowledge/application/service.ts` — KnowledgeApplicationService | Split/adapt Hub commands and queries; retain existing invariants and add stale-write/ACTIVE validation |
| `knowledge/application/mutations.ts` — ControlledKnowledgeOperations | Reuse internal transaction-bound mutations for projection; no nested UoW |
| `sources/application/source-version-guard.ts` — SourceApplicationService | Preserve version guard, rollback and separate FAILED recording; extend mapping/lifecycle contracts |
| `workspaces/application/workspace-query-service.ts`, `ports/workspace-access-policy.ts` | Reuse actual Workspace query and transaction-scoped policy |
| `server/composition.ts` | Update existing composition instead of creating a parallel service container |
| `knowledge/domain/content.ts` | Extend canonicalization with explicit legacy comparison (§13.1 of spec) |
| migrations `001`–`003`, `scripts/db/migrate.ts` | Preserve checksums/ledger; add preflight and forward mapping upgrade |
| `app/knowledge/actions.ts`, create form, `tests/e2e/knowledge-smoke.spec.ts` | Retire Web creation surface; migrate smoke to read-only browsing while preserving core coverage |

Expected Phase 0 layout:

```text
src/modules/identity/
src/modules/workspaces/
src/modules/knowledge/
src/modules/sources/
src/infrastructure/database/mariadb/
src/server/
tests/unit/
tests/integration/
tests/e2e/
```

Expected Phase 0 contracts include `WorkspaceQueryService`, `WorkspaceAccessPolicy`, Workspace/Membership repositories, `KnowledgeSource.workspace_id`, `KnowledgeUnitOfWork`, document/revision/tree repositories, Source policy/view, `UserIdentity`, explicit `CallerContext`, server-side Local Identity, UUIDv7 generation, READ COMMITTED transaction setup, lifecycle provenance, and one-document-one-TreeNode DB protection.

Before Task 1, compare actual Phase 0 output against this plan. If names differ but responsibilities are equivalent, keep actual Phase 0 naming consistently across Phase 1. Do not create duplicate parallel repositories/services merely to satisfy a filename in this document.

## 2. File Map

Phase 1 is expected to create or modify focused units. If Phase 0 already created a named file, modify it instead of duplicating responsibility.

```text
src/modules/identity/
└── application/
    └── caller-context.ts

src/modules/workspaces/
├── application/
│   └── workspace-query-service.ts
└── ports/
    └── workspace-access-policy.ts

src/modules/knowledge/
├── domain/
│   ├── content.ts
│   ├── document.ts
│   ├── revision.ts
│   ├── tree-node.ts
│   └── errors.ts
├── application/
│   ├── hub-knowledge-command-service.ts
│   ├── source-knowledge-projection-service.ts
│   ├── knowledge-query-service.ts
│   └── internal/
│       ├── create-document.ts
│       ├── create-revision.ts
│       ├── move-tree-node.ts
│       ├── reorder-tree-node.ts
│       ├── set-document-lifecycle.ts
│       └── set-folder-lifecycle.ts
└── ports/
    ├── document-repository.ts
    ├── revision-repository.ts
    ├── tree-repository.ts
    ├── source-policy.ts
    └── unit-of-work.ts

src/modules/sources/
├── application/
│   └── source-entry-mapping-service.ts
└── ports/
    └── entry-repository.ts

src/infrastructure/database/mariadb/
├── migrations/
│   ├── 004-phase-1-tree-mapping.ts
│   └── 005-phase-1-tree-mapping-constraints.ts
└── repositories/
    ├── documents.ts
    ├── revisions.ts
    ├── tree.ts
    ├── entries.ts
    └── source-policy.ts

src/server/
├── composition.ts
└── actions/
    └── knowledge-read.ts

src/app/knowledge/
├── page.tsx
└── [documentId]/page.tsx

src/components/knowledge/
├── workspace-selector.tsx
├── source-selector.tsx
├── knowledge-tree.tsx
├── document-viewer.tsx
├── revision-history.tsx
└── archived-toggle.tsx

tests/unit/
├── phase1-contracts.test.ts
├── phase1-content.test.ts
├── phase1-tree-rules.test.ts
├── phase1-ownership.test.ts
└── phase1-read-model.test.ts

tests/integration/
├── phase1-schema.test.ts
├── phase1-workspace-access.test.ts
├── phase1-revisions.test.ts
├── phase1-tree.test.ts
├── phase1-lifecycle.test.ts
├── phase1-source-mapping.test.ts
├── phase1-authority.test.ts
└── phase1-concurrency.test.ts

tests/e2e/
└── phase1-knowledge-browser.spec.ts
```

## 3. Shared Interfaces

These signatures are the cross-task contract. Do not rename them mid-plan without updating every consumer.

```ts
import type { CallerContext } from "@/modules/identity/application/caller-context";

export type WorkspaceView = {
  id: string;
  name: string;
};

export interface WorkspaceQueryService {
  listWorkspaces(caller: CallerContext): Promise<WorkspaceView[]>;
}

export type RevisionContentInput = {
  title: string;
  markdown: string;
  metadata: Record<string, unknown>;
};

export type CreateHubDocumentInput = RevisionContentInput & {
  sourceId: string;
  parentId: string | null;
  position?: number;
};

export type CreateRevisionInput = RevisionContentInput & {
  documentId: string;
  expectedCurrentRevisionId: string;
};

export type MoveTreeNodeInput = {
  nodeId: string;
  newParentId: string | null;
  newPosition: number;
};

export type SourceView = {
  id: string;
  workspaceId: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  ownership: "SOURCE_MANAGED" | "HUB_MANAGED";
};

export type KnowledgeTreeItem =
  | {
      type: "folder";
      id: string;
      parentId: string | null;
      label: string;
      position: number;
      status: "ACTIVE" | "ARCHIVED";
    }
  | {
      type: "document";
      id: string;
      parentId: string | null;
      documentId: string;
      label: string;
      currentRevisionId: string;
      position: number;
      status: "ACTIVE" | "ARCHIVED";
    };

export type KnowledgeRevisionView = {
  id: string;
  documentId: string;
  revisionNo: number;
  title: string;
  markdown: string;
  metadata: Record<string, unknown>;
  contentHash: string;
  createdBy: string;
  createdAt: Date;
};
```

Application service contracts:

```ts
export interface HubKnowledgeCommandService {
  createDocument(caller: CallerContext, input: CreateHubDocumentInput): Promise<{ documentId: string; revisionId: string; treeNodeId: string }>;
  createRevision(caller: CallerContext, input: CreateRevisionInput): Promise<{ revisionId: string; revisionNo: number; changed: boolean }>;
  renameFolder(caller: CallerContext, input: { nodeId: string; name: string }): Promise<void>;
  createFolder(caller: CallerContext, input: { sourceId: string; parentId: string | null; name: string; position?: number }): Promise<{ treeNodeId: string }>;
  moveTreeNode(caller: CallerContext, input: MoveTreeNodeInput): Promise<void>;
  reorderTreeNode(caller: CallerContext, input: { nodeId: string; newPosition: number }): Promise<void>;
  archiveDocument(caller: CallerContext, documentId: string): Promise<void>;
  restoreDocument(caller: CallerContext, documentId: string): Promise<void>;
  archiveFolder(caller: CallerContext, treeNodeId: string): Promise<void>;
  restoreFolder(caller: CallerContext, treeNodeId: string): Promise<void>;
}

// Factory is internal composition code, never a transport input.
// Binds commands to the existing SourceRepositories transaction and authorized Source.
export type SourceMappingInput = {
  sourceEntryId: string; // preallocated stable UUIDv7, not necessarily an existing row
  externalId: string | null;
  sourcePath: string;
};
export interface SourceKnowledgeProjectionService {
  projectDocument(caller: CallerContext, input: CreateHubDocumentInput & { mapping: SourceMappingInput }): Promise<{ documentId: string; revisionId: string; treeNodeId: string }>;
  projectRevision(caller: CallerContext, input: CreateRevisionInput): Promise<{ revisionId: string; revisionNo: number; changed: boolean }>;
  projectFolder(caller: CallerContext, input: { sourceId: string; mapping: SourceMappingInput; parentId: string | null; name: string; position?: number }): Promise<{ treeNodeId: string }>;
  renameProjectedFolder(caller: CallerContext, input: { nodeId: string; name: string }): Promise<void>;
  archiveProjectedFolder(caller: CallerContext, nodeId: string): Promise<void>;
  restoreProjectedFolder(caller: CallerContext, nodeId: string): Promise<void>;
  moveProjectedNode(caller: CallerContext, input: MoveTreeNodeInput): Promise<void>;
  archiveProjectedDocument(caller: CallerContext, documentId: string): Promise<void>;
  restoreProjectedDocument(caller: CallerContext, documentId: string): Promise<void>;
}

export interface SourceLifecycleCommands {
  archiveSource(caller: CallerContext, sourceId: string): Promise<void>;
  restoreSource(caller: CallerContext, sourceId: string): Promise<void>;
}

export interface KnowledgeQueryService {
  listSources(caller: CallerContext, workspaceId: string, input?: { includeArchived?: boolean }): Promise<SourceView[]>;
  getSource(caller: CallerContext, sourceId: string, input?: { includeArchived?: boolean }): Promise<SourceView>;
  listTree(caller: CallerContext, sourceId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeTreeItem[]>;
  getDocument(caller: CallerContext, documentId: string, input?: { includeArchived?: boolean }): Promise<{ documentId: string; sourceId: string; workspaceId: string; status: "ACTIVE" | "ARCHIVED"; currentRevision: KnowledgeRevisionView }>;
  getCurrentRevision(caller: CallerContext, documentId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeRevisionView>;
  getRevision(caller: CallerContext, documentId: string, revisionNo: number, input?: { includeArchived?: boolean }): Promise<KnowledgeRevisionView>;
  listRevisions(caller: CallerContext, documentId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeRevisionView[]>;
  getAncestors(caller: CallerContext, nodeId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeTreeItem[]>;
}
```

`listSources` uses workspaceId as query scope and must verify caller access. `getSource`, `listTree`, `getDocument`, and revision reads resolve Workspace from the resource relationship; a client-provided workspaceId is not an authorization proof. All IDs are standard UUID strings at the application boundary; MariaDB storage uses native `UUID`. `createdBy` remains a user ID in Phase 1.

---

### Task 1: Reconcile Phase 0 Output and Lock Phase 1 Contracts

**Files:** actual Phase 0 application/repository/migration/test/composition files; modify equivalent naming only when necessary.

- [ ] **Step 1: Run the complete Phase 0 verification baseline**

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

Expected: every Phase 0 check passes. If one fails, fix Phase 0 under its own scope before implementing Phase 1.

- [ ] **Step 2: Inventory the actual Phase 0 interfaces**

Explicitly verify:

```text
workspaces + workspace_memberships exist
KnowledgeSource.workspace_id is authoritative Source scope
knowledge_sources.org_code does not exist as access ownership
cross-org member allow + same-org non-member deny tests exist
resource UUID cannot bypass Workspace policy
ID storage = MariaDB native UUID
ID generation = application UUIDv7
public application caller = explicit CallerContext
canonical mutation isolation = READ COMMITTED
Document TreeNode uniqueness already exists
lifecycle-bearing rows have updated_by / archived_by / archived_at
```

- [ ] **Step 3a: Complete error foundations against the existing services**

Complete this step within Task 1 using the existing Phase 0 services. Define §5 error classes/codes and migrate existing applicable error sites; codes for operations not yet present are wired and behavior-tested by the task introducing that operation. Do not change service signatures or remove existing services in Task 1. Keep existing SourceReadOnlyError class identity with new SOURCE_MANAGED_READ_ONLY code, preserving instanceof consumers; retain ValidationError/NotFoundError/IntegrityError as compatible bases and add precise subclasses for targeted Knowledge failures. New KnowledgeError used by candidate validation must be defined under the shared DomainError hierarchy. Keep IDENTITY_ERROR and source VERSION_CONFLICT unchanged; add distinct REVISION_CONFLICT. WorkspaceAccessDeniedError remains in Workspaces; WORKSPACE_NOT_FOUND is added there. No global string replacement of unrelated errors.

- [ ] Map old NOT_FOUND sites to resource-specific not-found subclasses, VALIDATION_ERROR sites to the declared semantic validation codes, INTEGRITY_ERROR Knowledge integrity sites to INTEGRITY_VIOLATION, and SOURCE_READ_ONLY to SOURCE_MANAGED_READ_ONLY while preserving the class above. Define remaining §5 codes now; Tasks 4–8 wire them to newly introduced operations; update DB error mapping only where semantics are known.
- [ ] Update class/code assertions in `tests/integration/core.test.ts`, `tests/unit/domain-rules.test.ts` and all affected tests. Verify preserved Identity/source-version errors and new revision-conflict distinction.

- [ ] **Step 3b: Add compile-time contract tests for §3**

Create `tests/unit/phase1-contracts.test.ts` that imports standalone Workspace/Knowledge interface declarations and instantiates typed stubs; no not-yet-created service implementation imports are required. Ensure caller is a distinct first argument and cannot be smuggled inside input types.

- [ ] **Step 4: Run typecheck and existing tests**

```sh
npm run typecheck
npm run test:unit
npm run test:integration
```

- [ ] **Step 5: Commit**

```sh
git add src tests
git commit -m "chore: align phase 1 knowledge contracts"
```

---

The current `scripts/test/integration.ts` does not forward CLI filters. Commands below intentionally run the full isolated integration suite; do not claim targeted execution from an ignored argument. If filtering is added later, forward and verify arguments explicitly.

### Task 2: Add Phase 1 SourceEntry→TreeNode Schema Refinement

**Files:** migrations `004-phase-1-tree-mapping.ts`, `005-phase-1-tree-mapping-constraints.ts`, migration registry, `scripts/db/migrate.ts`, new `scripts/db/backfill-source-tree-mapping.ts`, entry repositories/types/writers/fixtures, `tests/integration/phase1-schema.test.ts` and migration-runner tests.

**Contract:** spec §5.3 is authoritative. Operator mappings never enter manifest statements or checksum. 004 expands schema, an independent parameterized DML script backfills, 005 tightens constraints.

- [ ] Implement `--to` CLI and runner target-version support: validate ledger against full manifest, execute only versions up to target, reject targets below applied versions. Preserve 001–003 checksums.
- [ ] Add read-only preflight with operator JSON Folder mapping and deterministic Document mapping. Support pre-004 schema; reject incomplete/wrong-type/cross-source/duplicate mappings without writes.
- [ ] Implement fixed 004 nullable-column DDL; no injected mapping data or generated per-environment statements.
- [ ] Implement independent backfill script with dry-run/apply, parameterized SQL, all-or-nothing DML, idempotent matching rows, and rejection of conflicting existing mapping. Hold write quiescence through upgrade.
- [ ] Implement fixed 005 NOT NULL, same-source FK, entry→node uniqueness, and DOCUMENT `(document_id, tree_node_id)` FK using the additional referenced `(document_id, id)` unique key. Preserve existing single-document uniqueness. Folder target node type is an explicit application assertion; test wrong-type writes through commands and preflight.
- [ ] Extend Migration with optional fixed-code `beforeApply` hook receiving the runner connection via a read-query-only contract; attach it to 005 and invoke under the migration lock before RUNNING ledger insertion. Keep checksum hashing only statements; hook has no operator input, writes or dynamic SQL manifest generation. Add hook-order/failure/no-ledger tests. Add the 005 readiness gate: incomplete mapping blocks without FAILED/RUNNING pollution. Empty schema passes. Do not dynamically alter migration statements.
- [ ] Update entry types, repositories, writers, seeds and fixtures for required mapping.
- [ ] Test populated 001–003 → 004 → script → 005, archived rows, explicit Folder/empty mapping, preflight zero changes, DML rollback, script rerun, blocked-005 recovery, unchanged checksums on full migrate rerun, and DDL interrupted-state diagnostics.
- [ ] Run the fresh DB suite with the exact same committed manifest as populated-upgrade tests; no environment-dependent 004. Run `npm run test:integration`.
- [ ] Test and document untargeted migrate on pending populated data: 004 becomes APPLIED, 005 gate exits without a ledger row; backfill then rerun succeeds without ledger repair. A DB without pending entries may proceed directly.
- [ ] Document target-version commands, backup/quiescence, script input validation and explicit DDL/ledger repair. Do not claim DDL rollback or silently repair checksums.

---

### Task 3: Finalize Revision Canonicalization and Immutable Revision Repository

**Files:** `content.ts`, `revision.ts`, revision repository/adapter, `phase1-content.test.ts`, `phase1-revisions.test.ts`.

Canonical content:

```ts
// Candidate-only validator. Never pass a stored legacy row through this function.
export function normalizeRevisionContent(input: RevisionContentInput): RevisionContentInput {
  const title = input.title.trim();
  if (!title) throw new KnowledgeError("INVALID_TITLE");

  return {
    title,
    markdown: input.markdown.replace(/\r\n/g, "\n"),
    metadata: canonicalizeJsonObject(input.metadata),
  };
}
```

Fingerprint:

```ts
const payload = `knowledge-revision:v1\0${canonicalJson(normalized)}`;
const contentHash = createHash("sha256").update(payload, "utf8").digest("hex");
```

- [ ] Write failing unit tests: title trim/non-empty, CRLF→LF, recursive object-key sorting, array order, metadata/title/body-only changes, invalid JSON values.
- [ ] Run `npm run test:unit -- phase1-content` and observe expected failure.
- [ ] Implement a separate stored-side comparison normalizer permitting empty trimmed legacy title; candidate-only normalization retains non-empty validation. Implement canonicalization/fingerprinting and spec §13.1 legacy comparator. Compare canonical payloads after stale-current validation, never old stored hash versus new hash. Preserve all historical revision fields; return the existing revision on canonical NOOP.
- [ ] Add Phase 0-encoded fixtures for plain equal content, title trim, CRLF, metadata order, real changes, and legacy whitespace-only title read/correction. Do not rewrite old revisions or SourceEntry hashes in a bulk migration; update entry fingerprint only during successful controlled apply.
- [ ] Write failing integration tests for R1/current pointer, identical NOOP, changed R2, byte-stable R1, unique revision numbers, no update/delete API.
- [ ] Implement immutable repository methods only: insert/read/list/current.
- [ ] Run unit/integration tests and commit `feat: finalize immutable knowledge revisions`.

---

### Task 4: Implement HubKnowledgeCommandService for HUB_MANAGED Content

**Files:** `hub-knowledge-command-service.ts`, internal create-document/create-revision, errors, composition, `phase1-authority.test.ts`, `phase1-revisions.test.ts`, `phase1-workspace-access.test.ts`.

Every operation path:

```text
caller
→ BEGIN READ COMMITTED
→ resolve/lock Source on this connection
→ transaction-scoped WorkspaceAccessPolicy
→ Source ACTIVE + ownership checks
→ required resource locks, latest-state validation and writes
```

- [ ] Write failing tests for HUB_MANAGED success, SOURCE_MANAGED rejection, archived Source, invalid parent, cross-org member success, same-org non-member rejection, direct UUID access rejection, payload caller/workspace spoofing.
- [ ] Run failing authority/access tests.
- [ ] Implement `createDocument(caller,input)` inside one READ COMMITTED transaction including Workspace access check.
- [ ] Add stale revision conflict test.
- [ ] Implement `createRevision` with authoritative Document→Source→Workspace resolution, Workspace access, HUB_MANAGED/ACTIVE validation, Document lock, expected revision check, canonicalization, NOOP, N+1 insert/pointer update.
- [ ] Migrate createHubManagedDocument/createRevision consumers in tests and fixtures to Hub commands and §3 object inputs; update composition. Keep a temporary delegating adapter for consumers scheduled in later tasks so this task typechecks; no duplicate mutation implementation. Wire the new-operation error codes defined in Task 1.
- [ ] Run tests and commit `feat: add hub knowledge command service`.

---

### Task 5: Implement Tree Creation, Move, Reorder, and Concurrency Safety

**Files:** Tree domain/ports/repository, Hub command service, `phase1-tree-rules.test.ts`, `phase1-tree.test.ts`, `phase1-concurrency.test.ts`.

Tree mutation path:

```text
TreeNode/sourceId
→ BEGIN READ COMMITTED
→ resolve Source.workspace_id
→ lock Source FOR UPDATE
→ require transaction-scoped Workspace access
→ validate latest hierarchy
→ write
```

Rules: parent FOLDER/ACTIVE/same Source, no self/descendant cycle, no cross-Source Document move, no Source Workspace transfer, root parent null.

- [ ] Write failing pure Tree tests.
- [ ] Implement pure helpers and run unit tests. Preserve renameFolder with ACTIVE/ownership/ancestry checks; getAncestors returns root-to-parent order and never crosses Source or bypasses Workspace access.
- [ ] Write DB integration tests proving move changes only hierarchy, not Document/Revision/Workspace identity.
- [ ] Implement Source-level serialization and transaction-scoped Workspace access in §6 order; no writes before authorization.
- [ ] Implement contiguous sibling ordering using `ORDER BY position,id`; no LexoRank/fractional indexing.
- [ ] Add two-connection cycle/lock-refresh tests.
- [ ] Migrate renameFolder/moveTreeNode/reorderNode positional callers to §3 command names/object inputs in unit/integration tests and fixtures; update temporary delegates and precise error assertions.
- [ ] Run tests and commit `feat: complete safe knowledge tree mutations`.

---

### Task 6: Implement Document, Folder, and Source Lifecycle Semantics

**Files:** lifecycle internals, Hub command service, repositories, `phase1-lifecycle.test.ts`, access tests.

All lifecycle operations follow §6: BEGIN READ COMMITTED → resolve Source → lock Source → transaction-scoped membership check → resource locks and lifecycle validation → writes. Workspace lifecycle itself is not implemented in Phase 1.

- [ ] Document archive/restore tests: Document + TreeNode + linked SourceEntry atomic status/provenance, revisions/current pointer unchanged, stable ID.
- [ ] Folder lifecycle tests: empty folder archive, `FOLDER_NOT_EMPTY`, no cascade, active parent/source requirement.
- [ ] Source lifecycle tests: SourceApplicationService implements SourceLifecycleCommands for both ownership types; same-transaction access/Source lock, visibility gate, provenance and unchanged descendant statuses.
- [ ] Access tests: unauthorized callers cannot archive/restore resource by UUID.
- [ ] Migrate lifecycle consumers/tests to the Hub/Source lifecycle boundaries and wire their precise error codes.
- [ ] Implement lifecycle transactions; do not create append-only audit subsystem in Phase 1.
- [ ] Run tests and commit `feat: add knowledge lifecycle operations`.

---

### Task 7: Implement SourceEntry Mapping Primitives and Source Projection Authority

**Files:** SourceEntry mapping service/repository, SourceKnowledgeProjectionService, composition, mapping/authority/access integration tests.

Entry capabilities (internal transaction-bound primitives; resolved Source scope and trusted caller are supplied by the owning UoW, never inferred from locator payload):

```ts
createSourceEntryMapping(...)
getSourceEntry(id)
resolveByExternalId(sourceId, externalId)
updateSourceLocator(id, sourcePath, contentHash)
archiveSourceEntry(id)
restoreSourceEntry(id)
```

Source projection path:

```text
CallerContext
→ Source
→ Source.workspace_id
→ Workspace policy
→ validate SOURCE_MANAGED
→ shared internal Knowledge mutation
```

- [ ] Mapping tests: stable Folder/Document mappings, path changes preserve IDs, duplicate external ID rejection, same ID across Sources allowed, same hash/different identity not merged, Hub-native docs without SourceEntry, no filename→title inference.
- [ ] Projection tests: SOURCE_MANAGED accepted only with Workspace access; HUB_MANAGED rejected; caller/resource scope cannot be overridden by source/input data.
- [ ] Bind internal projection commands to the caller's existing SourceRepositories transaction and authorized Source in composition; never call a nested UoW/commit or expose repositories/authority through Web inputs. Retain explicit CallerContext and verify each command targets the bound Source.
- [ ] Create projected object and required SourceEntry mapping in the same transaction; preallocated sourceEntryId does not require a preexisting committed mapping. Return only after all mapping invariants hold.
- [ ] Implement projected Folder rename/archive/restore with TreeNode + Entry provenance in the same transaction, no active-child cascade, and ancestor-first restore.
- [ ] Migrate SourceApplicationService/ControlledKnowledgeOperations consumers and composition to the transaction-bound projection interface, updating source-safety fixtures/tests and precise errors. Adapt existing wiring rather than keeping a second mutation path. Keep sync_version, assets, APPLIED run and all commands in the shared transaction; FAILED run remains a separate post-rollback write.
- [ ] Inject failure after multiple Document/Folder projections and mapping/asset/version writes, before APPLIED commit; verify every canonical write rolls back, source version is unchanged, no nested connection is acquired, and FAILED can be recorded separately.
- [ ] Run tests and commit `feat: add source mapping and projection boundary`.

---

### Task 8: Implement Workspace-Aware KnowledgeQueryService and Read Models

**Files:** `knowledge-query-service.ts`, `src/modules/sources/application/source-version-guard.ts`, `src/modules/sources/ports/source-repository.ts`, `src/infrastructure/database/mariadb/repositories/sources.ts`, `src/server/composition.ts`, `src/app/knowledge/page.tsx`, workspace query service as needed, read repository methods, `phase1-read-model.test.ts`, lifecycle/tree/access integration tests.

**Produces:** `WorkspaceQueryService.listWorkspaces(caller)` and §3 KnowledgeQueryService.

- [ ] Make KnowledgeQueryService the single public Source-list query. Add repository `findByWorkspaceId(workspaceId, { includeArchived })` with ACTIVE-only default; adapt any retained findActiveByWorkspaceId internal wrapper to delegate with false.
- [ ] Move all SourceApplicationService.listSources consumers, including `src/app/knowledge/page.tsx:24`, to KnowledgeQueryService.listSources with required authorized workspaceId. Remove the old optional-workspace application method after migration; no parallel query semantics. Update composition, source/workspace tests and fixtures; callers needing several Workspaces explicitly enumerate authorized Workspaces.
- [ ] Test active-only default, includeArchived true, mandatory Workspace scope, unauthorized Workspace rejection, and Browser archived-source listing.
- [ ] Migrate old KnowledgeApplicationService query consumers/view shapes to the query boundary; wire not-found codes and keep only temporary delegation needed until Task 9.
- [ ] Read-model unit tests: Folder label from TreeNode.name, Document label from current Revision.title, no duplicated title truth.
- [ ] Workspace access integration tests:

```text
cross-org member → Workspace appears and Source reads succeed
same-org non-member → Workspace absent
one user in X/Y → both appear
known unauthorized source/document UUID → rejected without content leak
```

- [ ] Archived filtering integration tests: `listSources(caller, workspaceId)` excludes archived Source; Tree/Document default hidden; `includeArchived:true` still requires Workspace access; revisions preserve history.
- [ ] Adopt spec §22.1 non-nullable/not-found contract: replace old null assertions and adapt all query view-shape consumers; test nonexistent, archived-hidden and explicit archived reads separately.
- [ ] Implement Query Service with no React/Next imports, no raw SQL outside repositories, no ambient identity lookup.
- [ ] Add non-Web caller test using trusted CallerContext.
- [ ] Run tests and commit `feat: add workspace-aware knowledge query service`.

---

### Task 9: Build the Read-Only Knowledge Browser

**Files:** knowledge-read adapter, knowledge pages, `workspace-selector.tsx`, `source-selector.tsx`, Tree/viewer/history/archived-toggle, E2E.

**Produces:** human-verifiable `Workspace → Source → Tree → Document/Revision` browsing without authoring, Workspace administration, or sync controls.

- [ ] Remove the Phase 0 create-document form and Web mutation action from the browser; retain application create operations. Replace the existing creation E2E with application-seeded stable-URL/reload/tree navigation checks; preserve caller-spoofing assertions in trusted identity/application tests. Do not leave the old form-dependent E2E unchanged.
- [ ] Seed deterministic fixtures:

```text
User A org=HRSD → Workspace Query Master
User B org=RD   → Workspace Query Master + Workspace SWFP
User C org=HRSD → no Query Master membership

Query Master
└── Obsidian Wiki
    ├── Architecture
    └── Runbooks
```

- [ ] Write failing Playwright flow: caller-visible Workspace selector, Source selector, Tree navigation, stable `/knowledge/<documentId>` URL, current markdown/title, revision history, archived toggle, no mutation/admin controls.
- [ ] Add direct unauthorized URL case with no title/snippet leak.
- [ ] Map explicit query not-found errors to Next notFound() in `src/app/knowledge/[documentId]/page.tsx`; remove the obsolete null branch. Preserve access-denial behavior, and add direct missing/archived URL E2E checks.
- [ ] Implement server adapter: resolve trusted identity, build CallerContext, call WorkspaceQueryService/KnowledgeQueryService; no SQL, no caller identity from URL/form.
- [ ] Finish consumer cutover: remove `src/modules/knowledge/application/service.ts` and any temporary compatibility adapter once all callers use the new boundaries. Retain shared mutations.ts internals as needed. Search source/tests for obsolete service imports and positional calls, including SourceApplicationService.listSources; typecheck and regression must pass.
- [ ] Implement minimal UI. Do not add Tiptap or new HTML renderer solely for Phase 1.
- [ ] Run build/E2E and commit `feat: add workspace-scoped knowledge browser`.

---

### Task 10: Phase 1 Acceptance, Regression, and Handoff Evidence

**Files:** create verification only after real execution; update README/local setup if necessary.

- [ ] Run full fresh verification:

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

Every command must exit 0; missing DB/browser is unverified, not passed.

- [ ] Run explicit concurrency evidence: concurrent revision writers, stale expected revision, concurrent cycle moves, READ COMMITTED lock-wait/latest-state, transaction rollback.
- [ ] Audit architecture boundaries:

```text
workspaces module is present
Source uses workspace_id, not org_code access ownership
resource operations resolve Source → Workspace policy
cross-org member allow / same-org non-member deny are tested
UI workspace selector is not security evidence
all application stable IDs use UUIDv7/native UUID
public services receive CallerContext explicitly
canonical mutation UoW uses READ COMMITTED
Source/Document FOR UPDATE locks remain
Knowledge does not import scanner/sync code
UI does not import MariaDB repositories
SourceKnowledgeProjectionService is not Web-exposed
no force/bypass/isSync ownership flag
no revision update/delete operation
no Workspace administration or Agent Principal model in Phase 1
```

- [ ] Audit scope exclusions: no Phase 2 scanner/upload/Title Resolution/diff/Preview, no Phase 3 Workspace admin/roles/SSO, no editor/search/vector/publishing/MCP/binary/memory/Agent actor model.
- [ ] Record commit SHA, Node/npm/MariaDB versions, Workspace schema/access evidence, UUID/isolation evidence, command outputs/pass counts, concurrency names, E2E result, known limitations.
- [ ] Confirm Phase 2 handoff: new Source creation takes an authorized Workspace; existing Source sync derives Workspace from Source and cannot silently transfer it.
- [ ] Confirm Phase 3 handoff: Workspace provisioning/create, rename, archive/restore, membership administration, roles/capabilities, Team/SSO Group mapping, production policy/audit, Company SSO.
- [ ] Commit verification/docs only after actual execution.

---

## 4. Acceptance Matrix

| ID | Scenario | Required result | Primary task |
| --- | --- | --- | --- |
| P1-A01 | Phase 0 full regression before Phase 1 | all Phase 0 checks pass, including Workspace foundation | T1 |
| P1-A02 | Foundation ID contract | UUIDv7 app IDs + MariaDB native UUID round-trip | T1, T2 |
| P1-A03 | Caller contract | public services require CallerContext; payload cannot override it | T1, T4, T8 |
| P1-A04 | Source scope | KnowledgeSource has valid workspace_id; no org_code access ownership | T1, T2 |
| P1-A05 | Cross-org member | authorized Workspace/Source reads and allowed foundation operations succeed | T1, T4, T8, T9 |
| P1-A06 | Same-org non-member | Workspace absent; direct resource access rejected | T1, T4, T8, T9 |
| P1-A07 | Multi-Workspace caller | listWorkspaces returns all memberships and selector can switch | T8, T9 |
| P1-A08 | Direct UUID bypass attempt | Source/Document content not leaked | T4, T8, T9 |
| P1-A09 | Phase 0 duplicate Document Tree nodes | DB already rejects duplicate | T1, T2 |
| P1-A10 | FOLDER SourceEntry mapping | stable TreeNode ID, null Document ID | T2, T7 |
| P1-A11 | DOCUMENT SourceEntry mapping | same-source TreeNode + Document | T2, T7 |
| P1-A12 | title-only change | creates new immutable revision | T3, T4 |
| P1-A13 | Markdown-only change | creates new immutable revision | T3, T4 |
| P1-A14 | metadata-only change | creates new immutable revision | T3, T4 |
| P1-A15 | identical canonical content | no new revision | T3, T4 |
| P1-A16 | filename/path-only change | no title inference and no revision | T3, T7 |
| P1-A17 | stale expected revision | `REVISION_CONFLICT`, no write | T4 |
| P1-A18 | SOURCE_MANAGED through Hub service | rejected, no DB change | T4, T7 |
| P1-A19 | HUB_MANAGED through projection service | rejected | T7 |
| P1-A20 | Document move | stable Document/TreeNode IDs and revision count | T5 |
| P1-A21 | cross-Source move | rejected | T5 |
| P1-A22 | ordinary Source Workspace transfer attempt | rejected; Workspace unchanged | T5, T7 |
| P1-A23 | move below descendant | rejected | T5 |
| P1-A24 | concurrent cycle moves | at most one succeeds; final Tree acyclic | T5 |
| P1-A25 | READ COMMITTED lock waiter | validates latest committed hierarchy/state after lock | T5 |
| P1-A26 | reorder | only positions change; no revision | T5 |
| P1-A27 | archive Document | Document/Tree/Entry archived atomically; revisions preserved; provenance recorded | T6 |
| P1-A28 | restore Document | same identity/history/current revision; archive provenance cleared | T6 |
| P1-A29 | archive non-empty Folder | `FOLDER_NOT_EMPTY`; descendants unchanged | T6 |
| P1-A30 | archive Source | default reads hide Source; child statuses unchanged | T6, T8 |
| P1-A31 | path rename | SourceEntry locator changes, stable mapping remains | T7 |
| P1-A32 | same hash/different identity | no auto-merge | T7 |
| P1-A33 | default archived filtering | archived Source/Document/Tree hidden | T8 |
| P1-A34 | includeArchived read | historical entity readable only with Workspace access | T8 |
| P1-A35 | non-Web caller | Query service works with CallerContext without React/Next runtime | T8 |
| P1-A36 | browser navigation | Workspace→Source→Tree, stable Document URL/current revision/history | T9 |
| P1-A37 | browser mutation/admin controls | absent in Phase 1 | T9 |
| P1-A38 | full regression | unit/integration/build/E2E all pass | T10 |
| P1-A39 | populated Phase 0 schema upgrade | fixed 004/005 checksum, target stop, script rollback/rerun, readiness gate recovery, IDs/history preserved | T2 |
| P1-A40 | Phase 0 hash compatibility | canonical equal content NOOP; old revision bytes unchanged; invalid legacy title can be corrected | T3, T4 |
| P1-A41 | multi-command projection failure | one connection, all canonical writes/version roll back; separate FAILED recording | T7 |
| P1-A42 | complete Folder/Source contracts | rename/ancestors/projected lifecycle and both Source ownership lifecycle paths covered | T5–T8 |
| P1-A43 | archived revision history | default hidden; explicit includeArchived still checks Workspace membership | T8, T9 |
| P1-A44 | error and consumer migration | precise codes, preserved class/source-version behavior, no obsolete service imports | T1, T4–T9 |
| P1-A45 | non-nullable query cutover | missing/hidden resource errors mapped to Browser notFound; access denial preserved | T8, T9 |

## 5. Required Error Codes

Keep a stable small set at the owning domain/application boundary. Reuse `src/modules/workspaces/domain/errors.ts` for Workspace errors and `src/shared/domain/errors.ts` for DomainError; do not move Workspace policy errors into Knowledge merely to match this list:

```text
WORKSPACE_NOT_FOUND
WORKSPACE_ACCESS_DENIED
SOURCE_NOT_FOUND
DOCUMENT_NOT_FOUND
REVISION_NOT_FOUND
TREE_NODE_NOT_FOUND
SOURCE_ARCHIVED
DOCUMENT_ARCHIVED
SOURCE_MANAGED_READ_ONLY
HUB_MANAGED_OPERATION_REQUIRED
INVALID_PARENT
CROSS_SOURCE_MOVE
TREE_CYCLE
FOLDER_NOT_EMPTY
REVISION_CONFLICT
SOURCE_ENTRY_CONFLICT
INVALID_SOURCE_MAPPING
INVALID_TITLE
INVALID_METADATA
INTEGRITY_VIOLATION
```

Adapters may map these to UI messages or HTTP status codes later. Domain/application must not return transport-specific status codes, toast strings, SQL error text, or MariaDB objects.

## 6. Transaction and Lock Ordering

Canonical mutation setup/order:

```text
1. obtain trusted CallerContext
2. acquire one MariaDB connection
3. SET TRANSACTION ISOLATION LEVEL READ COMMITTED; BEGIN
4. resolve authoritative resource → Source.workspace_id on this connection
5. lock KnowledgeSource (all canonical Hub/projection/lifecycle mutations)
6. enforce transaction-scoped WorkspaceAccessPolicy on the same connection
7. lock KnowledgeDocument when content/current revision is involved
8. validate latest ownership, lifecycle, ancestry and expected revision after locks
9. write Revision/Document/Tree/SourceEntry + lifecycle provenance
10. run application integrity assertions
11. COMMIT once at the owning UoW boundary
```

Transaction-external preflight never substitutes for the in-transaction policy check. Projection is bound to the already-open Source UoW (spec §15.3), including multi-command rollback.

Source-lock-before-membership preserves Phase 0 ordering but lets an unauthorized caller briefly hold that lock; fail and roll back promptly with no external I/O. It does not lock membership or establish production revocation guarantees.

When multiple Documents must be locked in a future operation, lock in consistent ascending order. Tree ancestry checks run after Source lock. Revision stale-current checks run after Document lock. Never rely on a pre-lock read for the final mutation decision. READ COMMITTED does not replace explicit row locks.

## 7. Phase 1 Definition of Done

Phase 1 is complete only when all are evidenced:

- [ ] Phase 0 domain/access/transaction guarantees still pass with the intentionally migrated read-only E2E (spec §24.1), including Workspace/Membership, Source.workspace_id, UUIDv7/native UUID, CallerContext, READ COMMITTED, provenance, Tree uniqueness.
- [ ] Cross-org member allow, same-org non-member deny, multi-Workspace caller, and direct-resource bypass protection pass integration/E2E tests.
- [ ] 004 → independent backfill → 005 safely upgrades populated Phase 0 data with explicit Folder mapping, preflight and failure diagnostics, without duplicating Phase 0 Tree uniqueness.
- [ ] Revision canonicalization/hash matches approved spec; Title Resolution remains Phase 2.
- [ ] Revisions are immutable and identical canonical content is a NOOP across Phase 0/new hash formats; legacy rows remain unchanged.
- [ ] `expectedCurrentRevisionId` protects stale revision writes.
- [ ] Hub and Source projection authorities are separate and both enforce same-connection Workspace access; multi-command projection rollback and complete Folder/Source interfaces are verified.
- [ ] Public services receive trusted CallerContext explicitly.
- [ ] Tree move/reorder keeps Document, Revision, Source, and Workspace identity stable.
- [ ] Tree cycle/cross-source/invalid-parent rules are enforced after Source locking.
- [ ] Two-connection tests prove cycle safety, revision safety, and latest-state behavior.
- [ ] Lifecycle operations keep stable identity/history/current provenance and cannot be triggered by unauthorized resource IDs.
- [ ] Folder archive refuses active children; Source archive is a visibility gate.
- [ ] SourceEntry path changes preserve mapping identity and do not redefine canonical title.
- [ ] Query Service provides active-by-default Workspace-aware reads and works outside React/Next runtime.
- [ ] Read-only Knowledge Browser passes Chromium E2E with Workspace selector.
- [ ] No Phase 2+ feature, Workspace administration, production ACL, or Agent actor model was introduced.
- [ ] Verification document contains fresh command/test evidence.

## 8. Self-Review

### Spec coverage

- Workspace foundation: Task 1 verifies current Phase 0 Workspace contract; Tasks 4–9 enforce access at application/browser boundaries.
- Schema refinement: Task 2 adds SourceEntry mapping with fixed 004/005 DDL and independent backfill and preserves the Phase 0 ten-table foundation.
- Revision model/content hash/concurrency: Tasks 3–4.
- Hub vs Source mutation authority + Workspace access: Tasks 4 and 7.
- Tree operations/order/source lock/isolation/cycle prevention: Task 5.
- Document/folder/source lifecycle: Task 6.
- SourceEntry mapping primitives: Task 7.
- Workspace-aware query/read/default archived filtering: Task 8.
- Workspace→Source→Tree browser: Task 9.
- Acceptance and Phase 2/3 handoff: Task 10.

### Canonical truth scan

This plan intentionally contains no active `org_code → KnowledgeSource` hierarchy, no `knowledge_sources.org_code` schema instruction, no eight-table Phase 0 baseline, and no Source-only browser flow. `org_code` only appears as User identity metadata or an explicitly forbidden authorization shortcut.

### Type consistency

`WorkspaceQueryService`, `HubKnowledgeCommandService`, `SourceKnowledgeProjectionService`, and `KnowledgeQueryService` use the same CallerContext/resource-scope model throughout Tasks 1–9. KnowledgeQueryService `listSources` takes workspaceId as a query scope; resource-specific reads derive Workspace from the resource itself.

## 9. Execution Handoff

Implement only after actual Phase 0 Workspace foundation passes its verification baseline.

Two supported modes:

1. **Subagent-Driven:** use `superpowers:subagent-driven-development`; dispatch a fresh implementation subagent per Task 1–10 and review spec compliance plus code quality between tasks.
2. **Inline Execution:** use `superpowers:executing-plans`; execute tasks sequentially in one isolated worktree with review checkpoints.

Task 2 requires Task 1 Steps 1–5 completed: original baseline/inventory, existing-service error foundations (3a), standalone interface tests (3b), post-change typecheck/unit/integration (4), and recorded completion (5). No Task 1 checklist remains open until later tasks. Consumer migration belongs to Tasks 4–9 as explicitly assigned, with final removal in Task 9. This same gate applies to both execution modes. Phase 1 does not create/manage Workspaces; Phase 3 owns Workspace provisioning/create, rename, archive/restore, membership administration, roles/capabilities, Team/SSO Group mapping, production policy/audit, and Company SSO.
