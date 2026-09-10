# Phase 1 Knowledge Core & Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Knowledge Core & Tree product behavior on top of Phase 0 so Knowledge Hub has stable UUIDv7 document identity, immutable revisions, safe hierarchy mutation, lifecycle provenance, source mapping primitives, caller-aware read/write services, and a read-only browser that Phase 2 can reuse without bypassing core rules.

**Architecture:** Keep the Phase 0 modular monolith and MariaDB transaction/repository boundaries. Inherit the Phase 0 foundation contracts: application-generated UUIDv7 with MariaDB native `UUID`, explicit `CallerContext`, READ COMMITTED canonical mutation transactions, current lifecycle provenance, and one-document-one-TreeNode uniqueness. Phase 1 adds only the SourceEntry→TreeNode schema refinement plus complete Knowledge application services. Human Hub mutations and future source projection mutations use separate interfaces while sharing the same domain rules, repositories, locks, and transactions. The browser consumes read application services only; ingestion, Title Resolution, matching, diff, Preview/Confirm/Apply, authoring, search, MCP, publishing, Agent actor modeling, and Agent Memory remain outside this phase.

**Tech Stack:** Next.js App Router, React, TypeScript strict, Tailwind CSS, shadcn/ui Base UI, MariaDB 10.11, official `mariadb` Node.js connector, Vitest unit/integration tests, Playwright Chromium E2E, npm.

**Spec:** `docs/superpowers/specs/2026-09-10-phase-1-knowledge-core-tree-design.md`

## Global Constraints

- Phase 0 Foundation & Architecture must be implemented and verified before Phase 1 completion can be claimed.
- Canonical database remains MariaDB 10.11; do not add a second datastore or ORM.
- All internal stable IDs inherit Phase 0: application-generated UUIDv7, MariaDB native `UUID` columns/FKs. Do not reintroduce `CHAR(36)` or random UUIDv4 as the default ID contract.
- Preserve module direction: `identity → application`, `sources → knowledge`; Knowledge must not import scanner/sync implementations.
- Public application read/write services receive `CallerContext` explicitly as the first parameter; do not source caller identity from command/query payload or ambient global request state.
- Preserve stable `KnowledgeDocument.id`; path, filename, title, hash, TreeNode ID, external ID, and tKMS ID must never replace Document identity.
- Revision content is exactly `title + markdown + metadata`; hierarchy, path, position, locator, and lifecycle are not revision content.
- SOURCE_MANAGED canonical Title Resolution is Phase 2 responsibility. Filename/path does not automatically redefine Knowledge title.
- KnowledgeRevision is immutable; no update/delete revision repository method is allowed.
- Lifecycle remains `ACTIVE | ARCHIVED`; lifecycle-bearing Source/Entry/TreeNode/Document rows maintain `updated_by`, `archived_by`, and `archived_at` as current-state provenance. Complete append-only lifecycle history remains Phase 3 responsibility.
- Phase 0–2 provenance continues to reference trusted users. Do not add `actor_kind`, polymorphic actor FKs, or an Agent Principal model in Phase 1.
- `SOURCE_MANAGED` is not editable through Hub commands. Do not introduce `force`, `bypassOwnership`, `isSync`, or UI-controlled escape flags.
- Source projection is an internal application boundary for Phase 2; do not expose it as a public Web mutation endpoint.
- A KnowledgeSource is the logical Tree root; do not create a synthetic root folder.
- A Document has exactly one DOCUMENT TreeNode under the Phase 0 uniqueness contract and cannot move across Source through normal Tree operations.
- Folder archive does not implicitly cascade to active descendants.
- Source archive is a visibility gate and does not rewrite every descendant lifecycle status.
- Default reads exclude archived Sources/Documents/Tree nodes unless `includeArchived: true` is explicitly requested.
- Every canonical mutation transaction uses READ COMMITTED on one MariaDB connection plus required Source/Document `FOR UPDATE` locks. No transaction-bound repository may fall back to `pool.query()`.
- Tests that claim concurrency safety must use at least two real MariaDB connections, not mocks.
- Phase 1 does not add folder upload/scanning, Title Resolution, matching heuristics, diff, Preview/Confirm/Apply, rich editor, keyword search, vectors, ACL, Company SSO, tKMS, MCP, binary storage, Agent actor modeling, or Agent Memory.

---

## 1. Starting State and Reconciliation Gate

The GitHub `main` branch contains the Phase 0 design/plan, Phase 1 design, roadmap, and README. Phase 0 is being implemented separately, so execution of this plan must begin only after the real Phase 0 implementation branch/worktree is available locally and includes the clarified foundation contracts.

Phase 0 defines the expected code layout and contracts used by this plan:

```text
src/modules/identity/
src/modules/knowledge/
src/modules/sources/
src/infrastructure/database/mariadb/
src/server/
tests/unit/
tests/integration/
tests/e2e/
```

The expected Phase 0 ports/contracts include `KnowledgeUnitOfWork`, document/revision/tree repositories, a read-only Source policy port, Sources repositories, `UserIdentity`, explicit `CallerContext`, server-side Local Identity, UUIDv7 generation, READ COMMITTED transaction setup, lifecycle provenance fields, and one-document-one-TreeNode DB protection. Phase 1 extends those contracts rather than creating a second architecture.

Before Task 1 implementation, compare the actual Phase 0 output against this plan. If the actual names differ but responsibilities are equivalent, keep the actual Phase 0 naming consistently across Phase 1. Do not create duplicate parallel repositories/services merely to satisfy a filename in this document. Reconciliation must preserve the invariants and public method shapes described below.

## 2. File Map

Phase 1 is expected to create or modify the following focused units. If Phase 0 already created a named file, modify it instead of duplicating responsibility.

```text
src/modules/identity/
└── application/
    └── caller-context.ts               # Phase 0 contract; reuse, do not duplicate

src/modules/knowledge/
├── domain/
│   ├── content.ts                     # normalize revision content + stable fingerprint input
│   ├── document.ts                    # document lifecycle/state helpers
│   ├── revision.ts                    # immutable revision model
│   ├── tree-node.ts                   # FOLDER/DOCUMENT invariants
│   └── errors.ts                      # stable domain/application errors
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
│   └── 003-phase-1-tree-mapping.ts
└── repositories/
    ├── documents.ts
    ├── revisions.ts
    ├── tree.ts
    ├── entries.ts
    └── source-policy.ts

src/server/
├── knowledge-services.ts
└── actions/
    └── knowledge-read.ts

src/app/knowledge/
├── page.tsx
└── [documentId]/page.tsx

src/components/knowledge/
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
```

Application service contracts:

```ts
export interface HubKnowledgeCommandService {
  createDocument(caller: CallerContext, input: CreateHubDocumentInput): Promise<{ documentId: string; revisionId: string; treeNodeId: string }>;
  createRevision(caller: CallerContext, input: CreateRevisionInput): Promise<{ revisionId: string; revisionNo: number; changed: boolean }>;
  createFolder(caller: CallerContext, input: { sourceId: string; parentId: string | null; name: string; position?: number }): Promise<{ treeNodeId: string }>;
  moveTreeNode(caller: CallerContext, input: MoveTreeNodeInput): Promise<void>;
  reorderTreeNode(caller: CallerContext, input: { nodeId: string; newPosition: number }): Promise<void>;
  archiveDocument(caller: CallerContext, documentId: string): Promise<void>;
  restoreDocument(caller: CallerContext, documentId: string): Promise<void>;
  archiveFolder(caller: CallerContext, treeNodeId: string): Promise<void>;
  restoreFolder(caller: CallerContext, treeNodeId: string): Promise<void>;
}

export interface SourceKnowledgeProjectionService {
  projectDocument(caller: CallerContext, input: CreateHubDocumentInput & { sourceEntryId: string }): Promise<{ documentId: string; revisionId: string; treeNodeId: string }>;
  projectRevision(caller: CallerContext, input: CreateRevisionInput): Promise<{ revisionId: string; revisionNo: number; changed: boolean }>;
  projectFolder(caller: CallerContext, input: { sourceId: string; sourceEntryId: string; parentId: string | null; name: string; position?: number }): Promise<{ treeNodeId: string }>;
  moveProjectedNode(caller: CallerContext, input: MoveTreeNodeInput): Promise<void>;
  archiveProjectedDocument(caller: CallerContext, documentId: string): Promise<void>;
  restoreProjectedDocument(caller: CallerContext, documentId: string): Promise<void>;
}

export interface KnowledgeQueryService {
  listSources(caller: CallerContext, input?: { includeArchived?: boolean }): Promise<Array<{ id: string; name: string; status: "ACTIVE" | "ARCHIVED" }>>;
  getSource(caller: CallerContext, sourceId: string, input?: { includeArchived?: boolean }): Promise<{ id: string; name: string; status: "ACTIVE" | "ARCHIVED" }>;
  listTree(caller: CallerContext, sourceId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeTreeItem[]>;
  getDocument(caller: CallerContext, documentId: string, input?: { includeArchived?: boolean }): Promise<{ documentId: string; sourceId: string; status: "ACTIVE" | "ARCHIVED"; currentRevision: KnowledgeRevisionView }>;
  getCurrentRevision(caller: CallerContext, documentId: string): Promise<KnowledgeRevisionView>;
  getRevision(caller: CallerContext, documentId: string, revisionNo: number): Promise<KnowledgeRevisionView>;
  listRevisions(caller: CallerContext, documentId: string): Promise<KnowledgeRevisionView[]>;
}

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

All IDs above are standard UUID strings at the application boundary; MariaDB storage uses native `UUID` columns. `createdBy` remains a user ID in Phase 1; do not add actor polymorphism.

---

### Task 1: Reconcile Phase 0 Output and Lock Phase 1 Contracts

**Files:**
- Read/verify: Phase 0 application, repository, migration, test, and composition-root files in the actual implementation worktree.
- Modify only if needed for equivalent naming consolidation: `src/modules/identity/application/caller-context.ts`, `src/modules/knowledge/ports/*.ts`, `src/server/knowledge-services.ts` or the actual Phase 0 composition root.
- Test: existing Phase 0 unit/integration suites.

**Interfaces:**
- Consumes: Phase 0 `CallerContext`, `KnowledgeUnitOfWork`, UUIDv7 generator/storage contract, repository ports, Source policy port, Local Identity provider, READ COMMITTED UoW, lifecycle provenance, one-document-one-TreeNode uniqueness.
- Produces: a single canonical set of Phase 1 port/service names matching §3; no duplicate architecture.

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

Record actual paths/signatures for `CallerContext`, UUIDv7 generation, `KnowledgeUnitOfWork`, transaction isolation setup, document/revision/tree repositories, Source policy port, Sources entry repository, lifecycle provenance fields, Local Identity provider, server composition root, migration registry, and test DB harness.

Explicitly verify:

```text
ID storage = MariaDB native UUID
ID generation = application UUIDv7
public application caller = explicit CallerContext
canonical mutation isolation = READ COMMITTED
Document TreeNode uniqueness already exists in Phase 0
lifecycle-bearing rows have updated_by / archived_by / archived_at
```

- [ ] **Step 3: Add compile-time contract tests for the Phase 1 service shapes**

Create `tests/unit/phase1-contracts.test.ts` that imports the §3 types/interfaces and instantiates typed stubs. Ensure the caller is a distinct first argument and cannot be smuggled inside the input type.

- [ ] **Step 4: Run typecheck and existing tests**

```sh
npm run typecheck
npm run test:unit
npm run test:integration
```

Expected: PASS with no Phase 0 regression.

- [ ] **Step 5: Commit**

```sh
git add src tests
 git commit -m "chore: align phase 1 knowledge contracts"
```

---

### Task 2: Add Phase 1 SourceEntry→TreeNode Schema Refinement

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/003-phase-1-tree-mapping.ts`
- Modify: migration registry/runner list from Phase 0.
- Test: `tests/integration/phase1-schema.test.ts`

**Interfaces:**
- Consumes: Phase 0 eight-table schema, native UUID IDs, existing one-document-one-TreeNode constraint.
- Produces: stable `SourceEntry → TreeNode` mapping used by later Phase 1/2 behavior.

Schema change:

```sql
ALTER TABLE source_entries
  ADD COLUMN tree_node_id UUID NULL;

ALTER TABLE source_entries
  ADD CONSTRAINT fk_source_entries_tree_node_same_source
  FOREIGN KEY (source_id, tree_node_id)
  REFERENCES knowledge_tree_nodes(source_id, id);
```

Do **not** recreate the Phase 0 `UNIQUE(knowledge_tree_nodes.document_id)` constraint in migration 003. Task 2 must verify it exists and fail the reconciliation gate if Phase 0 omitted it.

Additional mapping protection:

- FOLDER requires `tree_node_id` and null `document_id`.
- DOCUMENT requires both `tree_node_id` and `document_id`.
- SourceEntry Document mapping and Tree node mapping must reference the same Source.
- DOCUMENT mapping's TreeNode must point to the same Document; enforce in DB where representable and application/integration validation otherwise.
- source-managed mapping must not rely on `source_path` or `content_hash` uniqueness.

- [ ] **Step 1: Write failing schema integration tests**

Cover:

```text
Phase 0 baseline: two DOCUMENT Tree nodes for same Document → already rejected
FOLDER entry without tree_node_id → rejected
DOCUMENT entry without tree_node_id → rejected
DOCUMENT entry whose tree node points to a different Document → rejected
Tree DOCUMENT with name → rejected
Tree FOLDER with document_id → rejected
same SourceEntry path can change without changing entry/tree/document IDs
UUID values round-trip as standard strings through repository boundary
```

- [ ] **Step 2: Run the new schema suite and verify failure only for missing Phase 1 mapping**

```sh
npm run test:integration -- phase1-schema
```

Expected: Phase 0 invariant checks already pass; new SourceEntry→TreeNode cases fail because migration 003 is absent.

- [ ] **Step 3: Implement migration 003 with forward-only explicit SQL statements**

Use the existing Phase 0 migration module format. Do not split raw SQL by semicolon and do not claim MariaDB DDL rollback semantics.

- [ ] **Step 4: Recreate a fresh integration DB and run all migration/schema tests**

```sh
npm run test:integration -- phase1-schema
npm run test:integration
```

Expected: PASS, including all Phase 0 schema tests.

- [ ] **Step 5: Commit**

```sh
git add src/infrastructure/database/mariadb/migrations tests/integration/phase1-schema.test.ts
 git commit -m "feat: add source entry tree mapping"
```

---

### Task 3: Finalize Revision Canonicalization and Immutable Revision Repository

**Files:**
- Modify/Create: `src/modules/knowledge/domain/content.ts`
- Modify: `src/modules/knowledge/domain/revision.ts`
- Modify: `src/modules/knowledge/ports/revision-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/revisions.ts`
- Test: `tests/unit/phase1-content.test.ts`
- Test: `tests/integration/phase1-revisions.test.ts`

**Interfaces:**
- Consumes: `RevisionContentInput`, Phase 0 Revision repository and Document lock support.
- Produces: deterministic content hash, immutable insert/read repository, duplicate-content NOOP behavior.

Canonical content function:

```ts
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

Fingerprint input:

```ts
const payload = `knowledge-revision:v1\0${canonicalJson(normalized)}`;
const contentHash = createHash("sha256").update(payload, "utf8").digest("hex");
```

SOURCE_MANAGED Title Resolution is intentionally absent from this task. Phase 2 decides how source files produce the `title` candidate; Phase 1 only canonicalizes/versions the candidate it receives.

- [ ] **Step 1: Write failing unit tests**

Verify title trim/non-empty, CRLF→LF, recursive object-key sorting, array order preservation, metadata-only change, title-only change, markdown-only change, and rejection of non-JSON metadata values.

- [ ] **Step 2: Verify unit tests fail**

```sh
npm run test:unit -- phase1-content
```

- [ ] **Step 3: Implement canonicalization and fingerprinting**

Do not trim Markdown, reformat Markdown, sort arrays, normalize semantic whitespace, infer title from filename/path, or perform fuzzy deduplication.

- [ ] **Step 4: Write failing integration tests for immutable revisions**

Cover R1/current pointer, identical candidate NOOP, changed candidate R2, byte-stable R1, unique revision numbers, and no revision update/delete API.

- [ ] **Step 5: Implement/adjust repository methods**

```ts
insertRevision(...)
getRevisionById(...)
getRevisionByNumber(...)
listRevisions(...)
getCurrentRevision(...)
```

No `updateRevision` or `deleteRevision` method.

- [ ] **Step 6: Run tests and commit**

```sh
npm run test:unit -- phase1-content
npm run test:integration -- phase1-revisions
git add src/modules/knowledge src/infrastructure/database/mariadb/repositories/revisions.ts tests
git commit -m "feat: finalize immutable knowledge revisions"
```

---

### Task 4: Implement HubKnowledgeCommandService for HUB_MANAGED Content

**Files:**
- Create: `src/modules/knowledge/application/hub-knowledge-command-service.ts`
- Create/Modify: `src/modules/knowledge/application/internal/create-document.ts`
- Create/Modify: `src/modules/knowledge/application/internal/create-revision.ts`
- Modify: `src/modules/knowledge/domain/errors.ts`
- Modify: `src/server/knowledge-services.ts`
- Test: `tests/integration/phase1-authority.test.ts`
- Test: `tests/integration/phase1-revisions.test.ts`

**Interfaces:**
- Consumes: explicit `CallerContext`, `KnowledgeUnitOfWork`, source policy port, content canonicalization.
- Produces: caller-aware `HubKnowledgeCommandService.createDocument` and `.createRevision` with HUB_MANAGED guard and optimistic current-revision check.

- [ ] **Step 1: Write failing authority and create-document tests**

Scenarios include HUB_MANAGED success, SOURCE_MANAGED rejection, archived source rejection, invalid parent, payload caller spoofing ignored/rejected, and transaction rollback after each partial write point.

- [ ] **Step 2: Run failing tests**

```sh
npm run test:integration -- phase1-authority phase1-revisions
```

- [ ] **Step 3: Implement `createDocument(caller, input)` as one READ COMMITTED transaction**

```text
set transaction isolation READ COMMITTED
begin
lock/validate Source
validate HUB_MANAGED
validate parent
insert UUIDv7 Document bootstrap row
insert UUIDv7 Revision R1
set current_revision_id
insert UUIDv7 DOCUMENT TreeNode with name = null
assert one-document-one-TreeNode + complete document state
commit
```

- [ ] **Step 4: Add failing optimistic revision conflict test**

Given current `R2`, calling `createRevision(caller, { expectedCurrentRevisionId: R1, ... })` returns `REVISION_CONFLICT`, creates nothing, and leaves the pointer on R2.

- [ ] **Step 5: Implement `createRevision(caller, input)`**

Inside one READ COMMITTED transaction: validate HUB_MANAGED/ACTIVE source, lock Document, validate ACTIVE Document, compare expected revision, normalize/fingerprint, NOOP identical hash, otherwise insert N+1 and update current pointer.

- [ ] **Step 6: Run tests and commit**

```sh
npm run test:unit
npm run test:integration -- phase1-authority phase1-revisions
git add src/modules/knowledge/application src/server/knowledge-services.ts tests
git commit -m "feat: add hub knowledge command service"
```

---

### Task 5: Implement Tree Creation, Move, Reorder, and Concurrency Safety

**Files:**
- Modify: `src/modules/knowledge/domain/tree-node.ts`
- Create: `src/modules/knowledge/application/internal/move-tree-node.ts`
- Create: `src/modules/knowledge/application/internal/reorder-tree-node.ts`
- Modify: `src/modules/knowledge/application/hub-knowledge-command-service.ts`
- Modify: `src/modules/knowledge/ports/tree-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/tree.ts`
- Test: `tests/unit/phase1-tree-rules.test.ts`
- Test: `tests/integration/phase1-tree.test.ts`
- Test: `tests/integration/phase1-concurrency.test.ts`

**Interfaces:**
- Consumes: CallerContext, READ COMMITTED UoW, Source-level row lock, Phase 0 one-document-one-TreeNode/same-source constraints, `position INT` ordering.
- Produces: caller-aware `createFolder`, `moveTreeNode`, `reorderTreeNode`, `getAncestors` primitives.

- [ ] **Step 1: Write failing pure Tree rule tests**

Validate parent FOLDER/ACTIVE/same Source, no self/descendant cycle, no cross-Source Document move, root parent null.

- [ ] **Step 2: Implement pure validation helpers and run unit tests**

```sh
npm run test:unit -- phase1-tree-rules
```

- [ ] **Step 3: Write failing DB integration tests for move/reorder**

Moving a Document changes only parent/position; Document ID, TreeNode ID, current revision, and revision count remain unchanged. Duplicate DOCUMENT TreeNode remains DB-rejected from Phase 0.

- [ ] **Step 4: Implement Source-level serialization under READ COMMITTED**

Each hierarchy mutation uses the same connection and transaction:

```sql
SELECT id
FROM knowledge_sources
WHERE id = ?
FOR UPDATE;
```

After lock, load ancestry/latest state and apply mutation. Do not rely on a pre-lock read.

- [ ] **Step 5: Implement deterministic sibling reindexing**

Use contiguous non-negative positions and `ORDER BY position, id`. Do not add LexoRank/fractional indexes.

- [ ] **Step 6: Add two-connection cycle + lock-refresh tests**

Use two real connections for A→B vs B→A. At most one commits and final tree is acyclic. Add a case where a waiter performs a pre-lock read, waits on Source lock, then validates latest committed hierarchy under READ COMMITTED; correctness must not depend on an old RR snapshot.

- [ ] **Step 7: Run tests and commit**

```sh
npm run test:integration -- phase1-tree phase1-concurrency
git add src/modules/knowledge src/infrastructure/database/mariadb/repositories/tree.ts tests
git commit -m "feat: complete safe knowledge tree mutations"
```

---

### Task 6: Implement Document, Folder, and Source Lifecycle Semantics

**Files:**
- Create: `src/modules/knowledge/application/internal/set-document-lifecycle.ts`
- Create: `src/modules/knowledge/application/internal/set-folder-lifecycle.ts`
- Modify: `src/modules/knowledge/application/hub-knowledge-command-service.ts`
- Modify: document/tree/source repositories as required.
- Test: `tests/integration/phase1-lifecycle.test.ts`

**Interfaces:**
- Consumes: CallerContext, Phase 0 lifecycle/provenance fields and optional SourceEntry mapping.
- Produces: archive/restore commands with no hard delete, no implicit folder cascade, and current actor/time provenance.

- [ ] **Step 1: Write failing document lifecycle tests**

Verify archive makes Document + TreeNode + linked SourceEntry ARCHIVED atomically, revisions/current pointer unchanged, `updated_by/archived_by/archived_at` equal current caller/time, and restore keeps same IDs/current revision while clearing current archive provenance and updating `updated_by`.

- [ ] **Step 2: Write failing folder lifecycle tests**

Empty ACTIVE folder archive succeeds with provenance; active child gives `FOLDER_NOT_EMPTY`; no implicit descendant mutation; restore requires ACTIVE parent/source and clears current archive provenance.

- [ ] **Step 3: Write failing source visibility/provenance tests**

Source archive hides it by default and records Source provenance without changing descendant statuses; restore reveals stored descendant states and clears Source archive provenance.

- [ ] **Step 4: Implement lifecycle transactions**

All affected status/provenance columns change on the same READ COMMITTED transaction. Do not create `knowledge_events` or an append-only audit subsystem in Phase 1.

- [ ] **Step 5: Run tests and commit**

```sh
npm run test:integration -- phase1-lifecycle phase1-authority
git add src/modules/knowledge src/infrastructure/database/mariadb/repositories tests/integration/phase1-lifecycle.test.ts
git commit -m "feat: add knowledge lifecycle operations"
```

---

### Task 7: Implement SourceEntry Mapping Primitives and Source Projection Authority

**Files:**
- Create: `src/modules/sources/application/source-entry-mapping-service.ts`
- Modify: `src/modules/sources/ports/entry-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/entries.ts`
- Create: `src/modules/knowledge/application/source-knowledge-projection-service.ts`
- Modify: `src/server/knowledge-services.ts`
- Test: `tests/integration/phase1-source-mapping.test.ts`
- Test: `tests/integration/phase1-authority.test.ts`

**Interfaces:**
- Consumes: CallerContext, migration 003 `tree_node_id UUID`, Knowledge internal mutation functions, Sources READ COMMITTED UoW/entry repository.
- Produces: stable source mapping primitives and internal-only caller-aware `SourceKnowledgeProjectionService` for Phase 2.

Entry repository/application capabilities remain:

```ts
createSourceEntryMapping(...)
getSourceEntry(id)
resolveByExternalId(sourceId, externalId)
updateSourceLocator(id, sourcePath, contentHash)
archiveSourceEntry(id)
restoreSourceEntry(id)
```

- [ ] **Step 1: Write failing mapping tests**

Cover stable Folder/Document Tree mappings, path changes preserving IDs, duplicate external ID rejection, same external ID across Sources allowed, same hash/different identity not merged, Hub-native docs without SourceEntry, and no filename/path→canonical-title inference.

- [ ] **Step 2: Implement mapping primitives and run tests**

```sh
npm run test:integration -- phase1-source-mapping
```

- [ ] **Step 3: Write failing projection authority/caller tests**

Verify projection accepts SOURCE_MANAGED, rejects HUB_MANAGED; Hub command does the inverse; caller is explicit and cannot be replaced by source/input data; no public parameter flips authority.

- [ ] **Step 4: Implement `SourceKnowledgeProjectionService` as internal**

It receives trusted CallerContext from Sources orchestration, calls shared internal mutation functions inside the Sources-owned READ COMMITTED transaction, validates SOURCE_MANAGED, and is not exposed as Web mutation.

- [ ] **Step 5: Run authority + mapping + rollback tests and commit**

Inject failure after Knowledge Document/Tree creation but before SourceEntry mapping commit; no partial Knowledge, mapping, lifecycle provenance, or transaction state survives.

```sh
npm run test:integration -- phase1-authority phase1-source-mapping
git add src/modules/sources src/modules/knowledge/application/source-knowledge-projection-service.ts src/server tests
git commit -m "feat: add source mapping and projection boundary"
```

---

### Task 8: Implement KnowledgeQueryService and Read Models

**Files:**
- Create: `src/modules/knowledge/application/knowledge-query-service.ts`
- Modify: document/revision/tree/source read repository methods.
- Test: `tests/unit/phase1-read-model.test.ts`
- Test: integration read cases in `tests/integration/phase1-lifecycle.test.ts` and `phase1-tree.test.ts`.

**Interfaces:**
- Consumes: explicit CallerContext and read repositories only.
- Produces: the caller-aware `KnowledgeQueryService` contract from §3 for Web, future Phase 4 API, and future Phase 7 MCP.

- [ ] **Step 1: Write failing read-model unit tests**

Verify FOLDER label from TreeNode.name, DOCUMENT label from current Revision.title, no TreeNode document-title duplicate truth, and field preservation.

- [ ] **Step 2: Implement read-model mapper**

Keep mapping in application code; React components must not receive raw repository rows.

- [ ] **Step 3: Write failing caller + archived filtering integration tests**

Verify `listSources(caller)` excludes archived Source; `listTree(caller, sourceId)` excludes archived nodes/documents and hidden source; archived document hidden by default; `includeArchived:true` reads history; listRevisions preserves full history; caller cannot come from query input.

- [ ] **Step 4: Implement Query Service**

No React/Next imports, no raw SQL outside repositories, no ambient identity lookup. Phase 1 does not invent full ACL; it preserves the caller-aware boundary Phase 3 will govern.

- [ ] **Step 5: Add a non-Web integration caller test**

Instantiate composition in Node, construct trusted test CallerContext, and call Query Service directly without Next.js runtime.

- [ ] **Step 6: Run tests and commit**

```sh
npm run test:unit -- phase1-read-model
npm run test:integration -- phase1-tree phase1-lifecycle
git add src/modules/knowledge/application/knowledge-query-service.ts src/infrastructure/database/mariadb/repositories tests
git commit -m "feat: add knowledge query service"
```

---

### Task 9: Build the Read-Only Knowledge Browser

**Files:**
- Create/Modify: `src/server/actions/knowledge-read.ts`
- Create: `src/app/knowledge/page.tsx`
- Create: `src/app/knowledge/[documentId]/page.tsx`
- Create: `src/components/knowledge/source-selector.tsx`
- Create: `src/components/knowledge/knowledge-tree.tsx`
- Create: `src/components/knowledge/document-viewer.tsx`
- Create: `src/components/knowledge/revision-history.tsx`
- Create: `src/components/knowledge/archived-toggle.tsx`
- Test: `tests/e2e/phase1-knowledge-browser.spec.ts`

**Interfaces:**
- Consumes: IdentityProvider/CallerContext adapter boundary + `KnowledgeQueryService` only.
- Produces: human-verifiable Source/Tree/Document/history browsing without authoring or sync controls.

- [ ] **Step 1: Seed deterministic Phase 1 browser fixtures**

Seed Query Master with nested Architecture/Runbooks docs, a document with R1/R2, one archived document/source, valid UUID IDs and lifecycle provenance. Use application/repository fixtures, not browser-only JSON.

- [ ] **Step 2: Write failing Playwright browser flow**

Verify active Sources, Tree navigation, stable `/knowledge/<documentId>` UUID URL, current markdown/title, revision history, archived toggle, no mutation controls, refresh stability.

- [ ] **Step 3: Implement read-only server adapter**

`knowledge-read.ts` resolves trusted identity, builds CallerContext, translates query params, and calls `KnowledgeQueryService(caller, ...)`; it contains no SQL or mutations and does not accept caller identity from URL/form data.

- [ ] **Step 4: Implement minimal browser UI**

Render Markdown safely as escaped/plain/preformatted content unless Phase 0 already has a safe renderer. Do not add Tiptap or a new Markdown HTML pipeline merely for Phase 1.

- [ ] **Step 5: Run build/E2E and commit**

```sh
npm run build
npm run test:e2e -- phase1-knowledge-browser
git add src/app/knowledge src/components/knowledge src/server/actions tests/e2e
git commit -m "feat: add read-only knowledge browser"
```

---

### Task 10: Phase 1 Acceptance, Regression, and Handoff Evidence

**Files:**
- Create after execution: `docs/superpowers/verification/2026-09-10-phase-1-knowledge-core-tree-verification.md`
- Modify if necessary: `README.md`, `docs/development/local-setup.md`
- Do not modify Phase 1 design decisions unless an approved design change is made separately.

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: reproducible evidence that Phase 1 is complete and a clear Phase 2 handoff boundary.

- [ ] **Step 1: Run the full verification suite from a clean install/test environment**

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

- [ ] **Step 2: Run explicit concurrency evidence**

Cover concurrent revision writers, stale expectedCurrentRevisionId, concurrent cycle-producing moves, READ COMMITTED lock-wait/latest-state behavior, and transaction rollback after partial Knowledge writes.

- [ ] **Step 3: Audit architecture boundaries**

Confirm:

```text
all application IDs use UUIDv7/native UUID contract
public read/write services receive CallerContext explicitly
UI/input cannot supply caller identity
canonical mutation UoW uses READ COMMITTED
Source/Document FOR UPDATE locks remain present
Knowledge does not import Sources scanner/sync code
UI does not import MariaDB repositories
SourceKnowledgeProjectionService is not exported as a Web mutation
no force/bypass/isSync ownership flag exists
no revision update/delete operation exists
no actor_kind/Agent Principal model exists
```

- [ ] **Step 4: Audit scope exclusions**

Confirm no Phase 2+ scanner, folder upload, Title Resolution, diff, Preview/Confirm/Apply, editor, search/vector, ACL/SSO, publishing, MCP, binary storage, memory, or Agent actor model was introduced.

- [ ] **Step 5: Record Phase 1 verification evidence**

Include commit SHA, Node/npm/MariaDB versions, UUID storage/generation evidence, transaction isolation evidence, command outputs/pass counts, concurrency test names, E2E result, known limitations, and explicit statement that Phase 2 has not been implemented.

- [ ] **Step 6: Confirm Phase 2 handoff contract**

Phase 2 may depend on stable UUIDv7 Document/Tree/SourceEntry identity, SourceEntry.tree_node_id, explicit CallerContext, SourceKnowledgeProjectionService, revision canonicalization/hash, lifecycle provenance, archive/restore, Tree move/reorder, READ COMMITTED Sources UoW, source sync_version guard, and KnowledgeQueryService.

Phase 2 still owns folder selection/upload, scan/parse, **Title Resolution**, snapshot, unknown-entry matching/ambiguity, diff, Preview storage/binding/expiry, Confirm/Apply, first Source creation, and sync run product behavior.

- [ ] **Step 7: Commit verification/docs**

```sh
git add README.md docs/development docs/superpowers/verification
git commit -m "docs: verify phase 1 knowledge core"
```

---

## 4. Acceptance Matrix

| ID | Scenario | Required result | Primary task |
| --- | --- | --- | --- |
| P1-A01 | Phase 0 full regression before Phase 1 | all Phase 0 checks pass | T1 |
| P1-A02 | Foundation ID contract | UUIDv7 app IDs + MariaDB native UUID round-trip | T1, T2 |
| P1-A03 | Caller contract | public read/write services require CallerContext; payload cannot override it | T1, T4, T8 |
| P1-A04 | Phase 0 duplicate Document Tree nodes | DB already rejects duplicate | T1, T2 |
| P1-A05 | FOLDER SourceEntry mapping | stable TreeNode ID, null Document ID | T2, T7 |
| P1-A06 | DOCUMENT SourceEntry mapping | same-source TreeNode + Document | T2, T7 |
| P1-A07 | title-only change | creates new immutable revision | T3, T4 |
| P1-A08 | Markdown-only change | creates new immutable revision | T3, T4 |
| P1-A09 | metadata-only change | creates new immutable revision | T3, T4 |
| P1-A10 | identical canonical content | no new revision | T3, T4 |
| P1-A11 | filename/path-only change | no title inference and no revision | T3, T7 |
| P1-A12 | stale expected revision | `REVISION_CONFLICT`, no write | T4 |
| P1-A13 | SOURCE_MANAGED through Hub service | rejected, no DB change | T4, T7 |
| P1-A14 | HUB_MANAGED through projection service | rejected | T7 |
| P1-A15 | Document move | stable Document/TreeNode IDs and revision count | T5 |
| P1-A16 | cross-Source move | rejected | T5 |
| P1-A17 | move below descendant | rejected | T5 |
| P1-A18 | concurrent cycle moves | at most one succeeds; final Tree acyclic | T5 |
| P1-A19 | READ COMMITTED lock waiter | validates latest committed hierarchy/state after lock | T5 |
| P1-A20 | reorder | only positions change; no revision | T5 |
| P1-A21 | archive Document | Document/Tree/Entry archived atomically; revisions preserved; provenance recorded | T6 |
| P1-A22 | restore Document | same identity/history/current revision; archive provenance cleared | T6 |
| P1-A23 | archive non-empty Folder | `FOLDER_NOT_EMPTY`; descendants unchanged | T6 |
| P1-A24 | archive Source | default reads hide Source; child statuses unchanged; Source provenance recorded | T6, T8 |
| P1-A25 | path rename | SourceEntry locator changes, stable mapping remains | T7 |
| P1-A26 | same hash/different identity | no auto-merge | T7 |
| P1-A27 | default archived filtering | archived Source/Document/Tree hidden | T8 |
| P1-A28 | includeArchived read | historical entity readable | T8 |
| P1-A29 | non-Web caller | Query service works with CallerContext without React/Next runtime | T8 |
| P1-A30 | browser navigation | stable Document URL/current revision/history | T9 |
| P1-A31 | browser mutation controls | absent in Phase 1 | T9 |
| P1-A32 | full regression | unit/integration/build/E2E all pass | T10 |

## 5. Required Error Codes

Keep a stable small set in `knowledge/domain/errors.ts`:

```text
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

Adapters may map these to UI messages or HTTP status codes later. The domain/application layer must not return transport-specific status codes, toast strings, SQL error text, or MariaDB objects.

## 6. Transaction and Lock Ordering

Canonical mutation setup/order:

```text
1. acquire MariaDB connection
2. SET TRANSACTION ISOLATION LEVEL READ COMMITTED for this transaction
3. BEGIN
4. lock KnowledgeSource when hierarchy/lifecycle/source authority is involved
5. lock KnowledgeDocument when content/current revision is involved
6. validate current state after locks are held
7. write Revision/Document/Tree/SourceEntry + lifecycle provenance rows
8. run application integrity assertions
9. COMMIT
```

When multiple Documents must be locked in a future operation, lock by ascending Document UUID string/order consistently. Tree ancestry checks run after Source lock. Revision stale-current checks run after Document lock. Never rely on a pre-transaction/pre-lock read for the final decision.

READ COMMITTED prevents correctness from depending on an older repeatable-read consistent snapshot, but does not replace explicit row locks.

## 7. Phase 1 Definition of Done

Phase 1 is complete only when all of the following are evidenced:

- [ ] Phase 0 verification still passes with UUIDv7/native UUID, CallerContext, READ COMMITTED, lifecycle provenance, and one-document-one-TreeNode baseline.
- [ ] Migration 003 safely adds SourceEntry→TreeNode UUID mapping without duplicating Phase 0 Tree uniqueness.
- [ ] Revision canonicalization/hash contract matches approved spec; source Title Resolution remains Phase 2.
- [ ] Revisions are immutable and identical content is a NOOP.
- [ ] `expectedCurrentRevisionId` protects against stale revision writes.
- [ ] Hub and Source projection mutation authorities are separate and non-bypassable.
- [ ] Public read/write services receive trusted CallerContext explicitly.
- [ ] Tree move/reorder keeps Document and Revision identity stable.
- [ ] Tree cycle/cross-source/invalid-parent rules are enforced after Source locking.
- [ ] Two-connection tests prove cycle safety, revision safety, and latest-state behavior under READ COMMITTED.
- [ ] Document/archive/restore records current actor/time provenance and keeps stable identity/history.
- [ ] Folder archive refuses active children and does not cascade silently.
- [ ] Source archive acts as a visibility gate without rewriting descendants.
- [ ] SourceEntry path changes preserve mapping identity and do not implicitly redefine canonical title.
- [ ] Query Service provides active-by-default caller-aware Source/Tree/Document/revision reads.
- [ ] Query Service works outside React/Next runtime with a CallerContext.
- [ ] Read-only Knowledge Browser passes Chromium E2E.
- [ ] No Phase 2+ feature, Agent actor model, or excluded dependency was introduced.
- [ ] Verification document contains fresh command/test evidence.

## 8. Self-Review

### Spec coverage

- Phase 0 clarified contracts: Task 1 verifies UUIDv7/native UUID, CallerContext, READ COMMITTED, provenance, and Tree uniqueness.
- Schema refinement: Task 2 adds only `SourceEntry.tree_node_id` and mapping invariants.
- Revision model/content hash/concurrency: Tasks 3–4.
- Hub vs Source mutation authority + caller: Tasks 4 and 7.
- Tree operations/order/source lock/isolation/cycle prevention: Task 5.
- Document/folder/source lifecycle + current provenance: Task 6.
- SourceEntry mapping primitives: Task 7.
- Query/read model/default archived filtering/caller boundary: Task 8.
- Read-only browser/revision history/archived toggle: Task 9.
- Acceptance and Phase 2 Title Resolution handoff: Task 10.

### Placeholder scan

This plan intentionally contains no `TBD`, `TODO`, generic "add appropriate error handling", or undefined future service placeholders. Phase 2 features and Agent actor modeling are explicit out-of-scope responsibilities rather than hidden deferred work inside Phase 1.

### Type consistency

The service names, CallerContext parameter, input types, read model, and error codes defined in §3 and §5 are the names used by Tasks 4–9. `HubKnowledgeCommandService` is the HUB_MANAGED entry point; `SourceKnowledgeProjectionService` is the SOURCE_MANAGED internal entry point; `KnowledgeQueryService` is the shared caller-aware read entry point.

## 9. Execution Handoff

Plan complete. Implement it only after the actual Phase 0 worktree passes its verification baseline and contains the clarified foundation contracts.

Two supported execution modes:

1. **Subagent-Driven (recommended):** use `superpowers:subagent-driven-development`; dispatch a fresh implementation subagent per Task 1–10 and review spec compliance plus code quality between tasks.
2. **Inline Execution:** use `superpowers:executing-plans`; execute tasks sequentially in one isolated worktree with review checkpoints.

Do not start Task 2 before Task 1 proves the real Phase 0 foundation is green.