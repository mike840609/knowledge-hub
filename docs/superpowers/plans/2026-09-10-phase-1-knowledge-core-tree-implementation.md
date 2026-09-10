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
  listSources(caller: CallerContext, workspaceId: string, input?: { includeArchived?: boolean }): Promise<SourceView[]>;
  getSource(caller: CallerContext, sourceId: string, input?: { includeArchived?: boolean }): Promise<SourceView>;
  listTree(caller: CallerContext, sourceId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeTreeItem[]>;
  getDocument(caller: CallerContext, documentId: string, input?: { includeArchived?: boolean }): Promise<{ documentId: string; sourceId: string; workspaceId: string; status: "ACTIVE" | "ARCHIVED"; currentRevision: KnowledgeRevisionView }>;
  getCurrentRevision(caller: CallerContext, documentId: string): Promise<KnowledgeRevisionView>;
  getRevision(caller: CallerContext, documentId: string, revisionNo: number): Promise<KnowledgeRevisionView>;
  listRevisions(caller: CallerContext, documentId: string): Promise<KnowledgeRevisionView[]>;
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

- [ ] **Step 3: Add compile-time contract tests for §3**

Create `tests/unit/phase1-contracts.test.ts` that imports Workspace/Knowledge service types and instantiates typed stubs. Ensure caller is a distinct first argument and cannot be smuggled inside input types.

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

### Task 2: Add Phase 1 SourceEntry→TreeNode Schema Refinement

**Files:** create `src/infrastructure/database/mariadb/migrations/003-phase-1-tree-mapping.ts`; modify migration registry; test `tests/integration/phase1-schema.test.ts`.

**Consumes:** Phase 0 ten-table schema, native UUID IDs, Workspace-scoped Source, existing one-document-one-TreeNode constraint.

Schema change:

```sql
ALTER TABLE source_entries
  ADD COLUMN tree_node_id UUID NULL;

ALTER TABLE source_entries
  ADD CONSTRAINT fk_source_entries_tree_node_same_source
  FOREIGN KEY (source_id, tree_node_id)
  REFERENCES knowledge_tree_nodes(source_id, id);
```

Do not recreate Phase 0 `UNIQUE(knowledge_tree_nodes.document_id)`.

Additional mapping protection:

- FOLDER requires `tree_node_id` and null `document_id`.
- DOCUMENT requires both `tree_node_id` and `document_id`.
- SourceEntry Document mapping and Tree node mapping reference the same Source.
- DOCUMENT mapping's TreeNode points to the same Document; enforce in DB where representable and application/integration validation otherwise.
- Mapping does not rely on `source_path` or `content_hash` uniqueness.

- [ ] Write failing schema integration tests, including same-source mapping and Workspace-scoped Source baseline.
- [ ] Run `npm run test:integration -- phase1-schema` and verify failures are only missing Phase 1 mapping.
- [ ] Implement forward-only migration 003.
- [ ] Recreate fresh integration DB; run phase1-schema and all integration suites.
- [ ] Commit `feat: add source entry tree mapping`.

---

### Task 3: Finalize Revision Canonicalization and Immutable Revision Repository

**Files:** `content.ts`, `revision.ts`, revision repository/adapter, `phase1-content.test.ts`, `phase1-revisions.test.ts`.

Canonical content:

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

Fingerprint:

```ts
const payload = `knowledge-revision:v1\0${canonicalJson(normalized)}`;
const contentHash = createHash("sha256").update(payload, "utf8").digest("hex");
```

- [ ] Write failing unit tests: title trim/non-empty, CRLF→LF, recursive object-key sorting, array order, metadata/title/body-only changes, invalid JSON values.
- [ ] Run `npm run test:unit -- phase1-content` and observe expected failure.
- [ ] Implement canonicalization/fingerprinting; do not infer title from filename/path or normalize semantic whitespace.
- [ ] Write failing integration tests for R1/current pointer, identical NOOP, changed R2, byte-stable R1, unique revision numbers, no update/delete API.
- [ ] Implement immutable repository methods only: insert/read/list/current.
- [ ] Run unit/integration tests and commit `feat: finalize immutable knowledge revisions`.

---

### Task 4: Implement HubKnowledgeCommandService for HUB_MANAGED Content

**Files:** `hub-knowledge-command-service.ts`, internal create-document/create-revision, errors, composition, `phase1-authority.test.ts`, `phase1-revisions.test.ts`, `phase1-workspace-access.test.ts`.

Every operation path:

```text
caller
→ load Source/resource
→ Source.workspace_id
→ WorkspaceAccessPolicy
→ Source ACTIVE + ownership checks
→ READ COMMITTED mutation
```

- [ ] Write failing tests for HUB_MANAGED success, SOURCE_MANAGED rejection, archived Source, invalid parent, cross-org member success, same-org non-member rejection, direct UUID access rejection, payload caller/workspace spoofing.
- [ ] Run failing authority/access tests.
- [ ] Implement `createDocument(caller,input)` as one READ COMMITTED transaction after Workspace access check.
- [ ] Add stale revision conflict test.
- [ ] Implement `createRevision` with authoritative Document→Source→Workspace resolution, Workspace access, HUB_MANAGED/ACTIVE validation, Document lock, expected revision check, canonicalization, NOOP, N+1 insert/pointer update.
- [ ] Run tests and commit `feat: add hub knowledge command service`.

---

### Task 5: Implement Tree Creation, Move, Reorder, and Concurrency Safety

**Files:** Tree domain/ports/repository, Hub command service, `phase1-tree-rules.test.ts`, `phase1-tree.test.ts`, `phase1-concurrency.test.ts`.

Tree mutation path:

```text
TreeNode/sourceId
→ Source.workspace_id
→ require Workspace access
→ BEGIN READ COMMITTED
→ lock Source FOR UPDATE
→ validate latest hierarchy
→ write
```

Rules: parent FOLDER/ACTIVE/same Source, no self/descendant cycle, no cross-Source Document move, no Source Workspace transfer, root parent null.

- [ ] Write failing pure Tree tests.
- [ ] Implement pure helpers and run unit tests.
- [ ] Write DB integration tests proving move changes only hierarchy, not Document/Revision/Workspace identity.
- [ ] Implement Source-level serialization after Workspace access.
- [ ] Implement contiguous sibling ordering using `ORDER BY position,id`; no LexoRank/fractional indexing.
- [ ] Add two-connection cycle/lock-refresh tests.
- [ ] Run tests and commit `feat: complete safe knowledge tree mutations`.

---

### Task 6: Implement Document, Folder, and Source Lifecycle Semantics

**Files:** lifecycle internals, Hub command service, repositories, `phase1-lifecycle.test.ts`, access tests.

All lifecycle operations first resolve Workspace and require access. Workspace lifecycle itself is not implemented in Phase 1.

- [ ] Document archive/restore tests: Document + TreeNode + linked SourceEntry atomic status/provenance, revisions/current pointer unchanged, stable ID.
- [ ] Folder lifecycle tests: empty folder archive, `FOLDER_NOT_EMPTY`, no cascade, active parent/source requirement.
- [ ] Source lifecycle tests: Source archive visibility gate, provenance, descendant statuses unchanged.
- [ ] Access tests: unauthorized callers cannot archive/restore resource by UUID.
- [ ] Implement lifecycle transactions; do not create append-only audit subsystem in Phase 1.
- [ ] Run tests and commit `feat: add knowledge lifecycle operations`.

---

### Task 7: Implement SourceEntry Mapping Primitives and Source Projection Authority

**Files:** SourceEntry mapping service/repository, SourceKnowledgeProjectionService, composition, mapping/authority/access integration tests.

Entry capabilities:

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
- [ ] Implement internal SourceKnowledgeProjectionService; never expose it as Web mutation.
- [ ] Inject failure after Knowledge writes but before SourceEntry commit and verify full rollback.
- [ ] Run tests and commit `feat: add source mapping and projection boundary`.

---

### Task 8: Implement Workspace-Aware KnowledgeQueryService and Read Models

**Files:** `knowledge-query-service.ts`, workspace query service as needed, read repository methods, `phase1-read-model.test.ts`, lifecycle/tree/access integration tests.

**Produces:** `WorkspaceQueryService.listWorkspaces(caller)` and §3 KnowledgeQueryService.

- [ ] Read-model unit tests: Folder label from TreeNode.name, Document label from current Revision.title, no duplicated title truth.
- [ ] Workspace access integration tests:

```text
cross-org member → Workspace appears and Source reads succeed
same-org non-member → Workspace absent
one user in X/Y → both appear
known unauthorized source/document UUID → rejected without content leak
```

- [ ] Archived filtering integration tests: `listSources(caller, workspaceId)` excludes archived Source; Tree/Document default hidden; `includeArchived:true` still requires Workspace access; revisions preserve history.
- [ ] Implement Query Service with no React/Next imports, no raw SQL outside repositories, no ambient identity lookup.
- [ ] Add non-Web caller test using trusted CallerContext.
- [ ] Run tests and commit `feat: add workspace-aware knowledge query service`.

---

### Task 9: Build the Read-Only Knowledge Browser

**Files:** knowledge-read adapter, knowledge pages, `workspace-selector.tsx`, `source-selector.tsx`, Tree/viewer/history/archived-toggle, E2E.

**Produces:** human-verifiable `Workspace → Source → Tree → Document/Revision` browsing without authoring, Workspace administration, or sync controls.

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
- [ ] Implement server adapter: resolve trusted identity, build CallerContext, call WorkspaceQueryService/KnowledgeQueryService; no SQL, no caller identity from URL/form.
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

## 5. Required Error Codes

Keep a stable small set in `knowledge/domain/errors.ts` or appropriate application error boundary:

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
2. resolve authoritative resource → Source.workspace_id
3. enforce Workspace access policy
4. acquire MariaDB connection
5. SET TRANSACTION ISOLATION LEVEL READ COMMITTED
6. BEGIN
7. lock KnowledgeSource when hierarchy/lifecycle/source authority is involved
8. lock KnowledgeDocument when content/current revision is involved
9. validate current state after locks are held
10. write Revision/Document/Tree/SourceEntry + lifecycle provenance rows
11. run application integrity assertions
12. COMMIT
```

When multiple Documents must be locked in a future operation, lock in consistent ascending order. Tree ancestry checks run after Source lock. Revision stale-current checks run after Document lock. Never rely on a pre-lock read for the final mutation decision. READ COMMITTED does not replace explicit row locks.

## 7. Phase 1 Definition of Done

Phase 1 is complete only when all are evidenced:

- [ ] Phase 0 verification still passes, including Workspace/Membership, Source.workspace_id, UUIDv7/native UUID, CallerContext, READ COMMITTED, provenance, Tree uniqueness.
- [ ] Cross-org member allow, same-org non-member deny, multi-Workspace caller, and direct-resource bypass protection pass integration/E2E tests.
- [ ] Migration 003 safely adds SourceEntry→TreeNode mapping without duplicating Phase 0 Tree uniqueness.
- [ ] Revision canonicalization/hash matches approved spec; Title Resolution remains Phase 2.
- [ ] Revisions are immutable and identical content is a NOOP.
- [ ] `expectedCurrentRevisionId` protects stale revision writes.
- [ ] Hub and Source projection authorities are separate and both enforce Workspace access.
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
- Schema refinement: Task 2 adds only `SourceEntry.tree_node_id` and preserves the Phase 0 ten-table foundation.
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

Do not start Task 2 before Task 1 proves the real Phase 0 foundation is green. Phase 1 does not create/manage Workspaces; Phase 3 owns Workspace provisioning/create, rename, archive/restore, membership administration, roles/capabilities, Team/SSO Group mapping, production policy/audit, and Company SSO.
