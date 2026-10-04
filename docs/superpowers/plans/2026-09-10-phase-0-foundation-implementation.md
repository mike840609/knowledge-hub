# Knowledge Hub — Phase 0 Foundation Implementation Plan

**English** | [繁體中文](2026-09-10-phase-0-foundation-implementation.zh-TW.md)

| Item | Content |
| --- | --- |
| Date | 2026-09-10 |
| Primary project | `/Users/chuntsai/Projects/HCM-KM/` |
| Based on | [Phase 0 Foundation & Architecture Design](../specs/2026-09-10-phase-0-foundation-architecture-design.md) |
| Document status | Approved implementation plan; Workspace access-boundary correction integrated; Phase 0 implementation completed and verified 2026-09-10 |
| Scope | Phase 0 foundation; do not implement the complete Phase 1–9 product features early |

## 1. Expected Outcomes and Starting Point

After completing this plan, developers can start local MariaDB 10.11 and Next.js, establish a trusted `CallerContext` using server-provided Local Identity, list accessible Workspaces, select a Source within a Workspace, create and read a HUB_MANAGED document, and find that same document through `Workspace → Source → Folder/Document Tree`. Domain, repository, and transaction tests must demonstrate the rules for UUIDv7 stable IDs, Workspace membership foundation, immutable revisions, Source ownership, archive/restore provenance, one-document-one-treenode, and source version guards.

This plan follows the current canonical design: `User.org_code` is a company organization identity attribute; Knowledge access does not use org equality. Each KnowledgeSource belongs to one Workspace; cross-org Users can share a Workspace through WorkspaceMembership, while same-org non-members do not automatically receive access.

Recheck the working tree before execution and preserve subsequent user additions. For implementation, use a Phase 0 implementation branch/worktree that carries forward existing documents. This plan does not require direct company production deployment; Phase 0–2 Workspace membership guards form a local/mock MVP foundation, with production multi-user governance completed in Phase 3.

### 1.1 Acceptance Boundary

- The minimal Web flow requires a Workspace selector, identifiable/actionable Source navigation within the Workspace (a Source-card list qualifies; no dropdown Source selector required), basic title/Markdown input, document reading, and an expandable Tree.
- The Workspace selector displays only `listWorkspaces(caller)` results; UI selection is not authorization evidence, and application resource operations still resolve Source → Workspace for policy checks.
- Verify Revision updates, archive/restore, and hierarchy mutations at the application layer and in tests; a full management UI is not required in this phase.
- Build schema and necessary repositories for SourceEntry, KnowledgeAsset, and SyncRun; use fixtures to verify mapping and transactions, without a Folder scanner, parser, Title Resolution, diff engine, or Sync UI.
- SOURCE_MANAGED rejects ordinary Hub writes; controlled source updates retain only an internal operation boundary capable of sharing a transaction.
- Workspace provisioning/rename/archive/restore UI, roles/capabilities, membership administration, Team/SSO Group mapping, and granular ACLs are outside Phase 0; Phase 3 owns them.
- Phase 0–2 actors remain `UserIdentity`; do not add `actor_kind`, Agent Principals, service accounts, or polymorphic actor FKs.
- Do not add Refine, Outline, Redux, Tiptap, dnd-kit, Elasticsearch, MCP, Vector/Embedding, external publishing platform, binary storage, queue/outbox, hard delete, or enterprise SSO.

## 2. Implementation Choices Adopted by This Plan

These concrete choices were left to the implementation plan by the design specification; they do not rewrite existing product decisions.

| Item | Choice | Rationale and boundaries |
| --- | --- | --- |
| Web runtime | Next.js App Router, Node.js runtime | Keep DB connector on the server; do not access MariaDB from the Edge runtime |
| Package manager | npm, commit `package-lock.json` | One package manager for reproducible installation |
| Runtime pin | T01 selects a supported Node LTS satisfying Next.js/Vitest engines, recorded in `.node-version` and `package.json` engines | Resolve actual versions when implementation begins; floating latest is not a reproducible version |
| Frontend | TypeScript strict, Tailwind, shadcn/ui Base UI | Add only components actually used, such as Button/Input/Textarea/Label |
| DB access | Official `mariadb` Node.js connector, parameterized SQL | Explicitly control composite FKs, row locks, and connection transactions; no ORM in this phase |
| Migration | Ordered TypeScript migration modules containing explicit SQL statement arrays; `tsx` runner | Do not split SQL on semicolons or claim a batch of DDL can roll back |
| Local DB | Docker Compose `mariadb:10.11`; record actual patch/image digest during execution | Separate databases for dev, integration, and E2E; expose only to localhost |
| Tests | Vitest: unit/real-DB integration; Playwright: Chromium smoke | Unit tests do not start Next.js; E2E verifies the actual Web adapter |
| IDs | Application generates UUIDv7; MariaDB uses native `UUID` type | Stable entities share one UUID contract; WorkspaceMembership uses a composite association key |
| Caller | Transport establishes `CallerContext { identity }` from a trusted `IdentityProvider`, explicitly passed as the first application service argument | CallerContext does not carry a fixed single workspace; one caller can access multiple Workspaces |
| Workspace access | Phase 0 implements a basic membership guard with WorkspaceMembership | same org != allow, cross org != deny; production roles/capabilities remain Phase 3 |
| Transaction isolation | Canonical Knowledge/Sources mutations consistently use `READ COMMITTED` with Source/Document `FOR UPDATE` | Do not depend on old REPEATABLE READ snapshots or fragile ordering requiring locking reads to be the first statement |
| Lifecycle provenance | Lifecycle-bearing canonical rows store `updated_by`, `archived_by`, `archived_at` | Trace current archive actor/time; full append-only history remains Phase 3 |
| Content fingerprint | SHA-256 over deterministic serialization of `{title, markdown, metadata}` | Includes all three revision fields, excludes hierarchy; no fuzzy matching |
| Version counter | `INT UNSIGNED`, `sync_version` starts at 0; reject overflow, no wraparound | Phase 0 uses safely representable JS integers; increment only on successful Apply fixtures |
| Lifecycle / enums | String columns with CHECK | Separate ACTIVE/ARCHIVED from SyncRun three-state lifecycle; constrain source type/ownership combinations |
| UI content | Display raw Markdown as React-escaped text | Enough for create/read smoke; no rich editor, HTML renderer, or external image service |

T01 locks dependencies after choosing versions; packages need not be installed now. Next.js officially provides setup paths for TypeScript, App Router, and Tailwind; lint uses ESLint CLI, and build does not replace lint.[Next.js installation](https://nextjs.org/docs/app/getting-started/installation)

Add shadcn components to the existing application using the official Next.js installation flow, retain the Base UI choice, and do not replace this project's structure with a dashboard template.[shadcn/ui Next.js](https://ui.shadcn.com/docs/installation/next)

## 3. Implementation Order and Deliverable Units

```text
T01 Application skeleton
  → T02 Local DB / migration infrastructure
  → T03 Core schema / constraints
  → T04 Domain rules / ports
  → T05 MariaDB repositories / transaction implementation
  → T06 Local identity / Workspace fixtures
  → T07 Knowledge application operations
  → T08 Source version / cross-module safety fixtures
  → T09 Minimal Web flow
  → T10 Full acceptance / handoff evidence
```

Use a single execution sequence; parallel agents and commits for every small step are not required. T04 pure domain work does not depend on DB completion, but schema, repositories, Workspace access, and transactions must be integrated before T07.

| Task | Reviewable deliverable on completion | Corresponding Design Spec |
| --- | --- | --- |
| T01 | Buildable Next.js skeleton and test/lint scripts | §3、§6、§9 |
| T02 | Runnable MariaDB, repeatable migration management | §5、§8.2 |
| T03 | Ten domain tables, native UUID, referential/unique/CHECK constraints | §5、§5.1 |
| T04 | Identity/Workspace/Knowledge/Source domain models, CallerContext, ports and unit tests | §4、§6、§8.1 |
| T05 | SQL repositories, Workspace policy, READ COMMITTED same-connection transactions and rollback tests | §6.4、§7.1 |
| T06 | Four-field Local Identity, Workspace/Membership seed and cross-org fixtures | §6.1、§6.1A |
| T07 | Minimal caller-aware create/read/update/lifecycle/hierarchy application operations | §4、§6.2、§7.1 |
| T08 | Evidence for mapping/reappearance/optimistic version/cross-repository atomicity and Workspace guards | §7.4～7.6、§8.2 |
| T09 | Minimal Workspace → Source → Tree Web flow and smoke E2E | §8.3 |
| T10 | All acceptance results and Phase 1/2/3 handoff instructions | §9～10 |

## 4. Data and Transaction Details That Must Be Established First

### 4.1 Ten Domain Tables and Migration Ledger

Domain tables：

```text
users
workspaces
workspace_memberships
knowledge_sources
knowledge_documents
knowledge_revisions
knowledge_tree_nodes
source_entries
knowledge_assets
sync_runs
```

The migration runner creates `schema_migrations` as a tooling ledger for versions, checksums, execution status, and time. It is not an eleventh product domain table and must not store Preview or audit features. Migrations are forward-only; verify development failures by rebuilding a dedicated disposable DB, and use explicit repair steps for existing non-test DBs.

All domain tables use InnoDB. Stable entity ID/FK columns consistently use MariaDB native `UUID`; application generates UUIDv7. WorkspaceMembership uses `(workspace_id, user_id)` as a composite key. Text uses utf8mb4; times consistently use UTC and `DATETIME(6)`; revision Markdown uses LONGTEXT; knowledge metadata uses JSON.

### 4.2 Relationships, Uniqueness, and Lifecycle Provenance

| Rule | Planned implementation |
| --- | --- |
| Workspace membership | `workspace_memberships.workspace_id` → Workspace, `user_id` → User; PK `(workspace_id,user_id)`; a user may join multiple Workspaces |
| Source Workspace scope | `knowledge_sources.workspace_id` NOT NULL FK → workspaces.id; Source does not store `org_code` as access ownership |
| Source content ownership | `source_type` + `ownership` CHECK permits three valid source combinations; separate from Workspace access |
| Revision Ownership | `knowledge_revisions.document_id` → Document; UNIQUE `(document_id, revision_no)`, revision_no starts at 1 |
| Actor Reference | Source/Document/Revision created_by, lifecycle-bearing row updated_by/archived_by, and SyncRun.triggered_by reference users.id; Phase 0 adds no polymorphic actor |
| Current Revision Belongs to the Same Document | Add UNIQUE `(document_id, id)` to Revision; Document's composite FK `(id, current_revision_id)` references it |
| Same-Source Reference | Add UNIQUE `(source_id, id)` to Document; Tree/SourceEntry `(source_id, document_id)` reference this key |
| One Document → One TreeNode | `knowledge_tree_nodes.document_id` UNIQUE for non-NULL values; Folder NULL values are unrestricted |
| Tree Parent in Same Source | Add UNIQUE `(source_id, id)` to Tree; `(source_id, parent_id)` self-references, null means Source root |
| Tree node type | FOLDER: nonempty name and null document_id; DOCUMENT: non-null document_id, name comes from revision title |
| Known External Identity | SourceEntry UNIQUE `(source_id, external_id)`; external_id is a nullable, case-sensitive opaque value; non-null values cannot be empty strings |
| Mapping Without External Identity | SourceEntry's own stable `id` is the Hub mapping key; UNIQUE `(source_id, document_id)` prevents duplicate mapping of a document; folder null document_id is exempt |
| Lifecycle provenance | Source/Entry/TreeNode/Document store `updated_by`, nullable `archived_by`, nullable `archived_at`; archive/restore updates share the status transaction |
| Revision immutability | Repository supplies only insert/read, no revision update/delete methods; application tests confirm old revisions remain entirely unchanged |

SourceEntry's nullable external ID cannot identify every new input; Phase 0 only prevents duplicate assignment of recognized identities. Different external IDs may coexist even with identical content; identical text must not trigger merging. `source_path` stores a locator, not a global identity/content-hash unique key. Folder/Document entries use their respective `entry_type`; asset metadata remains in `knowledge_assets`.

Column lengths chosen here: users `org_code`/`emp_id` use `VARCHAR(128)`, name/title use `VARCHAR(512)`, external_id uses `VARCHAR(512)` with utf8mb4 binary collation, source_path uses TEXT. `knowledge_sources` has no `org_code`. Reject overlong input with validation failure; do not truncate identifiers.

Phase 0 does not design SOURCE_MANAGED canonical title precedence: filename/path does not automatically equal Knowledge title; Phase 2 must define Title Resolution and conflict adjudication for candidates such as frontmatter, Markdown headings, and filenames.

FKs use restrictive delete/update behavior, without cascades deleting entire revision chains. Core data has no public hard-delete repository operation; isolated test-database cleanup is not product hard delete.

MariaDB supplies FK, UNIQUE, and CHECK constraints; DDL uses explicit constraint names unique across the schema. Nullable relationships and cross-row conditions still require application validation.[MariaDB constraints](https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint)、[Foreign keys](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/foreign-keys)

### 4.3 Document/Revision Circular Foreign Keys

Migration creates Document first (nullable `current_revision_id`), then Revision, then the same-document current-revision FK. Creation runs sequentially in one transaction:

```text
insert Document with temporary null current_revision_id
insert Revision R1
set Document.current_revision_id = R1
insert DOCUMENT TreeNode
assert created Document has a valid current revision
commit
```

This is physical insertion order, without changing domain completion requirements. The composite FK prevents referencing another document's revision; nullable bootstrap alone cannot prohibit committing every incomplete row at SQL level, so Document repository does not expose independent create to the Web, and application creation/transaction pre-commit assertions must guarantee completion before returning. Test FK protection and application integrity separately; do not claim a single DB constraint fully solves both.

### 4.4 Transaction Composition, CallerContext, and Workspace Access

Knowledge defines `KnowledgeUnitOfWork.run(work)` in its own ports; callbacks receive transaction-bound document/revision/tree repositories and trusted Source view/policy. Sources transaction ports may extend this with SourceEntry/asset/SyncRun/source-version repositories. Workspace access policy is an independent foundation boundary, not determined by UI or Sources scanner.

For each canonical mutation UoW, MariaDB infrastructure sets the transaction to `READ COMMITTED`, then uses the same connection for begin → callback → assertions → commit; roll back failures and release in finally. All transaction-bound repositories use that connection; `pool.query()` must not escape the transaction. The official connector supplies connection transaction methods.[MariaDB Node.js Promise API](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api)

The transport/server boundary always establishes `CallerContext` through a trusted `IdentityProvider`:

```ts
type CallerContext = {
  identity: UserIdentity;
};
```

All public Workspace/Knowledge/Sources application services take `caller` explicitly as their first argument. Operations on existing Source/Document/Tree resources obtain `workspace_id` from authoritative relationships before membership/policy checks; additional client workspaceId is not authorization proof. Internal mutation functions accept resolved trusted execution contexts/repositories, do not obtain identity from request/global state, and do not commit independently.

Phase 0 foundation ports must express at least:

```ts
interface WorkspaceAccessPolicy {
  requireMembership(caller: CallerContext, workspaceId: string): Promise<void>;
}
```

Phase 3 designs full role/capability policy; Phase 0 must not replace membership with `caller.identity.org_code === source.org_code` or similar shortcuts.

Source policy/view reads at least `source.id`, `source.workspace_id`, ownership, and status. The composition root in `src/server/` injects implementations.

### 4.5 Hierarchy, Revisions, and Concurrency

Phase 0 mutations first resolve the Source's Workspace and pass foundation access checks, then use the Source row as the serialization boundary, acquiring required row locks in fixed Document ID order. With the Source lock held, Tree moves verify the parent belongs to the same Source, is a Folder, and is neither self nor descendant, preventing two individually valid-looking moves from forming a cycle.

Canonical mutations use READ COMMITTED, so reads after source/document locking reads do not depend on earlier REPEATABLE READ consistent snapshots. Explicit Source/Document `FOR UPDATE` locks remain required; READ COMMITTED does not replace row locks.

Ordinary Hub content updates read the current revision, compare content, allocate the next revision_no, and insert under lock. This avoids duplicate numbering/partial pointer updates; it does not deliver Phase 5 multi-user stale-editor conflict UX.

Source row locks do not automatically increment sync_version. Only controlled successful Source Apply increments it; other Hub-managed updates do not masquerade as synchronization.

### 4.6 Source version guard

After the caller passes the Source's Workspace access check, the existing-Source guard protects the preview base version with conditional UPDATE:

```sql
UPDATE knowledge_sources
SET sync_version = sync_version + 1
WHERE id = ?
  AND sync_version = ?
  AND source_type = 'FOLDER_SYNC'
  AND ownership = 'SOURCE_MANAGED'
  AND status = 'ACTIVE';
```

Affected-row count must equal 1; otherwise the callback must perform no Knowledge writes and report the corresponding source-not-found/not-syncable/version-changed error. Version increment, Knowledge writes, mapping, and APPLIED record share one READ COMMITTED transaction; later failure also rolls back the version. Internal operations requiring Source locks may use the lock already held by this transaction.

This is a foundation primitive and integration fixture; Phase 0 exposes no Confirm API, builds no Preview storage, and scans no folders. Successful all-unchanged Apply fixtures only increment source version/record a run, without revisions or Tree changes. Fixtures can verify FAILED records survive in independent transactions; Phase 2 owns the complete error flow.

## 5. Execution Tasks

### T01 — Create Next.js and Tooling Skeleton

**Dependencies:** None.**Deliverable:** A minimal application that can install, typecheck, lint, and build.

Planned additions: `package.json`、`package-lock.json`、`.node-version`、`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`postcss.config.mjs`、`components.json`、`.gitignore`、`src/app/layout.tsx`、`src/app/page.tsx`、`src/app/globals.css`、`vitest.config.ts`、`vitest.integration.config.ts`。

Work:

1. Inspect the working directory and documents, and enter the working branch; do not run scaffolding commands that clear/overwrite the root containing existing `docs/`.
2. Set up App Router, strict TypeScript, and Tailwind using official procedures; if tools require an empty directory, use a temporary skeleton and move only verified necessary files, preserving existing documents.
3. Select Node LTS and compatible dependencies, lock actual versions; add official mariadb driver, Vitest, Playwright, tsx, and necessary lint tooling; add an application-side UUIDv7 generator, never DB random UUIDs or `Math.random()` for domain IDs.
4. Establish script contracts: `dev`, `build`, `start`, `lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `db:migrate`, `db:seed`. Wire DB/E2E scripts in their respective tasks; empty successful scripts must not pretend to pass.
5. ESLint restricts module domain/application imports of React/Next.js/database infrastructure, Knowledge imports of Sources implementation, and direct UI imports of mariadb repositories. `src/server/` is the permitted composition-root location.

Verify: `npm run typecheck`, `npm run lint`, `npm run build`; an empty shell without DB use should not require local DB connectivity. Confirm the dependency manifest has no excluded packages or empty future modules.

### T02 — Local MariaDB and Migration Runner

**Dependencies:** T01。**Deliverable:** Tools for starting DB, managing versions, and isolated tests.

Planned additions: `compose.yaml`、`.env.example`、`scripts/db/migrate.ts`、`scripts/db/test-database.ts`、`scripts/test/integration.ts`、`src/infrastructure/database/mariadb/config.ts`、`pool.ts`、`migrations/`、`tests/integration/migration-runner.test.ts`。

Work:

1. Compose configures MariaDB 10.11, healthcheck, dev volume, and localhost port; README uses `docker compose up -d --wait`. T02 does not build application containers or deployment platforms.
2. Use `KM_DB_*`, `KM_TEST_DB_*`, and separate E2E environment settings; `.env.example` provides local examples only; do not commit actual passwords. Test tools reject dev DB as a reset target.
3. Runner creates the ledger, executes migration SQL arrays in order, and records checksums; completed versions do not rerun; checksum mismatches or incomplete versions stop execution with diagnostics rather than ignored errors.
4. Migration connections acquire a dedicated mutual-exclusion lock so two runners cannot apply schema concurrently; release when done. Mark each module complete only after all SQL succeeds.
5. DDL failures may leave partial schema; do not wrap a transaction to pretend the batch can be restored. Test runner failure diagnostics and clean test-DB rebuild procedures.

DDL causes implicit commits, so canonical-state rollback tests must not contain migrations, TRUNCATE, or other DDL.[MariaDB implicit commit](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit)

Verify: start DB and confirm server version 10.11.x; runner creates a ledger in a new test DB; reruns do not repeat execution; failures/checksum mismatches return nonzero exit status. All test resets operate only on newly generated test databases with restricted names.

### T03 — Create Core Schema and Constraints

**Dependencies:** T02。**Deliverable:** The design specification's ten domain tables, native UUID, Workspace scope, lifecycle provenance, SQL protection/schema tests.

Planned additions: `src/infrastructure/database/mariadb/migrations/001-core.ts`、`002-current-revision.ts`、`003-required-lifecycle-actors.ts`、`tests/integration/schema.test.ts`。

Work:

1. Create users → workspaces → workspace_memberships → sources → documents → revisions → tree/entries/assets/runs in order; all stable entity ID/FKs use MariaDB native `UUID`; the second migration adds the current-revision composite FK.
2. Minimal Workspace fields: `id UUID PK`, `name`, `created_at`, `updated_at`; Phase 0 adds no owner_org_code, slug, role, or Workspace lifecycle.
3. WorkspaceMembership: `workspace_id` FK, `user_id` FK, `created_at`, PK `(workspace_id,user_id)`, with a user→workspace lookup index.
4. `knowledge_sources.workspace_id UUID NOT NULL` FK → workspaces.id; do not create `knowledge_sources.org_code`. Source sync_version defaults to 0; Document/Tree/Entry/Source lifecycle permits only ACTIVE/ARCHIVED.
5. SyncRun allows null `result_version` for PREVIEWED/FAILED; APPLIED requires completion time and valid result version; no additional Knowledge lifecycle.
6. Add necessary indexes for Source trees, current document lookups, source entry external identity, Workspace membership lookups, and revision history; do not prebuild full-text/vector indexes.
7. Add composite FK, CHECK, and UNIQUE per §4.2; specifically add non-NULL protection through `UNIQUE(knowledge_tree_nodes.document_id)`.
8. `updated_by`/`archived_by` reference users.id; ACTIVE rows require null `archived_by`/`archived_at`, while ARCHIVED rows require corresponding archive provenance.

Verify: full migration from empty DB; fixtures sharing Workspace across orgs; reject invalid Workspace Sources, duplicate memberships, wrong Source references, wrong current revisions, duplicate revision_no/external identity, a second TreeNode for one Document, FOLDER with document_id, and DOCUMENT without reference. The same external_id may occur in different Sources; multiple null external_ids may exist; asset table has no binary-storage column.

### T04 — Domain Models, CallerContext, Workspace Policy, and Ports

**Dependencies:** T01; schema fields follow T03.**Deliverable:** Pure domain tests and interfaces with injectable dependencies.

Planned additions:

```text
src/modules/identity/domain/user-identity.ts
src/modules/identity/application/caller-context.ts
src/modules/identity/ports/identity-provider.ts
src/modules/identity/ports/user-repository.ts
src/modules/workspaces/domain/workspace.ts
src/modules/workspaces/domain/workspace-membership.ts
src/modules/workspaces/ports/workspace-repository.ts
src/modules/workspaces/ports/workspace-membership-repository.ts
src/modules/workspaces/ports/workspace-access-policy.ts
src/modules/workspaces/application/workspace-query-service.ts
src/modules/knowledge/domain/{document,revision,tree-node,content,lifecycle,errors}.ts
src/modules/knowledge/ports/{document-repository,revision-repository,tree-repository,source-policy,unit-of-work}.ts
src/modules/sources/domain/{source,source-entry,asset,sync-run}.ts
src/modules/sources/ports/{source-repository,entry-repository,asset-repository,sync-run-repository,unit-of-work}.ts
tests/unit/{content,ownership,lifecycle,tree,source-mapping,caller-context,workspace-access}.test.ts
```

Work:

1. UserIdentity has exactly four string fields; CallerContext is exactly `{ identity: UserIdentity }`; `org_code` is an identity attribute, not direct Workspace allow/deny.
2. Define Workspace/Membership models and `WorkspaceAccessPolicy.requireMembership(caller, workspaceId)` foundation port; `WorkspaceQueryService.listWorkspaces(caller)` returns only caller memberships.
3. Source model uses `workspace_id` + source type/ownership; domain validation restricts type/ownership to valid combinations. Prohibit `source.org_code` authorization shortcuts.
4. Define canonical title/Markdown/JSON metadata input. Recursively sort metadata object keys, preserving array order; reject non-JSON values such as undefined/NaN. Preserve strings exactly, without trimming body text or silently changing newlines. Different object key order must not create new revisions.
5. Compare canonical representations to determine change, then generate content hash; include metadata and title. UUIDv7 generator and clock are injectable for tests without changing domain identity definitions.
6. Define same-document updates, rename/move, archive/restore, lifecycle provenance, and recognized mapping reappearance rules; do not guess document identity without external identity or title from filename/path without SOURCE_MANAGED title rules.
7. Use a small set of domain/application error types for validation, not found, workspace access denied, source read-only, version conflict, and integrity failure; do not expose SQL driver errors to UI.
8. Define §4.4 UoW and ports; public application ports explicitly accept CallerContext; do not build a giant database-neutral repository framework.

Verify: unit tests cover cross-org membership allow, same-org non-member deny, multi-workspace membership, org_code changes preserving membership, title-only, metadata-only, body-only, identical input, metadata key order, path-only, restore, and archive provenance. Reject SOURCE_MANAGED Hub mutations. CallerContext identity cannot be overwritten from command/query payloads.

### T05 — Repositories, Workspace Access, and READ COMMITTED Same-Connection Transactions

**Dependencies:** T03、T04。**Deliverable:** Real-DB data access, access guards, atomicity, isolation, and error translation.

Planned additions: `src/infrastructure/database/mariadb/transaction.ts`、`repositories/{users,workspaces,workspace-memberships,sources,documents,revisions,tree,entries,assets,sync-runs,source-policy}.ts`、`tests/integration/{repositories,transactions,workspace-access}.test.ts`。

Work:

1. All writes use parameterized SQL; translate JSON/UTC time/nullable values at repository boundaries and validate integer counters; UUID columns are externally represented as standard UUID strings.
2. Implement Workspace/Membership repositories and foundation policy; allow cross-org members and deny same-org non-members. Knowing workspace/source/document UUIDs does not grant access.
3. Implement UoW binding one connection to one repository set; set `READ COMMITTED` before begin for each canonical mutation; await every callback promise, roll back callback failures, and release connections afterwards.
4. Implement source/document locks, revision read/insert, set-current, Tree updates, and necessary mapping/run operations. Source view includes workspace_id/ownership/status.
5. Translate SQL duplicate/foreign-key/CHECK failures to stable application errors; retain server diagnostics without logging complete Markdown, passwords, or tokens.
6. Creation pre-commit assertions verify a valid current revision and exactly one DOCUMENT TreeNode per Document. Repository revision API provides no overwrite/delete.

Verify: inject failures at each point in real DB, using another connection each time to confirm no orphan data. Verify READ COMMITTED + `FOR UPDATE` with two connections. Add direct-resource lookup tests proving non-members cannot retrieve data through known Source/Document UUIDs.

### T06 — Local Identity, Workspace/Membership, and Reusable Fixtures

**Dependencies:** T05。**Deliverable:** Fixed four-field identity, trusted caller, minimal Workspace data, and non-Web test entry.

Planned additions: `src/modules/identity/application/get-current-identity.ts`、`src/infrastructure/identity/local-identity-provider.ts`、`src/server/composition.ts`、`src/server/config.ts`、`scripts/db/seed.ts`、`tests/unit/local-identity.test.ts`、`tests/integration/identity.test.ts`、`tests/fixtures/knowledge.ts`。

Work:

1. Local provider obtains fixed test identity from server-only configuration and returns `{id, emp_id, name, org_code}`. Missing fields/disabled local mode fail explicitly; do not accept arbitrary identity from query, form, or headers.
2. Server/transport adapter establishes `CallerContext { identity }` from Local Identity and passes it to application services; domain/application do not directly import request-specific identity providers.
3. Align `users` by UUIDv7 stable id/unique emp_id; name/org updates do not recreate IDs or automatically add/remove WorkspaceMembership.
4. Enable local demos and E2E through explicit `KM_LOCAL_IDENTITY_ENABLED`; versions without Company SSO do not serve as company production identity.
5. Development seed creates Local User, Workspace `Local Knowledge`, Membership `Local User → Local Knowledge`, one HUB_MANAGED Source, and one Folder; fixed valid UUIDs prevent duplication on rerun.
6. Minimum integration fixtures: User A(org HRSD), B(org RD), C(org IT); Workspace X/Y; A→X, B→X, B→Y, C→none; X has Hub/Folder Sources, Y has a Hub Source. Verify A sees X, B sees X/Y, and C cannot access even with known UUIDs.
7. `src/server/composition.ts` injects identity, Workspace query/policy, UoW, and repositories; only server adapters import it; domain does not import composition.

Verify: provider four fields, CallerContext creation, missing-configuration failure, employee-ID collision rejection, user updates retaining IDs; running seed twice creates no duplicate Workspace/Membership/Source/Folder. Forged frontend emp_id/org_code does not affect the actual caller.

### T07 — Knowledge Application Operations

**Dependencies:** T05、T06。**Deliverable:** Minimal core behavior reusable by Web and non-Web callers.

Planned additions: `src/modules/knowledge/application/{queries,commands,mutations}.ts`、`tests/integration/{knowledge-application,knowledge-lifecycle,knowledge-tree,workspace-access}.test.ts`。

Work:

1. Public application operations take `caller: CallerContext` first; `createHubManagedDocument(caller, input)` loads Source by sourceId → resolves `workspace_id` → requires Workspace membership → validates HUB_MANAGED Source/parent, then executes atomic creation.
2. `getDocument(caller, ...)`/`getCurrentRevision(caller, ...)`/`listTree(caller, ...)` resolve Workspace through resource relationships, check access first, then filter archived resources; additional workspaceId is not proof.
3. `createRevision(caller, input)`: check Workspace access + HUB_MANAGED/ACTIVE first, then lock Document and compare content; insert next revision + update pointer only when changed.
4. `archiveDocument`/`restoreDocument`: separate ordinary Hub-managed operations from controlled source internal operations; check Workspace access first, then maintain Document/Tree/SourceEntry lifecycle provenance.
5. Minimal `moveTreeNode`/`renameFolder`/`reorderNode`: validate within the same Source, reject ordinary SOURCE_MANAGED Hub operations; do not change Document ID, Revision, or Workspace.
6. Sources callers invoke controlled-source internal Knowledge mutations after passing Source Workspace access; Knowledge does not import matching implementation.
7. Core commands/queries do not import Next.js; no bypass path accepts UI-provided caller, org_code, workspace proof, actor_kind, isSync, or ownership mode.

Verify: alongside stable ID/revision/tree/lifecycle cases, add cross-org member access to allowed foundation scope, same-org non-member rejection, and direct document URL/UUID unable to bypass policy.

### T08 — SourceEntry and Sync Safety Foundation

**Dependencies:** T07。**Deliverable:** Concurrency/mapping/rollback/Workspace guard guarantees for future synchronization.

Planned additions: `src/modules/sources/application/source-version-guard.ts`、`tests/integration/{source-version,source-mapping,cross-module-atomicity,workspace-access}.test.ts`、`tests/fixtures/source-operations.ts`。

Work:

1. Sources application guard loads Source → resolves `workspace_id` → requires Workspace membership, then calls §4.6 conditional update through the source-repository port; SQL belongs in MariaDB repository.
2. Using resolved fixtures with known mappings, transactionally perform Document/Revision/Tree updates, SourceEntry lifecycle provenance/asset metadata writes, source version increment, and APPLIED run persistence.
3. Use two independent DB connections and a test barrier to attempt Apply fixtures concurrently with base version N; do not simulate concurrency on one connection.
4. Verify rollback, independent FAILED records, reappearance, all-unchanged semantics, and old Preview version invalidation.
5. Unauthorized callers cannot enter source projection flow even with known sourceId; Workspace access failures produce no Knowledge/SyncRun writes.

Full scanner/Preview/Confirm routes remain Phase 2.

### T09 — Minimal Web Flow and E2E

**Dependencies:** T07、T08。**Deliverable:** A human-operable foundation and one complete smoke flow.

Planned additions:

```text
src/app/knowledge/page.tsx
src/app/knowledge/[documentId]/page.tsx
src/app/knowledge/actions.ts
src/app/knowledge/error.tsx
src/app/knowledge/not-found.tsx
src/components/knowledge/{workspace-selector,source-navigation,knowledge-tree,create-document-form,document-viewer}.tsx
src/components/ui/{button,input,textarea,label}.tsx
playwright.config.ts
scripts/test/e2e.ts
tests/e2e/knowledge-smoke.spec.ts
```

Work:

1. Knowledge UI displays current Local Identity, Workspace selector → Source navigation (for example a Source-card list; dropdown Source selector optional) → Folder/Document Tree, and a basic Hub Source creation form.
2. Workspace selector comes only from `listWorkspaces(caller)`; switching reloads that Workspace's Sources. Unknown/unauthorized Workspaces stay hidden, and direct URLs/server actions revalidate.
3. Forms accept only content fields such as source/parent/title/Markdown; server actions establish CallerContext through IdentityProvider before application calls, and cannot treat displayed workspace/org/ownership as security checks.
4. After successful creation, the adapter navigates to a stable UUID document URL; reload reads the same document and current revision.
5. Viewer displays title, raw Markdown, current revision, Source ownership, and provenance; relative asset paths remain text.
6. Error/not-found views show no SQL/stack traces; unauthorized resources disclose no title/snippet.
7. E2E runner uses a dedicated DB/port, without reusing the user's dev server.

Verification flow:

```text
open Knowledge Hub → see configured Local Identity
  → list caller-visible Workspaces
  → select Workspace
  → view caller-accessible Sources
  → select or interact with target Source / expand Folder
  → create document
  → stable document URL
  → reload → same ID/title/content
  → navigate through Tree → same document
```

Also verify: cross-org authorized fixtures can browse; non-member Workspaces are absent from selector; direct unauthorized Document visits are denied without content disclosure.

### T10 — Acceptance and Handoff

**Dependencies:** T01–T09。**Deliverable:** Reproducible startup instructions, check results, and Phase 0 completion evidence.

Planned additions/updates: `README.md`、`docs/development/local-setup.md`、`docs/superpowers/verification/2026-09-10-phase-0-foundation-verification.md`。Create verification files only during actual execution, without prefilled passing results.

Work:

1. Clearly document runtime/dependency locks, UUIDv7, Docker, env, migration, Workspace membership foundation, READ COMMITTED UoW, seed, startup, testing, and test-DB cleanup.
2. Run §6 acceptance commands; attach repairs/rerun results for each failed check; finished documents or successful builds do not replace DB concurrency/E2E evidence.
3. Check module import direction, CallerContext, Source→Workspace policy resolution, transaction connection/isolation, SOURCE_MANAGED guards, current pointer, one-document-one-treenode, and archive filtering/provenance.
4. Check manifests/tables/routes introduce no excluded dependencies or Phase 3 Workspace administration, Folder Sync, SSO, publishing, search/vector, MCP, memory, Agent actor models, binary storage, or hard-delete features.
5. Verification records commands, execution dates, versions, pass/fail, and remaining limits. If DB/browser environments cannot run, list unverified items and keep Phase 0 incomplete.
6. Handoff to Phase 1/2/3: Phase 1 inherits Workspace foundation; Phase 2 new Source import chooses Workspace, existing Source sync never transfers; Phase 3 owns Workspace provisioning/lifecycle and production governance.

## 6. Command Contracts and Test Isolation

The commands below are script contracts T01–T09 must implement; this list is not evidence they were run now.

### 6.1 Local Startup

```sh
npm ci
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm run dev
```

Initial skeleton dependency setup uses `npm install` to generate lockfile, then `npm ci` for reproduction. `dev` and E2E servers bind only localhost by default; versions lacking Company SSO/Phase 3 governance are not company production multi-user entry points.

### 6.2 Acceptance Commands

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

| Script | Actual behavior and passing criteria |
| --- | --- |
| `typecheck` | TypeScript no-emit checks; script prepares generated Next route types if needed |
| `lint` | ESLint CLI and module import restrictions, zero errors |
| `test:unit` | Vitest run including Workspace access/ownership/content/lifecycle/CallerContext/Tree; no DB connection |
| `test:integration` | Dedicated empty DB, migrations, Vitest integration suites; missing DB/migration failures fail the run |
| `build` | Next production build; no build-time local user or Knowledge queries required |
| `test:e2e` | Start server with build output and dedicated DB/port, Playwright smoke; clean up its own resources afterwards |

Isolate integration suites with separate test DBs and execute suites sequentially by default; race cases explicitly create two connections within one suite. Do not wrap all cases in test-wide rollback transactions: that hides actual commit visibility and prevents cross-connection concurrency testing.

Test DB names use restricted `hcm_km_test_...`/`hcm_km_e2e_...` patterns; runner also verifies each was generated for this run. Reset/drop must not target dev DB; do not globally disable FK checks to pass failing tests.

## 7. Behavioral Acceptance Matrix

| ID | Scenario | Required observed result | Primary tasks |
| --- | --- | --- | --- |
| A01 | Migrate a new test DB, rerun migration | Ten domain tables + tool ledger created; native UUID stable entity IDs; no duplicate schema on rerun | T02–T03 |
| A02 | R1 belongs to document A; attempt to set it current for document B | DB rejects; B pointer unchanged | T03 |
| A03 | Any Document/Revision/Tree creation step fails | No orphan document/revision/tree; return IDs only after successful creation | T05、T07 |
| A04 | Change title/Markdown/metadata separately | Each creates a new revision; original revision unchanged | T04、T07 |
| A05 | Changed metadata key order or identical input | Current revision/revision count unchanged | T04、T07 |
| A06 | Filename/Folder rename, move, reorder | Stable Document ID/revision unchanged; filename does not automatically change canonical title | T04、T07、T08 |
| A07 | Hub attempts to modify SOURCE_MANAGED | Service rejects, no DB changes; UI flags cannot bypass | T07 |
| A08 | Read Tree after archive, then restore | Default Tree excludes archived entries; history/IDs retained; archive actor/time readable; restore reappears normally and clears current archive provenance | T03、T07 |
| A09 | A recognized SourceEntry reappears | Original ID; identical content adds no revision, changed content does | T08 |
| A10 | Duplicate external identity within one Source | UNIQUE rejects; same external_id may exist across Sources | T03、T08 |
| A11 | Same content, different source identities | No automatic merge; hash is not identity | T04、T08 |
| A12 | Create a second DOCUMENT TreeNode for one Document | DB/application rejects; original node unchanged | T03、T07 |
| A13 | Two connections race using the same base version | At most one succeeds; loser has no Knowledge/version writes | T08 |
| A14 | Reread after READ COMMITTED lock wait | Waiter validates against latest committed state after acquiring lock | T05、T08 |
| A15 | Source Apply fixture fails midway | Knowledge/Tree/Entry/asset/provenance/version/APPLIED all roll back | T08 |
| A16 | Persist FAILED after main transaction fails | FAILED survives independently; no result_version; Knowledge still rolled back | T08 |
| A17 | Successful all-unchanged Apply fixture | Only increment source version/run; revision/Tree/archive unchanged | T08 |
| A18 | Operate on archived or different-Source parent | Reject invalid structures; no silent reparenting/Source changes | T07 |
| A19 | Concurrent moves might form a cycle | Source lock and ancestry validation prevent illegal results | T07 |
| A20 | Local identity + forged frontend emp_id/org | Server-established CallerContext still uses configured trusted test identity | T06 |
| A21 | Workspace Source navigation + reload after page creation/Tree navigation | Workspace selector + identifiable/actionable Source navigation (Source-card lists qualify, no dropdown required) shows accessible Sources; same stable URL/Document ID/current revision | T09 |
| A22 | Direct non-Web application call | Call with CallerContext + Workspace policy; no React/Next runtime | T07、T10 |
| A23 | Asset metadata write/read | Persist path/metadata; no binary storage/serving | T03、T05 |
| A24 | Create Source without valid `workspace_id` | FK/application rejects | T03、T07 |
| A25 | User A shares org with a Workspace X member but is not a member | Read/write denied | T05、T07 |
| A26 | User B has a different org but Workspace X membership | Foundation access passes | T05、T07 |
| A27 | User B is a member of both Workspace X/Y | `listWorkspaces(caller)` returns X/Y | T04、T06、T09 |
| A28 | User C knows Source/Document UUIDs but is not a member | Reject without disclosing Knowledge content | T05、T07、T09 |
| A29 | User `org_code` changes | User ID and WorkspaceMembership do not automatically change | T06 |
| A30 | Duplicate `(workspace_id,user_id)` membership creation | DB constraint rejects | T03 |
| A31 | UI submits unauthorized Workspace/Source IDs | Server/application revalidates and rejects | T07、T09 |

## 8. Completion Checklist and Subsequent Responsibilities

Check these boxes only after implementation with fresh evidence; the verification record confirms them for this run.

- [x] T01：Technical skeleton, version locks, UUIDv7 generator, lint/typecheck/build available.
- [x] T02：Local MariaDB 10.11, migration runner, isolated test DB available.
- [x] T03：Ten domain tables, Workspace/Membership, native UUID, lifecycle provenance, one-document-one-treenode, composite FK/CHECK/UNIQUE verified against real DB.
- [x] T04：Domain models/CallerContext/Workspace policy/ports and core-rule unit tests pass.
- [x] T05：Repositories, Workspace access, READ COMMITTED shared-connection transaction/rollback pass.
- [x] T06：Four-field Local identity, Workspace/Membership seed, cross-org fixtures available; no frontend identity-trust shortcuts.
- [x] T07：Minimal caller-aware application create/read/revision/lifecycle/hierarchy behavior passes.
- [x] T08：Mapping/reappearance/source version race/atomicity/Workspace guards pass.
- [x] T09：Minimal Workspace → Source navigation → Tree Web flow (Source-card lists qualify, no dropdown required) and Chromium smoke pass.
- [x] T10：Acceptance records complete; scope/dependency review passes.

| Subsequent phase | Delivered handoff points | Work remaining for subsequent phases |
| --- | --- | --- |
| Phase 1 | Workspace/Membership foundation、Knowledge models、repositories、CallerContext、commands／queries、Tree invariants | Complete Knowledge/Tree product capabilities and read-only browser |
| Phase 2 | Workspace-scoped Sources、SourceEntry／asset／SyncRun repositories、version guard、Sources UoW、Internal Knowledge mutations | Select Workspace for new Source, non-ZIP Folder uploads, scanning/parsing, Title Resolution, matching/ambiguity, diff, Preview/Confirm/Apply; existing Source sync does not transfer Workspaces |
| Phase 3 | UserIdentity、CallerContext、Workspace/Membership foundation、current lifecycle provenance | **Workspace provisioning/create、rename、archive/restore**；membership administration；roles/capabilities；Team/SSO Group mapping；production policy/audit；Company SSO; MVP does not hard-delete Workspaces |
| Phase 4–9 | UI-independent application core、stable IDs/revisions、Workspace-aware boundary | Discovery、authoring、publishing、MCP、semantic retrieval、memory／relations；Build Principal/Actor models only if Agent writes are actually needed |

Phase 0 internal source-update fixtures do not guarantee recognition of arbitrary folder renames or determine source titles; Phase 2 must define matching, Title Resolution, and Preview product rules under existing contracts. Phase 0 revision row locks do not mean complete author conflict handling is finished. Asset metadata does not imply attachment accessibility.

## 9. Plan Self-Review

| Aspect | Review conclusion |
| --- | --- |
| Canonical Design Alignment | This plan directly uses Workspace → Source → Tree; no old knowledge_sources.org_code / org→source execution instructions |
| Schema | Ten domain tables; workspaces/workspace_memberships form the foundation, Source uses workspace_id |
| Actual Project Starting Point | Recheck branch/worktree before implementation; file lists are plans, not claims of existing implementation |
| IDs | Application generates UUIDv7, MariaDB 10.11 uses native UUID; Membership uses a composite key |
| Caller boundary | CallerContext is the explicit first public-service argument; transport/provider establishes identity, not payload or ambient state |
| Workspace boundary | org_code is identity only; cross-org member allow, same-org non-member deny; direct resource IDs cannot bypass policy |
| Workspace lifecycle owner | Phase 3 explicitly owns provision/create, rename, archive/restore, administration; Phase 0 does not implement management UI early |
| Actor model | Phase 0–2 retain user FKs; no early actor_kind; Agent writes belong to the phase that actually needs them |
| Isolation | Canonical mutation UoW specifies READ COMMITTED and retains Source/Document FOR UPDATE; concurrency tests use two connections |
| Lifecycle provenance | Archive/restore update status and actor/time together; full append-only audit history remains Phase 3 |
| Tree uniqueness | one-document-one-treenode is a T03 DB invariant |
| DDL／DML rollback | Diagnose/rebuild isolated DBs on migration failure; Knowledge atomicity tests do not mix in DDL |
| Module direction | Separate identity/workspaces/knowledge/sources responsibilities; Knowledge does not depend backwards on scanner/sync implementations |
| Source ownership | Separate Workspace access from SOURCE_MANAGED/HUB_MANAGED content authority |
| SourceEntry ambiguity / Title | Do not pretend path/hash unique keys or filename titles solve source identity; matching/Title Resolution explicitly belong to Phase 2 |
| Sync scope | Only version guards, repositories, atomicity fixtures; no scanner/Preview/Confirm/Apply product entry points |
| Identity／governance | Company production multi-user write access requires Phase 3; Phase 0–2 provide only local/mock MVP foundation |
| E2E Prerequisites | Dedicated DB, seed, build server, port; no reused dev server; restricted cleanup targets |
| Test Credibility | Unavailable DB/browser does not pass; concurrency uses two real connections; no prefilled verification results |
| Scope Control | No preinstalled future editor/drag/search/MCP/publishing/memory, Agent actor model, or binary storage |

This is the current Phase 0 implementation plan. The Workspace amendment preserves architecture-change history, but executors do not need it to patch old org/source instructions here; start at T01 using this document and the current Phase 0 design.
