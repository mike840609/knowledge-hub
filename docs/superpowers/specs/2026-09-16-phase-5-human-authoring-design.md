# Knowledge Hub — Phase 5 Human Authoring Design

| Item | Content |
| --- | --- |
| Date | 2026-09-16 |
| Document role | Phase 5 canonical design: Web creation/editing of HUB_MANAGED Knowledge and single Markdown uploads |
| Decision basis | Implemented Phase 1 Hub command paths, Phase 3 capability model, Phase 2 title resolution, and Phase 4 delivery conventions |
| Prerequisite | Phase 4 Discovery & Read API merged into `main` (commit `5ee5816`) |
| Project entry point | [README](../../../README.md) |

## 1. Decision Summary

Phase 5 is a **delivery-layer phase**, rather than a domain phase.

Of the four main deliverables listed in roadmap Phase 5, three already have their rules implemented and protected by tests in Phase 1. This phase wires them to HTTP and UI without rewriting them.

```text
The user presses Edit on the document page
→ existing createRevision(caller, { documentId, expectedCurrentRevisionId, title, markdown })
→ existing capability + HUB_MANAGED guard
→ existing immutable Revision write
```

**No new schema, migrations, domain rules, or ports.** The only additions are one Source provisioning rule, two HTTP routes, and one editing page.

## 2. Goals

- Users can create and edit HUB_MANAGED documents on the Web, with changes saved as immutable Revisions.
- Users can upload a single `.md`; title resolution behaves exactly as in folder import.
- When two people edit concurrently, the later submission receives a clear conflict message without overwriting the other person's content.
- SOURCE_MANAGED content has no editing entry point in the UI; direct API calls are also blocked.

## 3. Non-goals

- Markdown merge, three-way merge, and automatic conflict resolution: explicitly listed as out of scope in roadmap Phase 5.
- A metadata (frontmatter) editing interface: no established key conventions exist. As decided in Phase 4 spec §3, add it when real requirements emerge.
- Tree operation UI (create folder, rename, move, archive/restore): application methods already exist, but these are not roadmap Phase 5 deliverables.
- Manual creation and naming of multiple Hub Sources: see the upgrade path in §5.
- Ownership conversion (SOURCE_MANAGED ↔ HUB_MANAGED) and bidirectional sync: outside roadmap scope.
- Rich text editor, live preview, or autosave.

## 4. Existing Foundation Inventory

This section is the basis for this phase's scope decision; every row has been verified against the code.

| Roadmap deliverable | Existing implementation | Location |
| --- | --- | --- |
| Single Markdown upload | `parseGenericMarkdownText` (frontmatter + first H1) and `resolveImportTitle` (FRONTMATTER → H1 → FILENAME precedence) are both exported | `src/modules/sources/adapters/generic-markdown-folder-adapter.ts:86`, `src/modules/sources/domain/import-title.ts:6` |
| Web create/edit | `createDocument` and `createRevision`, each completed in a single READ COMMITTED transaction | `src/modules/knowledge/application/internal/create-document.ts:26`, `internal/create-revision.ts:32` |
| Changes create immutable Revisions | `fingerprintRevisionContent` → N+1 insert → `setCurrentRevision`; unchanged content returns `changed: false` and creates no new version | `internal/create-revision.ts:51-63` |
| Stale-editor conflict | A mismatch between `expectedCurrentRevisionId` and the locked current revision throws `RevisionConflictError` | `internal/create-revision.ts:50` |
| Check Workspace capability before HUB_MANAGED ownership | `lockWorkspaceForMutation(…, "content-write")` checks `document.write`; `source.ownership !== "HUB_MANAGED"` throws `SourceReadOnlyError` | `src/modules/workspaces/application/workspace-mutation-guard.ts:57`, `internal/create-revision.ts:43` |
| SOURCE_MANAGED read-only guard | All four Hub write paths have the same ACTIVE + HUB_MANAGED checks | `internal/create-document.ts:34-35` and others |
| My Space is writable | `assertPersonalMutationAllowed` directly permits `content-write`, freezing only governance operations | `src/modules/workspaces/application/personal-workspace-service.ts:38` |

Phase 5 therefore has only three actual gaps:

1. `src/app/api/` has **no knowledge write routes**.
2. `src/components/` has **no authoring components**.
3. **HUB_MANAGED Sources have no creation path**: the only callers of `repositories.sources.insert` are folder import apply (`apply-folder-import.ts:163`) and `scripts/db/seed.ts`. Users cannot create a Hub Source in the UI, so this phase must resolve where a new document goes.

## 5. Lazy Provisioning of the Default Hub Source

### 5.1 Rules

Each Workspace has a default Hub Source named `Notes`, created lazily **when the first document is created**:

```text
POST /api/workspaces/{id}/documents
→ ensureDefaultHubSource(caller, workspaceId)   ← transaction 1
→ createDocument(caller, { sourceId, parentId: null, title, markdown, metadata: {} })   ← transaction 2
```

`ensureDefaultHubSource`: lock the Workspace row → find a Source in that Workspace with `sourceType = "HUB"`, `status = "ACTIVE"`, and `name = "Notes"` → return its id if found; otherwise create one with `uuidv7()` and return it.

Module ownership: `src/modules/sources/application/ensure-default-hub-source.ts`, running on `SourceUnitOfWork`. `SourceRepositories` is already `KnowledgeRepositories & { sources, workspaces, workspaceMemberships, groupMappings, … }` (`src/modules/sources/ports/unit-of-work.ts:16`), providing all repositories needed by `sources.insert` and `lockWorkspaceForMutation`; **no port changes are needed**. Source creation stays in the sources module; the knowledge module does not acquire Source creation capabilities.

### 5.2 Why a Separate Transaction

The current global lock order is `Snapshot → Source → Workspace → deeper` (`workspace-mutation-guard.ts:22`). Creating a new Source has no Source to lock, requiring Workspace to be locked first instead.

With a separate transaction, provisioning holds only a Workspace lock, while `createDocument` still locks Source before Workspace. They do not hold both locks simultaneously, so no deadlock cycle arises, and the four existing write paths need no changes. The cost is two round trips and an empty Source if Source creation succeeds but document creation fails. An empty `Notes` Source has no side effects and is reused on the next creation; no compensating transaction is required.

### 5.3 Concurrency

When two requests concurrently create the first document in the same Workspace, the Workspace row lock in `lockWorkspaceForMutation` serializes them: the first creates `Notes`; after acquiring the lock, the second reads and reuses it. This does not rely on a unique key, because `knowledge_sources` has no `(workspace_id, name)` unique constraint and this phase does not add one.

### 5.4 Authorization Verb

Provisioning uses `"content-write"` (requiring `document.write`), rather than `"source-import"` (requiring `source.manage`). The user's action is authoring a document; Source creation is incidental, so authorization should align with that actual intent. In the current role model, EDITOR and above have both capabilities, making the distinction currently unobservable; documenting it prevents mistakes if roles are split later.

### 5.5 Upgrade Path

When multiple Hub Sources are needed for categorization, add a “New Hub source” creation flow on the Sources page, symmetrical to “Import folder”; `ensureDefaultHubSource` then becomes the default when no Hub Source exists. This phase does not prebuild that path.

## 6. HTTP Delivery Surface

### 6.1 Two Routes

Reuse `workspaceHttp` + `requestFields` (`src/server/workspace-http.ts`):

| Route | body | Behavior |
| --- | --- | --- |
| `POST /api/workspaces/[workspaceId]/documents` | `{ title, markdown }` | `ensureDefaultHubSource` → `createDocument`, returning `{ documentId, sourceId }` |
| `POST /api/workspaces/[workspaceId]/documents` | `{ filename, markdown }` | Single upload: `parseGenericMarkdownText` + `resolveImportTitle` resolve the title; the rest is as above |
| `PATCH /api/documents/[documentId]` | `{ title, markdown, expectedCurrentRevisionId }` | `createRevision`, returning `{ revisionId, revisionNo, changed }` |

### 6.2 No Separate Upload Route

The browser reads a string through `<input type="file" accept=".md,.markdown">` and sends it to the same JSON route. `filename` invokes title resolution; `title` is used directly. No multipart input or parser dependency is added.

`title` and `filename` are mutually exclusive: providing both or neither returns `INVALID_REQUEST`.

For uploads with `filename`, storage behaves exactly as folder import (`finalize-folder-import.ts:181,192-193`): the body parsed by `parseGenericMarkdownText` (with frontmatter removed) is stored as `markdown`, and parsed frontmatter as `metadata`, rather than storing the raw file unchanged. The same `.md` file must produce identical storage results through import or upload. The explicit `title` path (without `filename`) has no file from which to parse frontmatter and keeps the existing behavior: `markdown` is the caller's original text and `metadata` is `{}`.

### 6.3 No Changes to requestFields

All four fields (`title`/`filename`/`markdown`/`expectedCurrentRevisionId`) are strings, so the current string-only limitation of `requestFields` is no obstacle. `metadata` is not editable (§3) and is passed as `{}`; existing document metadata is **preserved unchanged** on edits: the `createRevision` caller reads the current revision's metadata and passes it back unchanged, preventing an edit from clearing frontmatter brought in through folder import.

“Passed as `{}`” here refers to the **editing** (`PATCH`) path: metadata is not user-editable, so the editing form has no metadata input and no new value to submit. This does not apply to **upload creation** (§6.2): when uploading a `.md` with frontmatter, metadata comes from parsing, rather than `{}`. “Not editable” does not mean discarding frontmatter during upload.

### 6.4 Limits

`title`: 512 characters; `markdown`: 5 MiB, matching the default `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES`. Exceeding these limits returns `INVALID_REQUEST`.

## 7. Authorization and Error Mapping

### 7.1 Authorization

Fully reuse existing authorization without adding concepts. All writes go through `lockWorkspaceForMutation(…, "content-write")` → `document.write`, which VIEWER lacks. IDs in routes and bodies are navigation scope, not proof of authorization.

### 7.2 Error Mapping Must Be Extended

`toWorkspaceErrorResponse` (`src/server/http-error-response.ts:61`) currently selects status codes from three code lists; **all unlisted DomainErrors become 500**. Neither of Phase 5's two key errors is listed, so simply reusing the existing mapping is insufficient:

| code | Current behavior | Phase requirement |
| --- | --- | --- |
| `REVISION_CONFLICT` | 500 | **409** — a stale-editor conflict is a user-correctable condition, not a server error |
| `SOURCE_MANAGED_READ_ONLY` | 500 | **409** — writing to SOURCE_MANAGED content |
| `INVALID_TITLE`／`INVALID_METADATA` | 500 | **400** |
| `DOCUMENT_NOT_FOUND` / `SOURCE_NOT_FOUND` | 500 | **404** (non-enumeration semantics, consistent with existing `HIDDEN_NOT_FOUND`) |
| `SOURCE_ARCHIVED`／`DOCUMENT_ARCHIVED` | 500 | **409** |
| `WORKSPACE_ACCESS_DENIED` | 404 | Keep 404 — reuse the existing non-enumeration convention; the UI already hides editing entry points from VIEWER |

## 8. UI

### 8.1 actions

Add `canWrite: has("document.write")` to `WorkspaceActions`, following the `canSearch` pattern (`src/server/workspace-admin.ts:46`). Navigation/button visibility is not a security boundary; the server authorizes independently (the same principle as Phase 4 spec §7.4).

### 8.2 Editing Page

New page `/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit`, component `src/components/knowledge/document-editor.tsx`:

- Title uses existing `ui/input.tsx`; markdown uses existing `ui/textarea.tsx`; **no editor dependency is introduced**.
- The form holds `expectedCurrentRevisionId` from the time of loading.
- Save → `PATCH`; on success, navigate back to the document page and call `router.refresh()`; Cancel → navigate back directly.
- `changed: false` (unchanged content) is not an error; it behaves like success.

### 8.3 Entry Points

- The document page already loads both `explorer` (`SourceView` includes `ownership`) and `shell` (includes `access.actions`), as shown in `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx:77-78`; the Edit button therefore needs no new read model.
- Display condition: `canWrite && source.ownership === "HUB_MANAGED" && status === "ACTIVE"` and not viewing a historical version.
- `DocumentHeader` currently hardcodes `<Badge variant="outline">Read only</Badge>` (`document-header.tsx:72`); change it to render by ownership: SOURCE_MANAGED keeps Read only; HUB_MANAGED hides that badge and displays Edit.
- Add `New document` and `Upload .md` to the Knowledge page, reusing the Sources page's `Import folder` button styling and `kh-*` tokens.

### 8.4 Conflict Presentation

409 `REVISION_CONFLICT` displays “This document has been updated by someone else,” with a “Reload the latest version” link. **No automatic overwrite, automatic merge, or server-side retention of the user's draft**; input stays in the form for the user to decide what to keep.

## 9. Test Plan

### 9.1 Unit Tests (No DB Required)

| # | Requirement source | Test |
| --- | --- | --- |
| U1 | §8.1 | `deriveWorkspaceActions`: `canWrite` is true with `document.write`, false for VIEWER |
| U2 | §6.1、§6.2 | Body validation: missing fields, non-strings, both `title` and `filename`, or neither |
| U3 | §6.2 | `filename` branch: frontmatter title takes precedence over H1; if both are absent, use the filename without its extension |
| U4 | §7.2 | `toWorkspaceErrorResponse`：`REVISION_CONFLICT` → 409、`SOURCE_MANAGED_READ_ONLY` → 409、`INVALID_TITLE` → 400、`DOCUMENT_NOT_FOUND` → 404 |
| U5 | §6.4 | Limits: `title` over 512 or `markdown` over 5 MiB returns `INVALID_REQUEST` |

### 9.2 Integration Tests (DB Required)

| # | Requirement source | Test |
| --- | --- | --- |
| I1 | §5.1 | Create the first document in an empty Workspace: automatically create a `Notes` Source, with the document under its root |
| I2 | §5.3 | `ensureDefaultHubSource` is idempotent: two consecutive calls return the same sourceId, adding only one row to `knowledge_sources` |
| I3 | §4 | Creation produces revision 1; editing produces revision 2, leaving revision 1 content unchanged |
| I4 | §4 | **Unchanged content creates no version**: resubmit the same title/markdown; `changed: false` and version count unchanged |
| I5 | §4 | Stale `expectedCurrentRevisionId` → `REVISION_CONFLICT`, without overwriting the document's current revision |
| I6 | §7.1 | VIEWER creation and editing are both denied |
| I7 | §4 | Editing SOURCE_MANAGED documents is denied (`SOURCE_MANAGED_READ_ONLY`) |
| I8 | §6.3 | Metadata preservation: after editing a document with frontmatter metadata, the new revision's metadata equals the old revision's |
| I9 | §5.4 | My Space (PERSONAL workspace) allows creation and editing |
| I10 | §6.2 | Single upload: frontmatter title, H1, and filename each produce the expected title |

### 9.3 E2E（Playwright）

| # | Test |
| --- | --- |
| E1 | Create a new document in a Workspace → appears in the Tree → opens with correct content |
| E2 | Edit an existing HUB_MANAGED document → version history shows two versions |
| E3 | SOURCE_MANAGED document pages hide Edit and display Read only |
| E4 | Upload a `.md` → title comes from frontmatter |

### 9.4 Fixture

Reuse the seed's existing HUB_MANAGED and SOURCE_MANAGED Sources. E2E needs a **Workspace with no Hub Source at all** to cover I1's lazy provisioning path. Following the lesson recorded in Phase 4 verification, add the new fixture **after** the existing empty-table check for a brand-new database in `seedBrowserFixtures`, writing it in a separate `unitOfWork.run` block.

## 10. Acceptance Criteria

- Creation and editing produce immutable Revisions; unchanged content creates no new version (I3, I4).
- With concurrent editing, the later submission gets 409 without overwriting the other person's content (I5).
- VIEWER and SOURCE_MANAGED writes are always denied, and the UI has no entry point (I6, I7, E3).
- Existing metadata is not lost on editing (I8).
- Single-upload title resolution matches folder import (I10, E4).
- All §9 test cases pass; all three gates, `make verify`, `npm run test:integration`, and `npm run test:e2e`, are green.
