# Knowledge Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Engineers and PMs curate and read ordered, annotated, Workspace-scoped references to existing Markdown documents without copying content or weakening Folder Sync/Workspace authorization.

**Architecture:** Add `KnowledgeCollection` entities, repository and application service to the existing `knowledge` module. MariaDB stores collection metadata and Document-ID references; all read/write operations use trusted `CallerContext`, current Workspace grants, the existing Unit of Work and latest saved revision projections. Provide private Workspace API and pages, plus an action-registry command from existing document surfaces.

**Tech Stack:** Next.js 15, React 19, TypeScript, MariaDB 10.11 native UUID, Vitest, Playwright, existing Tailwind/Base UI components; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-knowledge-collections-design.md` (approved 2026-10-15).

## Global Constraints

- v1 **Workspace-based**: no anonymous shares, saved-share bearer access, cross-Workspace references, special Collection ACL or privileged Agent endpoints.
- Collections hold no Markdown, copied revisions or source paths; items reference canonical `knowledge_documents.id` and resolve **current** saved revisions at read time.
- `SOURCE_MANAGED` folder files remain Hub-read-only. Collections do not write original Sources, revisions, tree nodes or folder-import metadata.
- One flat ordered list with optional **plain-text**, max **500 Unicode characters** per-item reading note; Collection name trimmed nonblank max **120 Unicode characters**, description max **2,000**.
- Max **200 items per collection**; list pagination **50 collections**; cap picker results; Collection archival retains items.
- All successful mutations increment collection `version` **exactly once**, require client `expectedVersion`, and are atomic. Concurrent stale writes return **409**.
- Editor/Admin/Owner may curate/archive/restore in an **ACTIVE** Workspace; Viewer may read; creator identity confers no exclusive permission.
- Document/source archive, permission loss, and changed Document IDs must never expose stale titles, notes or metadata, and must never trigger automatic relinking.
- Use native MariaDB UUID / application `uuidv7()`, current `KnowledgeUnitOfWork`, Workspace locks, immutable revision semantics and existing frontend design language.
- All external-facing IDs are *selectors*, not grants. Preserve 404 non-disclosure, discoverable-but-unreadable 403, trusted login 401 / unavailable identity 503, and `private, no-store` responses.
- Add English **and** Traditional Chinese guide copy; no binary assets or deployment/SSO implementation.
- Before execution, create an isolated worktree/branch with the applicable Superpowers skill; check current `main` and rebase the approved spec/plan if required. Existing migrations end at 022 **at planning time**; allocate the next still-available number at execution.

## Review Focus

1. **Archived item with previously visible annotation/title:** a Viewer sees only a generic unavailable placeholder, never cached or saved private metadata — pinned by Task 3 integration and Task 7 component tests.
2. **Folder sync rename+edit creates a new Document ID:** the previous item stays unavailable, no path/title-based relink — pinned by Task 3 integration and Task 9 E2E.
3. **Concurrent Editor mutations:** one wins, the other gets a 409, and no partial positions/version updates persist — pinned by Task 5 integration and Task 6 HTTP tests.
4. **Malicious note contents:** HTML-looking markup is displayed as inert text; no Markdown/HTML execution — pinned by Task 1 validation and Task 7 component test.
5. **Identity/network failure:** unauthenticated caller gets 401, configured-but-unavailable provider gets 503, database outage remains 5xx rather than an empty list — pinned by Task 6 HTTP/E2E tests.

## File Structure / Interface Map

| Responsibility | Files |
| --- | --- |
| Domain rules and types | Create `src/modules/knowledge/domain/knowledge-collection.ts`, `knowledge-collection-errors.ts` |
| Repository port and Unit of Work | Create `src/modules/knowledge/ports/knowledge-collection-repository.ts`; modify `src/modules/knowledge/ports/unit-of-work.ts` |
| MariaDB migration and adapter | Create `src/infrastructure/database/mariadb/migrations/023-knowledge-collections.ts` **only if 023 is free**; modify `migrations/index.ts`; create `src/infrastructure/database/mariadb/repositories/knowledge-collections.ts`; modify `repositories/index.ts` |
| Application authorization and operations | Create `src/modules/knowledge/application/knowledge-collection-service.ts`; keep method-level helpers scoped to that file unless complexity requires a small `application/internal/collection-write.ts` |
| Composition / HTTP | Modify `src/server/composition.ts`, `src/server/http-error-response.ts`; create `src/server/collection-http.ts` and routes under `src/app/api/workspaces/[workspaceId]/collections/` |
| Pages and components | Create `src/app/w/[workspaceId]/collections/page.tsx`, `[collectionId]/page.tsx`, `src/components/knowledge/collection-list.tsx`, `collection-detail.tsx`, `collection-picker-dialog.tsx`, `collection-add-request.ts`; modify `src/components/shell/primary-nav.tsx` |
| Existing Document actions | Modify `src/components/actions/action-registry.ts`, `action-icon.tsx`, `action-menu.tsx` and the existing Knowledge layout that hosts document-scoped dialogs |
| Tests and docs | Create `tests/unit/knowledge-collection-domain.test.ts`, `knowledge-collection-ui.test.tsx`, `tests/integration/knowledge-collection-service.test.ts`, `tests/integration/knowledge-collection-repository.test.ts`, `tests/e2e/knowledge-collections.spec.ts`; modify `src/components/help/user-guide-content.ts` and relevant action/HTTP unit tests |

**Named contracts shared between tasks** (new types are exported from the indicated module; tasks may add internal private types, not rename these):

- Domain `KnowledgeCollection` = `{id:string; workspaceId:string; name:string; description:string; version:number; status:"ACTIVE"|"ARCHIVED"; createdBy:string; updatedBy:string; archivedBy:string|null; archivedAt:Date|null; createdAt:Date; updatedAt:Date}`.
- Domain `KnowledgeCollectionItem` = `{id:string;collectionId:string;documentId:string;position:number;readingNote:string;addedAt:Date}`.
- Domain `CollectionItemView` = `{id:string;position:number;state:"available"|"unavailable";documentId?:string;sourceId?:string;title?:string;sourceName?:string;readingNote?:string}`. For unavailable rows, **never emit** optional document/title/note fields.
- Domain `CollectionDetail` = `{collection:KnowledgeCollection;items:CollectionItemView[]}`; `CollectionPage` = `{items:Array<KnowledgeCollection & {availableItems:number;totalItems:number}>;nextCursor:string|null}`.
- `KnowledgeCollectionService` constructor `(unitOfWork: KnowledgeUnitOfWork, clock: () => Date = () => new Date())`.
- `KnowledgeCollectionRepository` methods defined in Task 2; `KnowledgeRepositories.collections: KnowledgeCollectionRepository`.
- Use DomainError codes `COLLECTION_NOT_FOUND` (404), `COLLECTION_FORBIDDEN` (403), `COLLECTION_INVALID` (400), `COLLECTION_CONFLICT` / `COLLECTION_DUPLICATE_ITEM` (409), `COLLECTION_LIMIT` (422). Identity 401/503 are existing codes. A missing Workspace or caller still uses existing Workspace/Identity errors.
- All write methods return `{version:number}`, except `create` returns `{id:string;version:number}`; errors never return unfiltered DB objects.

---

### Task 1: Domain validation, immutable identity, and ordering

**Files:**
- Create: `src/modules/knowledge/domain/knowledge-collection.ts`
- Create: `src/modules/knowledge/domain/knowledge-collection-errors.ts`
- Test: `tests/unit/knowledge-collection-domain.test.ts`

**Interfaces:**
- Produce: `normalizeCollectionName(value:unknown):string`, `normalizeCollectionDescription(value:unknown):string`, `normalizeReadingNote(value:unknown):string`, `parseCollectionVersion(value:unknown):number`, `validateCollectionOrder(existingIds:readonly string[],requestedIds:readonly string[]):void`, `parseCollectionCursor(raw:unknown):{updatedAt:Date;id:string}|null`, `encodeCollectionCursor(updatedAt:Date,id:string):string`, constants `MAX_COLLECTION_ITEMS=200` and `COLLECTION_PAGE_SIZE=50`, plus shared domain types and error classes above.
- Require trimmed nonblank names, exact field type checking, safe positive integer version, duplicate-free identical item permutations, bounded cursor syntax (reject malformed/oversized/non-UUID cursors), and scalar Unicode character counts via `Array.from(string).length`.
- Error constructors emit stable `DomainError.code`; all validation messages are safe to return to callers.

- [ ] **Step 1: Write failing tests** in `knowledge-collection-domain.test.ts` named `normalizes collection text within bounds`, `rejects 121-char name 2001-char description and 501-char note`, `rejects duplicate or missing order IDs`, `rejects malformed cursor and unsafe version`, `encodes and decodes cursor exactly` and `treats html-looking notes as plain text`. Assert 200th valid item and 201st limit through exported constant.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/knowledge-collection-domain.test.ts`; expected **FAIL** because the domain module/functions do not exist.
- [ ] **Step 3: Implement exact exports** listed under Interfaces using the existing `DomainError` hierarchy and UUID parser from `@/shared/ids/uuidv7`; do not build Markdown/HTML rendering or dynamic eval.
- [ ] **Step 4: Re-run the same Vitest command**; expected **PASS**.
- [ ] **Step 5: Commit** `git add src/modules/knowledge/domain/knowledge-collection* tests/unit/knowledge-collection-domain.test.ts && git commit -m "feat: define collection domain rules"`.

### Task 2: MariaDB persistence and bounded projections

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/023-knowledge-collections.ts` (rename/renumber if another migration claims 023)
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Create: `src/modules/knowledge/ports/knowledge-collection-repository.ts`
- Modify: `src/modules/knowledge/ports/unit-of-work.ts`
- Create: `src/infrastructure/database/mariadb/repositories/knowledge-collections.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/index.ts`
- Test: `tests/integration/knowledge-collection-repository.test.ts`

**Interfaces:**
- Produce repository port `KnowledgeCollectionRepository`:
  - `findById(id:string):Promise<KnowledgeCollection|null>`; `lockById(id:string):Promise<KnowledgeCollection|null>`; `insert(value:KnowledgeCollection):Promise<void>`;
  - `listByWorkspace(workspaceId:string,status:"ACTIVE"|"ARCHIVED",cursor:{updatedAt:Date;id:string}|null,limit:number):Promise<Array<KnowledgeCollection & {availableItems:number;totalItems:number}>>`, ordered `updated_at DESC,id DESC`;
  - `listItems(collectionId:string):Promise<KnowledgeCollectionItem[]>`; `resolveItems(collectionId:string,workspaceId:string):Promise<CollectionItemView[]>` (one bounded joined projection, ordered by position/id; missing/archived/out-of-scope rows return generic unavailable data only);
  - `insertItem(item:KnowledgeCollectionItem):Promise<void>`; `updateItemNote(itemId:string,note:string):Promise<void>`; `deleteItem(itemId:string):Promise<void>`; `replacePositions(collectionId:string,items:readonly {id:string;position:number}[]):Promise<void>`;
  - `saveMetadata(value:KnowledgeCollection):Promise<void>` (update row and its version atomically after service lock); `countItems(collectionId:string):Promise<number>`.
- Tables/columns/constraints exactly as spec `5: `knowledge_collections` + `knowledge_collection_items`; UUID FKs `ON DELETE RESTRICT`, `UNIQUE(collection_id,document_id)`, `(workspace_id,status,updated_at,id)` index, status/provenance CHECK; no unique position constraint.
- List/projection queries are bounded; `resolveItems` uses `CASE WHEN` for current active document, source, saved revision, and matching Workspace (and active tree/document position as existing Reader requires). Never select content bodies; never store title/path snapshots in Item table.

- [ ] **Step 1: Write failing integration tests** `persists empty collection and two ordered references`, `keeps references after collection archive`, `projection masks archived source/document metadata and notes`, `list cursor has stable tie breaker`, `unique collection document pair rejects duplication`, `migration FK and CHECK constraints reject invalid rows`.
- [ ] **Step 2: Run** `make test-integration`; expected new repository/migration assertions **FAIL** before implementation (keep existing tests green).
- [ ] **Step 3: Add migration, port and adapter** with signatures above; wire `collections` into `KnowledgeRepositories` and `createRepositories()` without changing `MariaDbUnitOfWork` transaction behavior. If 023 exists in current main, allocate the next unused version and update both filename and index.
- [ ] **Step 4: Run** `make test-integration`; expected **PASS**, including FK behavior and masked projection tests.
- [ ] **Step 5: Commit** `git add src/infrastructure/database/mariadb/migrations src/infrastructure/database/mariadb/repositories src/modules/knowledge/ports tests/integration/knowledge-collection-repository.test.ts && git commit -m "feat: persist knowledge collection references"`.

### Task 3: Read, authorization and lifecycle projection

**Files:**
- Create: `src/modules/knowledge/application/knowledge-collection-service.ts`
- Test: `tests/integration/knowledge-collection-service.test.ts`
- Test: `tests/unit/knowledge-collection-authorization.test.ts`

**Interfaces:**
- Produce `list(caller:CallerContext,workspaceId:string,input:{status?:"ACTIVE"|"ARCHIVED";cursor?:string|null}):Promise<CollectionPage>` and `get(caller:CallerContext,workspaceId:string,collectionId:string):Promise<CollectionDetail>`.
- `list`: verify Workspace discover + `document.read` via existing transaction-scoped access, 50-item cursor page, no body. `get`: ensure collection belongs to requested Workspace and caller may read; return row-order items and only current valid metadata. Archived collection may be read by authorized member with an explicit `get` URL; mutations stay disabled.
- `resolveItems` projection from Task 2 is not sufficient authority on its own: service must require valid caller/Workspace **before** calling it; never cache metadata from prior successful reads. Reuse existing membership/read semantics, including archived Workspace rules.
- In unit tests, test the 404/403 discover/read distinction without weakening global Workspace authorization.

- [ ] **Step 1: Write failing integration tests** `lists only same workspace collections`, `viewer reads another editor collection`, `outsider and wrong workspace ID cannot enumerate`, `archived document shows unavailable without documentId title sourceName or readingNote`, `restored same ID becomes available`, and `new ID after source sync does not replace old ID`. Add unit test `discoverable-but-no-read produces forbidden`.
- [ ] **Step 2: Run** `make test-integration` and `npx vitest run --config vitest.config.ts tests/unit/knowledge-collection-authorization.test.ts`; expected new cases **FAIL**.
- [ ] **Step 3: Implement read methods** on `KnowledgeCollectionService` with current caller sync, membership capability evaluation and batched repository reads; ensure no archived/private attributes escape in serialized detail and no client-supplied Workspace override.
- [ ] **Step 4: Re-run both commands**; expected **PASS**.
- [ ] **Step 5: Commit** `git add src/modules/knowledge/application/knowledge-collection-service.ts tests/integration/knowledge-collection-service.test.ts tests/unit/knowledge-collection-authorization.test.ts && git commit -m "feat: read workspace collections safely"`.

### Task 4: Create, rename, archive and restore under version control

**Files:**
- Modify: `src/modules/knowledge/application/knowledge-collection-service.ts`
- Test: `tests/integration/knowledge-collection-service.test.ts`

**Interfaces:**
- Produce `create(caller:CallerContext,workspaceId:string,input:{name:unknown;description?:unknown}):Promise<{id:string;version:number}>`.
- Produce `update(caller:CallerContext,workspaceId:string,collectionId:string,input:{expectedVersion:unknown;name?:unknown;description?:unknown;status?:"ACTIVE"|"ARCHIVED"}):Promise<{version:number}>`.
- New collection starts `ACTIVE`, version `1`; audit provenance `createdBy=updatedBy=caller.identity.id`. Each successful `update` increments version exactly once and updates actor/time.
- For mutations lock parent Workspace first through existing `workspaces.lockSharedById`, reevaluate current capabilities using `evaluateWorkspaceCapabilities`, assert `document.write` + active Workspace, then lock Collection `FOR UPDATE` and recheck scope, state, `expectedVersion`. Only archived collection → ACTIVE restore is allowed; all other archived mutations conflict. Preserve id/items/notes across archive/restore; set/clear archive actor/timestamp consistently.
- Every metadata write is transactional. Do not introduce a per-creator ACL. Mark stale expectedVersion `COLLECTION_CONFLICT`, permissions `COLLECTION_FORBIDDEN`, unknown resource `COLLECTION_NOT_FOUND`.

- [ ] **Step 1: Write failing tests** `editor can update a different editor's collection`, `viewer cannot create or archive`, `archived Workspace rejects writes`, `stale rename returns conflict leaving saved name/version unchanged`, `archive and restore retain Item IDs and version advances by one`, `two concurrent updates have one winner`.
- [ ] **Step 2: Run** `make test-integration`; expected **FAIL** for these new operations.
- [ ] **Step 3: Implement `create` and `update`** following the lock order and typed errors above; ensure existing `WorkspaceMembershipPolicy` and TEAM group-grant evaluation are reused rather than adding a role enum to Collection.
- [ ] **Step 4: Run** `make test-integration`; expected **PASS**.
- [ ] **Step 5: Commit** `git add src/modules/knowledge/application/knowledge-collection-service.ts tests/integration/knowledge-collection-service.test.ts && git commit -m "feat: manage collection lifecycle with version checks"`.

### Task 5: Add, annotate, remove and reorder members atomically

**Files:**
- Modify: `src/modules/knowledge/application/knowledge-collection-service.ts`
- Test: `tests/integration/knowledge-collection-service.test.ts`
- Test: `tests/unit/knowledge-collection-domain.test.ts`

**Interfaces:**
- Produce:
  - `addItem(caller,workspaceId:string,collectionId:string,input:{documentId:unknown;readingNote?:unknown;expectedVersion:unknown}):Promise<{version:number}>`
  - `editItemNote(caller,workspaceId:string,collectionId:string,itemId:string,input:{readingNote:unknown;expectedVersion:unknown}):Promise<{version:number}>`
  - `removeItem(caller,workspaceId:string,collectionId:string,itemId:string,expectedVersion:unknown):Promise<{version:number}>`
  - `reorder(caller,workspaceId:string,collectionId:string,input:{itemIds:unknown;expectedVersion:unknown}):Promise<{version:number}>`
- Use Task 4 Workspace-shared-lock → grants → Collection-FOR-UPDATE preamble. On add, under the same transaction, obtain the target Document record/source policy and lock/revalidate current active state, matching Workspace, saved current revision and read permission. Lock Source/Document in the existing content-write order; never infer ownership from path. Enforce 200 cap transactionally.
- `addItem` appends at position `countItems()`; duplicate pair gives `COLLECTION_DUPLICATE_ITEM` 409; Item readingNote is normal metadata for available documents only.
- `editItemNote` may act on an unavailable item by ID without leaking its old content, provided Editor still has collection write permission.
- `removeItem` deletes only that collection membership; renumber remaining `0..n-1` in the same transaction, never delete the Document.
- `reorder` requires **exactly** the current item ID permutation; verify no duplicates/missing/foreign IDs, update dense positions within one transaction, increment version once.

- [ ] **Step 1: Write failing tests** `can append document from two different sources in one workspace`, `foreign or archived document ID rejected without leak`, `duplicate item and 201st item rejected`, `remove retains Document and closes position gap`, `unavailable item note may be edited but remains hidden`, `reorder duplicate missing or foreign item rolls back`, `concurrent note edit versus reorder yields one 409 and intact ordering`.
- [ ] **Step 2: Run** `make test-integration`; expected new tests **FAIL**.
- [ ] **Step 3: Implement item commands** using Task 2 repository APIs and transaction preamble; no Source or Revision mutations, no auto relinking, no new read token.
- [ ] **Step 4: Run** `make test-integration`; expected **PASS** including no partial writes or extra version increments.
- [ ] **Step 5: Commit** `git add src/modules/knowledge/application/knowledge-collection-service.ts tests/integration/knowledge-collection-service.test.ts tests/unit/knowledge-collection-domain.test.ts && git commit -m "feat: curate collection items atomically"`.

### Task 6: Trusted private Collection HTTP API and composition

**Files:**
- Modify: `src/server/composition.ts`
- Modify: `src/server/http-error-response.ts`
- Create: `src/server/collection-http.ts`
- Create: `src/app/api/workspaces/[workspaceId]/collections/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/collections/[collectionId]/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/collections/[collectionId]/items/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/collections/[collectionId]/items/[itemId]/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/collections/[collectionId]/items/order/route.ts`
- Test: `tests/unit/knowledge-collection-http.test.ts`
- Test: `tests/integration/knowledge-collection-service.test.ts`

**Interfaces:**
- Composition exports `applicationServices().collections: KnowledgeCollectionService`.
- `collectionHttp(request:Request,work:(service:KnowledgeCollectionService,caller:CallerContext)=>Promise<unknown>,status?:number):Promise<Response>`; use `assertReviewOrigin(request)` on **every non-GET**, existing `establishTrustedCaller` and central error mapper. Reject non-object / over-limit JSON payloads; unknown fields rejected by service/domain validation. Set `Cache-Control:private, no-store` even on errors, no user content in logs.
- API per spec `7: GET/POST list, GET/PATCH collection, POST items, PATCH/DELETE item, PUT order; mutation JSON field names exactly `expectedVersion`, `name`, `description`, `status`, `documentId`, `readingNote`, `itemIds`.
- Extend `toWorkspaceErrorResponse` for the five Collection error codes from the global contract, without changing public `/s/:token` or legacy Workspace error behavior. Use 403 for discoverable-but-no-read Collection cases explicitly and generic 404 for foreign/out-of-scope IDs.

- [ ] **Step 1: Write failing HTTP tests** `GET requires caller and does not cache`, `POST rejects cross-origin and unauthorized Viewer`, `PATCH stale expectedVersion returns 409`, `PUT malformed order returns 400 and unchanged collection`, `unknown Collection returns non-enumerating 404`, `invalid cap returns 422`, `identity missing 401 vs unconfigured 503`, `DB failure remains 5xx rather than empty list`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/knowledge-collection-http.test.ts`; expected **FAIL** before handler/composition wiring.
- [ ] **Step 3: Wire service and route handlers**, with shared handler and explicit accepted HTTP methods, using `export const dynamic = "force-dynamic"` as existing request-bound routes do.
- [ ] **Step 4: Run the focused Vitest suite and `make verify`**; expected **PASS**.
- [ ] **Step 5: Commit** `git add src/server src/app/api/workspaces tests/unit/knowledge-collection-http.test.ts && git commit -m "feat: expose private collection APIs"`.

### Task 7: Collections navigation, list and read-only detail

**Files:**
- Modify: `src/components/shell/primary-nav.tsx`
- Create: `src/app/w/[workspaceId]/collections/page.tsx`
- Create: `src/app/w/[workspaceId]/collections/[collectionId]/page.tsx`
- Create: `src/components/knowledge/collection-list.tsx`
- Create: `src/components/knowledge/collection-detail.tsx`
- Test: `tests/unit/knowledge-collection-ui.test.tsx`

**Interfaces:**
- `PrimaryNav`: add Collections independently of Source/Tree navigation, only for Workspace read capability. Standard selected/focus states in narrow and wide navigation.
- List page: authorized Workspace route, active vs explicit archived filter, stable 50-row cursor pagination, Create affordance only if `access.actions.canWrite` and Workspace ACTIVE, helpful empty state. A newly created empty collection appears.
- Detail: name/description, ordered list, source captions and hyperlinks to existing `/w/:workspaceId/knowledge/:sourceId/:documentId` Reader when available, optional per-item note displayed as **React text** (never `dangerouslySetInnerHTML`/Markdown). Unavailable items use generic placeholder and have no target link, hidden note, revision, source path or title.
- Share link control is **absent**; copying a normal workspace URL grants nothing. Archived Collection read-only; archived Workspace mutations hidden/disabled; failures show usable retry and non-disclosing errors.

- [ ] **Step 1: Write failing component tests** `Viewer sees Collections nav but no Create`, `active list and archived filter display separately`, `preserves order and source captions`, `unavailable row hides title/note/link`, `displays html-looking note literally without DOM injection`, `small viewport has no horizontal overflow`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/knowledge-collection-ui.test.tsx`; expected **FAIL** for absent components.
- [ ] **Step 3: Build pages/components** using the existing Workspace shell read pattern, `applicationServices().collections`, list/detail domain views, `PrimaryNav` and existing UI primitives; implement Create/rename/description/archive/restore controls with expectedVersion and reload-on-409 where appropriate.
- [ ] **Step 4: Run focused tests and `make verify`**; expected **PASS**.
- [ ] **Step 5: Commit** `git add src/app/w src/components/shell/primary-nav.tsx src/components/knowledge/collection-* tests/unit/knowledge-collection-ui.test.tsx && git commit -m "feat: browse collections in workspace"`.

### Task 8: Picker, document action, annotation, and reordering

**Files:**
- Create: `src/components/knowledge/collection-picker-dialog.tsx`
- Create: `src/components/knowledge/collection-add-request.ts`
- Modify: `src/components/knowledge/collection-detail.tsx`
- Modify: `src/components/actions/action-registry.ts`
- Modify: `src/components/actions/action-icon.tsx`
- Modify: `src/components/actions/action-menu.tsx`
- Modify: the existing Knowledge layout that mounts document-scoped dialog hosts
- Modify: `src/server/composition.ts` only if the existing search service needs a typed picker adapter
- Test: `tests/unit/action-registry.test.ts`
- Test: `tests/unit/knowledge-collection-ui.test.tsx`

**Interfaces:**
- New registry `ActionId "document.add-to-collection"` with an appropriate mapped icon and `ActionCommand "document.open-add-to-collection"`. Trigger event `COLLECTION_ADD_REQUEST_EVENT = "kh:request-add-to-collection"` through `requestAddToCollection(documentId:string,sourceId:string):void`. Host mounted once on existing Knowledge layout, not per document row.
- Only show action for a **current, active, readable** document; adding `SOURCE_MANAGED` documents is allowed because Collection metadata is separate. Writers can pick only active collections in the same Workspace.
- Document picker uses **existing workspace-scoped keyword search** (`applicationServices().search.search` with scope `{kind:"workspace",workspaceId}`, `includeArchived:false`); show up to 20 candidate results/page and require a query rather than fetching all documents. Confirm selection via Collection API `addItem`, whose transaction revalidates every ID.
- Collection detail Editor controls: Add via picker, Edit reading note, Remove with confirmation, reorder drag-and-drop and keyboard Move up/down. Both input methods submit a **complete** item-ID permutation with `expectedVersion`; no per-index race or optimistic "success" before commit. On 409 reload current list and state explicitly, not silently overwrite. Disable duplicate mutations while pending; network errors leave saved order intact.
- Ensure every input is reachable from keyboard and disabled for Viewer/archived Workspace or Collection.

- [ ] **Step 1: Write failing unit/UI tests** `action registry shows Add only for eligible current active document`, `dialog lists only active same-Workspace collections`, `SOURCE_MANAGED documents remain eligible`, `picker filters bounded hits`, `keyboard reorder emits full item IDs`, `409 discards stale optimistic order and offers Reload`, `network error keeps previous persisted display`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/action-registry.test.ts tests/unit/knowledge-collection-ui.test.tsx`; expected **FAIL** for new action and interactions.
- [ ] **Step 3: Implement registry/dialog/detail interactions** using existing `useActionRunner`/action-model patterns and only already-approved Collection mutation endpoints. Never branch on user-supplied ownership or duplicate capabilities locally.
- [ ] **Step 4: Run focused tests and `make verify`**; expected **PASS**.
- [ ] **Step 5: Commit** `git add src/components/knowledge src/components/actions src/server/composition.ts tests/unit && git commit -m "feat: curate collections from document actions"`.

### Task 9: Two-person regression, bilingual guidance, and release verification

**Files:**
- Create: `tests/e2e/knowledge-collections.spec.ts`
- Modify: `src/components/help/user-guide-content.ts`
- Modify: guide unit tests used by the repository (find the current exact test filename before editing)
- Create: `docs/superpowers/verification/2026-10-15-knowledge-collections-verification.md` (execution evidence only; not created during planning)

**Interfaces:**
- E2E use existing `tests/e2e/fixtures/phase3-identities.ts` persona origins and isolated test DB. Use current My Space and opt-in Team fixtures, not an assumed per-tab login or production SSO. Unit/integration tests own internals; browser tests assert user-visible flows.
- New bilingual user guide section explains that Collections are Workspace reading paths rather than copied folders, how to add/reorder/annotate, why a document may say Unavailable, and why a collection URL does not grant access.
- Verification record contains exact commands, results, environment, migration version, screenshot path if captured, known limitations, and no unverified "tests pass" claims.

- [ ] **Step 1: Write failing Playwright cases** `owner builds a Collection with two different Sources and links to latest Reader`, `Team Editor edits another Editor's Collection while Viewer cannot`, `archived Source masks title and note and restore revives same ID`, `sync creates new ID without relinking`, `cross-Workspace direct route/API are denied`, `401/503 identity origins differ`, `mobile and keyboard reorder work`, `stale reorder yields retry feedback`.
- [ ] **Step 2: Run** `npm run test:e2e -- knowledge-collections.spec.ts` with required isolated E2E DB/browser setup; expected new tests **FAIL** before final UI/fixture fixes. If the runner syntax differs on current main, use the repository's documented equivalent, record command.
- [ ] **Step 3: Complete E2E fixture-compatible functionality and English/zh-TW help**; keep Team feature flag defaults unchanged and avoid production SSO assumptions.
- [ ] **Step 4: Run `make verify`, `make test-integration`, `npm run test:e2e -- knowledge-collections.spec.ts` and repository full E2E gate `make test-e2e`**. Record *actual* results; investigate any failure before making a completion claim. Independently inspect Reader URL access, Source/Revision row counts, live title changes and both mobile/desktop views.
- [ ] **Step 5: Commit** `git add tests/e2e/knowledge-collections.spec.ts src/components/help/user-guide-content.ts tests/unit docs/superpowers/verification && git commit -m "test: verify collection handoff and update guides"`.

---

## Spec Coverage / Review Checklist

| Spec requirement | Task(s) |
| --- | --- |
| Approved product choices, virtual-only metadata | 1, 2, 7, 8 |
| Flat order, item note, size/limits | 1, 2, 5, 7, 8 |
| Current revisions, multi-source same Workspace | 2, 3, 5, 9 |
| Workspace-based Viewer/Editor roles, lifecycle | 3, 4, 5, 6, 9 |
| Source/archive/restore and changed Document IDs | 2, 3, 5, 9 |
| Version/locking/conflict atomicity | 2, 4, 5, 6, 8, 9 |
| Non-disclosure, safe errors, private HTTP | 3, 6, 7, 9 |
| Separate navigation, doc menu, mobile/keyboard | 7, 8, 9 |
| Both languages, complete E2E | 9 |

**Self-review before coding:** Re-evaluate *current main* migration availability, route and fixture filenames, Knowledge/Source lock order, no accidental Source/Document mutations, DomainError status mapping, and exact exported types. Re-check all five Review Focus inputs against owning tests; if current code diverges from a cited interface, adjust this plan explicitly before implementation instead of silently choosing a different contract.

## Implementation Handoff Gate

This plan is **for review**, not permission to execute. After user approval, choose either `superpowers:subagent-driven-development` (fresh implementer + independent reviewer per task) or `superpowers:executing-plans` (native sequential execution + final independent review). Do not modify application code until the user confirms the plan and execution approach.
