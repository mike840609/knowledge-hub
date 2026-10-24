# Draft Recovery and Personal Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make archived-document drafts recoverable, stop reporting transient read failures as “not found”, align draft/publish size limits, and stop favorites sync from downloading every draft body.

**Architecture:** Home receives document summaries including archived documents, so `homeLists()` can list an archived draft with its lifecycle and link to a read-only recovery route. The recovery route reads the draft plus its document/source state, and offers restore, download, and copy. Document reads return `null` only for known not-found/access outcomes; other errors reach a route-level Retry boundary. A shared UTF-8 byte limit governs drafts and publishing. A favorites-only personal query returns identifiers only; the shortcuts hook shares one in-flight request and one focus subscription per workspace.

**Tech Stack:** Next.js 15 App Router, React server/client components, MariaDB, Vitest (`renderToStaticMarkup`, jsdom), Playwright.

**Target:** `/Users/chuntsai/Projects/km-wt-2` on `main` (`cfe7dd01`). Do not apply Tasks 2–4 unchanged to the HCM-KM `feat/sidebar-adjust` branch: there the draft is visible and `/edit` is the dead link, while here Home hides it and `/edit` redirects.

**Spec:** `/Users/chuntsai/Projects/HCM-KM/work/system-review-2026-10-23/findings.md` (the source review; item 1 is adapted to `main`, where archived drafts are currently hidden rather than dead-linked). UI contract: `docs/superpowers/specs/frontend-design-language.md`.

## Global Constraints

- Read `docs/superpowers/specs/frontend-design-language.md` before touching `src/components` or `src/app`.
- Tailwind’s default scales are replaced. Use `text-body`, `text-caption`, `text-body-sm`, `rounded-md`, `shadow-popover`; never `text-sm`, `text-xs`, `rounded`, `shadow-sm`.
- No new colour tokens. Use `text-kh-danger` for a hard failure, `text-kh-warning` for approaching a limit, and existing `kh-*` tokens otherwise.
- UI copy is English. The recovery page’s copy is about the draft and the original document, not internal terms such as “lifecycle” or “personal item”.
- Module boundaries are enforced by ESLint: `src/modules/**` may not import Next/React/MariaDB; `src/components/**` and `src/app/**` may not import `infrastructure/`.
- Knowing an ID is not authorization. Every new server read/write re-checks workspace/source access; the recovery page must not trust the route IDs.
- Lifecycle is `ACTIVE` / `ARCHIVED`; there is no hard delete. Do not add a delete path.
- Keep `data-list-row` and `onKeyDown={navigateListRows}` on every Home row list.
- Use `npx` for test commands (the shell shadows `npm`). Do not pipe a test command; piping hides its exit code.
- Run `make verify` before declaring the work complete. E2E and integration are separate, DB-backed gates.
- Commit after each task. Do not commit `.next`, test artifacts, or a `.env` file.

## Review Focus

These are the inputs/conditions most likely to break the implementation; each has a test in the task named:

1. **Archived document vs archived source vs missing document.** A draft must stay visible with the right explanation, must not link to an editor that refuses it, and must not be offered a restore that the server will reject. → Task 2, Task 3.
2. **Transient read failure vs not-found vs access denied.** Only the latter two may become “Not found or no access”; infrastructure failures must reach the Retry boundary without leaking existence. → Task 1.
3. **5 MiB UTF-8 boundary with CJK/emoji, and an already-oversized draft.** Draft save and publish must agree; an oversized draft must be readable, downloadable, and terminal rather than retrying forever. → Task 5.
4. **Favorites with archived/deleted documents, and multiple hook instances.** A favorite for a deleted document is dropped; archived documents still resolve a `sourceId`; one focus event produces one request after Task 7. → Task 6, Task 7.
5. **Restore permission and source ownership.** A reader without `document.write`, or a source that is archived or not `HUB_MANAGED`, must not see a Restore action that can only fail silently. → Task 3, Task 4.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/server/knowledge-read.ts` | modify | Narrow `getKnowledgeDocumentModel`’s catch to hidden-read errors only. |
| `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/error.tsx` | create | Document-specific “could not be loaded” + Retry. |
| `tests/unit/knowledge-document-model.test.ts` | modify | Transient/access/integrity cases. |
| `tests/unit/document-error-boundary.test.tsx` | create | Retry copy is present. |
| `src/app/w/[workspaceId]/home/page.tsx` | modify | Load all document summaries; use active only for onboarding/recents. |
| `src/lib/home-continue.ts` | modify | Drafts may reference archived documents; Recents stay active. |
| `src/components/knowledge/personal-home.tsx` | modify | Draft href and provenance for archived document/source. |
| `tests/unit/home-continue.test.ts` | modify | Archived draft is listed; Recent excludes it. |
| `tests/unit/personal-home-folder-sync.test.tsx` | modify | Recovery link, not `/edit`; active drafts link to the document page. |
| `src/server/draft-read.ts` | create | `getDraftRecoveryModel()`: draft, document, source, capabilities. |
| `src/app/w/[workspaceId]/knowledge/drafts/[sourceId]/[documentId]/page.tsx` | create | Read-only draft preview and recovery actions. |
| `src/components/knowledge/draft-recovery-actions.tsx` | create | Restore, download, copy. |
| `src/lib/download-markdown.ts` | create | One download implementation; reuse in the editor. |
| `tests/unit/draft-read.test.ts` | create | Archived/source-archived/no-write/missing cases. |
| `tests/unit/draft-recovery-page.test.tsx` | create | Redirect active, render archived, 404 missing. |
| `tests/unit/draft-recovery-actions.test.tsx` | create | Restore/download/copy and permission gating. |
| `tests/unit/download-markdown.test.ts` | create | Blob download, filename sanitation. |
| `src/lib/markdown-limits.ts` | create | Shared `5 MiB` byte limit and helpers. |
| `src/server/authoring-input.ts` | modify | Use the shared byte limit for publish. |
| `src/server/http-error-response.ts` | modify | Map `DRAFT_TOO_LARGE` to 400. |
| `src/modules/personal/application/personal-service.ts` | modify | Reject oversized drafts with `DRAFT_TOO_LARGE`. |
| `src/lib/persistent-draft.ts` | modify | Terminal `too-large` state; allow recovery by shrinking. |
| `src/components/knowledge/document-composer.tsx` | modify | Size hint, too-large copy, download action. |
| `src/components/knowledge/draft-size-hint.tsx` | create | Presentational size/limit hint. |
| `tests/unit/markdown-limits.test.ts` | create | Byte boundaries and CJK. |
| `tests/unit/personal-draft-limits.test.ts` | create | Draft API agrees with publish. |
| `tests/unit/persistent-draft.test.ts` | modify | Too-large is terminal, then recoverable after shrinking. |
| `tests/unit/draft-size-hint.test.tsx` | create | 80% and over-limit copy. |
| `tests/unit/phase5-authoring-input.test.ts` | modify | CJK publish boundary. |
| `tests/unit/phase5-error-mapping.test.ts` | modify | `DRAFT_TOO_LARGE` is 400. |
| `src/modules/personal/ports/personal-store.ts` | modify | Add `listFavorites`. |
| `src/infrastructure/database/mariadb/repositories/personal-items.ts` | modify | Favorite-only SQL; no draft payloads. |
| `src/app/api/workspaces/[workspaceId]/personal/route.ts` | modify | `?view=favorites`. |
| `src/components/knowledge/use-document-shortcuts.ts` | modify | Request the favorites view; share one in-flight request and focus subscription per workspace. |
| `tests/unit/personal-favorites.test.ts` | create | Favorites-only service behavior. |
| `tests/unit/personal-items-repository.test.ts` | create | SQL is favorite-only. |
| `tests/unit/document-shortcuts-hook.test.tsx` | modify | Favorites URL; two consumers, one request/focus. |
| `tests/unit/personal-preferences.test.ts` | modify | Fake store gains `listFavorites`. |
| `tests/e2e/draft-recovery.spec.ts` | create | Cross-tab archive → Home → recovery → restore. |

---

### Task 1: Make document read failures truthful

**Files:**
- Modify: `src/server/knowledge-read.ts`
- Create: `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/error.tsx`
- Test: `tests/unit/knowledge-document-model.test.ts`
- Test: `tests/unit/document-error-boundary.test.tsx`

**Interfaces:**
- Consumes: `getKnowledgeDocumentModel(workspaceId, sourceId, documentId, input?)` keeps its signature and `KnowledgeDocumentModel | null` return type.
- Produces: the same function now returns `null` only for `NotFoundError`/`WorkspaceAccessDeniedError`/`WorkspaceNotFoundError`; every other error is rethrown.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/knowledge-document-model.test.ts`:

```ts
import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";

it("rethrows a transient read failure instead of calling it not found", async () => {
  const failure = new Error("connect ETIMEDOUT");
  fakeServices({ getDocument: async () => { throw failure; } });
  await expect(getKnowledgeDocumentModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID)).rejects.toBe(failure);
});

it("still returns null when the caller may not see the document", async () => {
  fakeServices({ getDocument: async () => { throw new WorkspaceAccessDeniedError(); } });
  await expect(getKnowledgeDocumentModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID)).resolves.toBeNull();
});

it("rethrows an integrity failure instead of showing not found", async () => {
  fakeServices({ getDocument: async () => { throw new IntegrityViolationError("current revision missing"); } });
  await expect(getKnowledgeDocumentModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID)).rejects.toThrow("current revision missing");
});
```

Create `tests/unit/document-error-boundary.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import DocumentReadError from "@/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/error";

it("offers a retry without leaving the document address", () => {
  const html = renderToStaticMarkup(<DocumentReadError error={new Error("offline")} reset={() => {}} />);
  expect(html).toContain("This document could not be loaded");
  expect(html).toContain("Retry");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/knowledge-document-model.test.ts tests/unit/document-error-boundary.test.tsx`

Expected: FAIL — the transient and integrity cases currently resolve to `null`, and the error component does not exist.

- [ ] **Step 3: Implement the narrow catch and the document error boundary**

In `src/server/knowledge-read.ts`, import:

```ts
import { NotFoundError } from "@/modules/knowledge/domain/errors";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
```

Replace the final `catch` in `getKnowledgeDocumentModel` with:

```ts
} catch (error) {
  // A missing document and a hidden document are the same answer to the reader.
  // Everything else (a dropped connection, a broken revision pointer) must reach
  // the route error boundary so the reader is offered Retry, not a false 404.
  if (error instanceof NotFoundError || error instanceof WorkspaceAccessDeniedError || error instanceof WorkspaceNotFoundError) return null;
  throw error;
}
```

Create `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/error.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

export default function DocumentReadError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusMessage
      title="This document could not be loaded"
      description="A temporary problem interrupted the read. Your place in the workspace is unchanged; try again."
      action={<Button variant="secondary" size="lg" onClick={() => reset()}>Retry</Button>}
    />
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/knowledge-document-model.test.ts tests/unit/document-error-boundary.test.tsx`

Expected: PASS. Also run the existing knowledge read tests that import this model, e.g. `tests/unit/inline-document-access.test.tsx` and `tests/unit/knowledge-page-empty-state.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/server/knowledge-read.ts 'src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/error.tsx' tests/unit/knowledge-document-model.test.ts tests/unit/document-error-boundary.test.tsx
git commit -m "fix(knowledge): retry transient document reads instead of reporting not found"
```

---

### Task 2: List archived-document drafts on Home

**Files:**
- Modify: `src/app/w/[workspaceId]/home/page.tsx`
- Modify: `src/lib/home-continue.ts`
- Modify: `src/components/knowledge/personal-home.tsx`
- Test: `tests/unit/home-continue.test.ts`
- Test: `tests/unit/personal-home-folder-sync.test.tsx`

**Interfaces:**
- Consumes: `homeLists({ documents, drafts, recent, openedAt })` keeps its signature.
- Produces: `DraftItem.doc` may now have `status: "ARCHIVED"` or `sourceStatus: "ARCHIVED"`; `recent` still contains only active documents.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/home-continue.test.ts`, replace the test that currently asserts archived drafts are excluded with:

```ts
it("lists a draft for an archived document, but keeps it out of Recent", () => {
  const documents = [doc("a", { status: "ARCHIVED" }), doc("b", { sourceStatus: "ARCHIVED" })];
  const lists = homeLists({
    documents,
    drafts: [draft("draft:a", "2026-10-02T00:00:00.000Z"), draft("draft:b", "2026-10-01T00:00:00.000Z")],
    recent: ["src:a", "src:b"],
    openedAt: { "src:a": "2026-10-03T00:00:00.000Z", "src:b": "2026-10-03T00:00:00.000Z" },
  });
  expect(lists.drafts.map(item => item.id)).toEqual(["a", "b"]);
  expect(lists.drafts[0].doc?.status).toBe("ARCHIVED");
  expect(lists.drafts[1].doc?.sourceStatus).toBe("ARCHIVED");
  expect(lists.recent).toEqual([]);
});
```

Keep the existing test “excludes a draft or recent whose document is not in the workspace” unchanged; orphan drafts remain out of scope.

In `tests/unit/personal-home-folder-sync.test.tsx`, change the active draft expectation from `/edit` to the document page:

```tsx
expect(drafts).toContain('href="/w/ws/knowledge/src/a"');
```

Add:

```tsx
it("links an archived document's draft to recovery, not the editor", () => {
  const html = renderToStaticMarkup(
    <PersonalHome
      workspaceId="ws"
      documents={[doc("a", { status: "ARCHIVED" })]}
      drafts={[{ key: "draft:a", title: "Doc a", sourceId: "src", updatedAt: "2026-10-02T00:00:00.000Z" }]}
    />,
  );
  const drafts = html.slice(html.indexOf('aria-label="Drafts"'), html.indexOf('aria-label="Recent"'));
  expect(drafts).toContain('href="/w/ws/knowledge/drafts/src/a"');
  expect(drafts).toContain("Original document archived");
  expect(drafts).not.toContain("/edit");
});

it("still offers the getting-started guide when every document is archived", () => {
  const html = renderToStaticMarkup(
    <PersonalHome workspaceId="ws" documents={[doc("a", { status: "ARCHIVED" })]} drafts={[]} guidanceDismissed />,
  );
  expect(html).toContain("Show getting started guide");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/home-continue.test.ts tests/unit/personal-home-folder-sync.test.tsx`

Expected: FAIL — `homeLists()` still excludes archived documents and the component still links drafts to `/edit`.

- [ ] **Step 3: Implement the Home data and row behavior**

In `src/app/w/[workspaceId]/home/page.tsx` (keep the existing `folderModel`/`folderIds` lines above this block):

```ts
const allDocuments = (await s.queries.listDocumentSummaries(caller, workspaceId, { includeArchived: true }))
  .map(doc => ({ ...doc, updatedAt: doc.updatedAt.toISOString() }));
const activeDocuments = allDocuments.filter(doc => doc.status === "ACTIVE" && doc.sourceStatus === "ACTIVE");
const firstReadableDocument = activeDocuments.find(doc => folderIds.has(doc.sourceId)) ?? activeDocuments[0];
```

Use `activeDocuments.length > 0` in the onboarding condition, and `activeDocuments` for `locations` (archived drafts do not need a source path). Pass `allDocuments` to `PersonalHome`:

```tsx
documents={allDocuments.map(d => ({ ...d, sourceName: sourceNames.get(d.sourceId), sourcePath: paths.get(d.documentId) }))}
```

In `src/lib/home-continue.ts`, keep the `active` map for `recent`/`byShortcut`, and add an `all` map for drafts:

```ts
const all = new Map(documents.map(d => [d.documentId, d]));
// ...
const doc = all.get(draft.key.slice("draft:".length));
if (doc) draftItems.push({ id: doc.documentId, at: draft.updatedAt, draft, doc });
```

Update the doc comment: drafts are listed whole, including those whose document or source is archived; Recents/Favorites remain active-only.

In `src/components/knowledge/personal-home.tsx`, replace `draftRow`’s href and provenance:

```ts
function draftHref(item: DraftItem): string {
  if (!item.doc) return `/w/${workspaceId}/knowledge/new`;
  if (item.doc.status === "ACTIVE" && item.doc.sourceStatus === "ACTIVE") {
    return `/w/${workspaceId}/knowledge/${item.doc.sourceId}/${item.doc.documentId}`;
  }
  return `/w/${workspaceId}/knowledge/drafts/${item.doc.sourceId}/${item.doc.documentId}`;
}

function draftProvenance(item: DraftItem): string {
  if (!item.doc) return "Draft · Continue writing";
  if (item.doc.sourceStatus === "ARCHIVED") return "Draft · Source archived";
  if (item.doc.status === "ARCHIVED") return "Draft · Original document archived";
  return "Draft · Continue writing";
}
```

Use `href={draftHref(item)}` and `provenance={draftProvenance(item)}` in `draftRow`.

Also replace the empty-state condition `documents.length === 0 && dismissed` with an active-document count:

```ts
const activeDocumentCount = documents.filter(doc => doc.status === "ACTIVE" && doc.sourceStatus === "ACTIVE").length;
// ...
{activeDocumentCount === 0 && dismissed ? <ReopenGuidanceMenuItem ... /> : null}
```

This keeps the getting-started guide available when the library contains only archived documents.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/home-continue.test.ts tests/unit/personal-home-folder-sync.test.tsx`

Expected: PASS. Then run the other Home tests that render `PersonalHome` to catch copy/layout regressions.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/w/[workspaceId]/home/page.tsx' src/lib/home-continue.ts src/components/knowledge/personal-home.tsx tests/unit/home-continue.test.ts tests/unit/personal-home-folder-sync.test.tsx
git commit -m "feat(home): keep archived drafts visible with their lifecycle"
```

---

### Task 3: Read the draft recovery model

**Files:**
- Create: `src/server/draft-read.ts`
- Test: `tests/unit/draft-read.test.ts`

**Interfaces:**
- Produces:

```ts
export type DraftRecoveryModel = {
  draft: { key: string; title: string; markdown: string; updatedAt: string };
  document: {
    documentId: string;
    sourceId: string;
    status: "ACTIVE" | "ARCHIVED";
    sourceStatus: "ACTIVE" | "ARCHIVED";
    ownership: "HUB_MANAGED" | "SOURCE_MANAGED";
    title: string;
  };
  canRestore: boolean;
  canWrite: boolean;
  sourceArchived: boolean;
  workspaceArchived: boolean;
};

export async function getDraftRecoveryModel(
  workspaceId: string,
  sourceId: string,
  documentId: string,
): Promise<DraftRecoveryModel | null>;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/draft-read.test.ts` with a fake service shape matching the existing read-model tests:

```ts
const DRAFT = { key: `draft:${DOCUMENT_ID}`, value: { title: "Draft", markdown: "# Unsaved body", baseRevisionId: null }, version: 2, updatedAt: "2026-10-24T00:00:00.000Z" };

it("returns the draft and a restoreable archived document", async () => {
  const model = await getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
  expect(model).toMatchObject({
    draft: { title: "Draft", markdown: "# Unsaved body" },
    document: { status: "ARCHIVED", sourceStatus: "ACTIVE", ownership: "HUB_MANAGED" },
    canRestore: true,
    sourceArchived: false,
  });
});

it("does not offer restore when the source is archived", async () => {
  const model = await getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
  expect(model).toMatchObject({ canRestore: false, sourceArchived: true });
});

it("does not offer restore without document.write", async () => {
  const model = await getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
  expect(model?.canRestore).toBe(false);
});

it("does not offer restore for a source-managed document", async () => {
  const model = await getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
  expect(model?.canRestore).toBe(false);
});

it("returns null when the route source does not match the document", async () => {
  await expect(getDraftRecoveryModel(WORKSPACE_ID, "another-source", DOCUMENT_ID)).resolves.toBeNull();
});

it("returns null when the draft is gone", async () => {
  await expect(getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID)).resolves.toBeNull();
});

it("rethrows a transient read failure", async () => {
  await expect(getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID)).rejects.toThrow("connect ETIMEDOUT");
});
```

Mock `applicationServices` and `getWorkspaceShellModel`; make each test override `personal.get`, `queries.getDocument`, `queries.getSource`, and the shell’s `access.actions.canWrite`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/draft-read.test.ts`

Expected: FAIL — `@/server/draft-read` does not exist.

- [ ] **Step 3: Implement `getDraftRecoveryModel`**

Create `src/server/draft-read.ts`:

```ts
import { applicationServices } from "./composition";
import { getWorkspaceShellModel } from "./knowledge-read";
import { NotFoundError } from "@/modules/knowledge/domain/errors";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";

export type DraftRecoveryModel = { /* the type above */ };

export async function getDraftRecoveryModel(workspaceId: string, sourceId: string, documentId: string): Promise<DraftRecoveryModel | null> {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  try {
    const item = await services.personal.get(caller, workspaceId, `draft:${documentId}`);
    const value = item.value;
    const title = value?.title;
    const markdown = value?.markdown;
    if (typeof title !== "string" || typeof markdown !== "string") return null;

    const document = await services.queries.getDocument(caller, documentId, { includeArchived: true });
    if (document.workspaceId !== workspaceId || document.sourceId !== sourceId) return null;
    const source = await services.queries.getSource(caller, sourceId, { includeArchived: true });
    const shell = await getWorkspaceShellModel(workspaceId);
    if (!shell) return null;

    const canWrite = shell.access.actions.canWrite;
    const workspaceArchived = shell.access.workspace.lifecycleState === "ARCHIVED";
    const canRestore = canWrite && !workspaceArchived && document.status === "ARCHIVED" && source.status === "ACTIVE" && source.ownership === "HUB_MANAGED";

    return {
      draft: { key: item.key, title, markdown, updatedAt: item.updatedAt },
      document: {
        documentId: document.documentId,
        sourceId: document.sourceId,
        status: document.status,
        sourceStatus: source.status,
        ownership: source.ownership,
        title: document.currentRevision.title,
      },
      canRestore,
      canWrite,
      sourceArchived: source.status === "ARCHIVED",
      workspaceArchived,
    };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof WorkspaceAccessDeniedError || error instanceof WorkspaceNotFoundError) return null;
    throw error;
  }
}
```

Do not add a hard-delete/orphan recovery path here. A missing document stays `null`, matching the current Home behavior.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/draft-read.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/draft-read.ts tests/unit/draft-read.test.ts
git commit -m "feat(personal): read a draft with its document and source lifecycle"
```

---

### Task 4: Render the draft recovery page and actions

**Files:**
- Create: `src/app/w/[workspaceId]/knowledge/drafts/[sourceId]/[documentId]/page.tsx`
- Create: `src/components/knowledge/draft-recovery-actions.tsx`
- Create: `src/lib/download-markdown.ts`
- Modify: `src/components/knowledge/editable-document.tsx` (use the shared download helper)
- Test: `tests/unit/draft-recovery-page.test.tsx`
- Test: `tests/unit/draft-recovery-actions.test.tsx`
- Test: `tests/unit/download-markdown.test.ts`

**Interfaces:**
- Consumes: `getDraftRecoveryModel()` from Task 3.
- Produces: `DraftRecoveryActions({ workspaceId, sourceId, documentId, title, markdown, canRestore })`.
- Produces: `downloadMarkdown(title, markdown): void`.

- [ ] **Step 1: Write the failing page test**

Create `tests/unit/draft-recovery-page.test.tsx`:

```tsx
const mocks = vi.hoisted(() => ({ model: vi.fn(), redirect: vi.fn() }));
vi.mock("@/server/draft-read", () => ({ getDraftRecoveryModel: mocks.model }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, redirect: mocks.redirect }));
vi.mock("@/components/knowledge/draft-recovery-actions", () => ({
  DraftRecoveryActions: ({ canRestore }: { canRestore: boolean }) => <span data-can-restore={String(canRestore)} />,
}));
vi.mock("@/components/knowledge/markdown-article", () => ({
  MarkdownArticle: ({ markdown }: { markdown: string }) => <article>{markdown}</article>,
}));

it("renders an archived draft with its recovery actions", async () => {
  mocks.model.mockResolvedValue({
    draft: { key: "draft:doc", title: "Draft", markdown: "# Unsaved body", updatedAt: "2026-10-24T00:00:00.000Z" },
    document: { documentId: "doc", sourceId: "src", status: "ARCHIVED", sourceStatus: "ACTIVE", ownership: "HUB_MANAGED", title: "Draft" },
    canRestore: true, canWrite: true, sourceArchived: false, workspaceArchived: false,
  });
  const result = await DraftRecoveryPage({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) });
  const html = renderToStaticMarkup(result as ReactElement);
  expect(html).toContain("Draft");
  expect(html).toContain("# Unsaved body");
  expect(html).toContain('data-can-restore="true"');
});

it("sends an active draft back to the document page", async () => {
  mocks.model.mockResolvedValue({
    draft: { key: "draft:doc", title: "Draft", markdown: "# Body", updatedAt: "2026-10-24T00:00:00.000Z" },
    document: { documentId: "doc", sourceId: "src", status: "ACTIVE", sourceStatus: "ACTIVE", ownership: "HUB_MANAGED", title: "Draft" },
    canRestore: false, canWrite: true, sourceArchived: false, workspaceArchived: false,
  });
  await DraftRecoveryPage({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) });
  expect(mocks.redirect).toHaveBeenCalledWith("/w/ws/knowledge/src/doc");
});

it("is not found when the draft has no recovery model", async () => {
  mocks.model.mockResolvedValue(null);
  await expect(DraftRecoveryPage({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) })).rejects.toThrow("not found");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/draft-recovery-page.test.tsx`

Expected: FAIL — the route and component do not exist.

- [ ] **Step 3: Implement the page**

Create `src/app/w/[workspaceId]/knowledge/drafts/[sourceId]/[documentId]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { MarkdownArticle } from "@/components/knowledge/markdown-article";
import { DraftRecoveryActions } from "@/components/knowledge/draft-recovery-actions";
import { getDraftRecoveryModel } from "@/server/draft-read";

export default async function DraftRecoveryPage({ params }: { params: Promise<{ workspaceId: string; sourceId: string; documentId: string }> }) {
  const { workspaceId, sourceId, documentId } = await params;
  const model = await getDraftRecoveryModel(workspaceId, sourceId, documentId);
  if (!model) notFound();
  if (model.document.status === "ACTIVE" && model.document.sourceStatus === "ACTIVE") {
    redirect(`/w/${workspaceId}/knowledge/${sourceId}/${documentId}`);
  }

  const explanation = model.workspaceArchived
    ? "This workspace is archived and read-only. Download or copy the draft before leaving."
    : model.sourceArchived
      ? "The source is archived. Restore the source in Sources before the original document can be edited."
      : !model.canWrite
        ? "You do not have permission to restore the original document. Download or copy the draft instead."
        : "The original document is archived. Restore it to continue editing, or download a copy.";

  return (
    <div className="kh-page space-y-6 pb-6">
      <PageHeader
        location="Home"
        locationHref={`/w/${workspaceId}/home`}
        title={model.draft.title || "Untitled draft"}
        description={explanation}
        actions={<DraftRecoveryActions
          workspaceId={workspaceId}
          sourceId={sourceId}
          documentId={documentId}
          title={model.draft.title || "Untitled draft"}
          markdown={model.draft.markdown}
          canRestore={model.canRestore}
        />}
      />
      <div className="kh-reading-column py-6">
        <MarkdownArticle markdown={model.draft.markdown} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the failing actions and download tests**

Create `tests/unit/download-markdown.test.ts` (jsdom) and `tests/unit/draft-recovery-actions.test.tsx` (jsdom). The download test must assert that a title containing `/` becomes `_` in the `.md` filename and that the object URL is revoked. The actions test must assert:

```tsx
// Restore
expect(governanceRequest).toHaveBeenCalledWith("/api/documents/doc/restore", "POST");
expect(router.push).toHaveBeenCalledWith("/w/ws/knowledge/src/doc");

// Download
expect(downloadMarkdown).toHaveBeenCalledWith("Draft", "# Unsaved body");

// Copy
expect(navigator.clipboard.writeText).toHaveBeenCalledWith("# Unsaved body");

// No restore button when canRestore is false
expect(container.textContent).not.toContain("Restore document");
```

Use `createRoot` + `act` as in `tests/unit/document-shortcuts-hook.test.tsx`; mock `next/navigation`’s `useRouter`, `@/components/ui/toast`, `@/lib/download-markdown`, and `@/components/workspaces/governance-error`.

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/draft-recovery-actions.test.tsx tests/unit/download-markdown.test.ts`

Expected: FAIL — the actions component and helper do not exist.

- [ ] **Step 6: Implement the actions and shared download helper**

Create `src/lib/download-markdown.ts`:

```ts
export function downloadMarkdown(title: string, markdown: string): void {
  const name = (title || "recovered-document").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120);
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

Create `src/components/knowledge/draft-recovery-actions.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { governanceFailure, governanceRequest } from "@/components/workspaces/governance-error";
import { organizeFailure } from "@/components/knowledge/organize-messages";
import { downloadMarkdown } from "@/lib/download-markdown";

export function DraftRecoveryActions({ workspaceId, sourceId, documentId, title, markdown, canRestore }: {
  workspaceId: string; sourceId: string; documentId: string; title: string; markdown: string; canRestore: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [restoring, setRestoring] = useState(false);

  async function restore() {
    setRestoring(true);
    try {
      await governanceRequest(`/api/documents/${documentId}/restore`, "POST");
      toast({ message: `Restored “${title}”.` });
      router.push(`/w/${workspaceId}/knowledge/${sourceId}/${documentId}`);
      router.refresh();
    } catch (error) {
      toast({ message: organizeFailure(governanceFailure(error)), tone: "danger" });
    } finally {
      setRestoring(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      toast({ message: "Draft copied." });
    } catch {
      toast({ message: "Could not copy the draft. Select the text and copy it manually.", tone: "danger" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRestore && <Button variant="secondary" disabled={restoring} onClick={() => void restore()}><RotateCcw size={14} aria-hidden="true" />{restoring ? "Restoring…" : "Restore document"}</Button>}
      <Button variant="ghost" onClick={() => downloadMarkdown(title, markdown)}><Download size={14} aria-hidden="true" />Download draft</Button>
      <Button variant="ghost" onClick={() => void copy()}><Copy size={14} aria-hidden="true" />Copy text</Button>
    </div>
  );
}
```

Replace the inline download in `src/components/knowledge/editable-document.tsx` (around lines 345–351) with `downloadMarkdown(resolve(value).title, value.markdown)`, and remove the now-unused inline Blob code.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/draft-recovery-page.test.tsx tests/unit/draft-recovery-actions.test.tsx tests/unit/download-markdown.test.ts`

Expected: PASS. Run the editor tests that touch the download copy (`tests/unit/editor-wikilinks.test.ts` and any `editable-document` tests) to confirm the refactor did not change behavior.

- [ ] **Step 8: Commit**

```bash
git add 'src/app/w/[workspaceId]/knowledge/drafts/[sourceId]/[documentId]/page.tsx' src/components/knowledge/draft-recovery-actions.tsx src/lib/download-markdown.ts src/components/knowledge/editable-document.tsx tests/unit/draft-recovery-page.test.tsx tests/unit/draft-recovery-actions.test.tsx tests/unit/download-markdown.test.ts
git commit -m "feat(personal): add a read-only draft recovery page"
```

---

### Task 5: Align draft and publish size limits

**Files:**
- Create: `src/lib/markdown-limits.ts`
- Modify: `src/server/authoring-input.ts`
- Modify: `src/server/http-error-response.ts`
- Modify: `src/modules/personal/application/personal-service.ts`
- Modify: `src/lib/persistent-draft.ts`
- Modify: `src/components/knowledge/document-composer.tsx`
- Create: `src/components/knowledge/draft-size-hint.tsx`
- Test: `tests/unit/markdown-limits.test.ts`
- Test: `tests/unit/personal-draft-limits.test.ts`
- Test: `tests/unit/persistent-draft.test.ts`
- Test: `tests/unit/draft-size-hint.test.tsx`
- Test: `tests/unit/phase5-authoring-input.test.ts`
- Test: `tests/unit/phase5-error-mapping.test.ts`

**Interfaces:**
- Produces:

```ts
export const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
export function markdownBytes(markdown: string): number;
export function markdownTooLarge(markdown: string): boolean;
export function formatBytes(bytes: number): string;
```

- Produces: `DraftStatus = "loading" | "saved" | "saving" | "local" | "error" | "conflict" | "too-large"`.
- Produces: `DRAFT_TOO_LARGE` maps to HTTP 400.

- [ ] **Step 1: Write the failing limit tests**

Create `tests/unit/markdown-limits.test.ts`:

```ts
import { MAX_MARKDOWN_BYTES, markdownBytes, markdownTooLarge } from "@/lib/markdown-limits";

it("counts UTF-8 bytes, not JavaScript code units", () => {
  expect(markdownBytes("中")).toBe(3);
  expect(markdownTooLarge("中".repeat(2_000_000))).toBe(true);
  expect(markdownTooLarge("x".repeat(MAX_MARKDOWN_BYTES))).toBe(false);
  expect(markdownTooLarge("x".repeat(MAX_MARKDOWN_BYTES + 1))).toBe(true);
});
```

Create `tests/unit/personal-draft-limits.test.ts` using the fake `PersonalService` fixture from the review probe:

```ts
it("rejects the same 2M-CJK draft that publishing rejects", async () => {
  const service = new PersonalService({ put: async () => true } as never, {} as never, uow as never);
  const markdown = "中".repeat(2_000_000);
  await expect(service.put(caller, workspaceId, "draft:new", { title: "Draft", markdown, baseRevisionId: null }, 0))
    .rejects.toMatchObject({ code: "DRAFT_TOO_LARGE" });
  expect(() => parseCreateDocumentInput({ title: "Draft", markdown })).toThrow("Markdown is too large");
});
```

Add to `tests/unit/phase5-authoring-input.test.ts`:

```ts
expect(() => parseCreateDocumentInput({ title: "A", markdown: "中".repeat(2_000_000) })).toThrow("Markdown is too large.");
```

Add to `tests/unit/phase5-error-mapping.test.ts` (and import `DomainError` from `@/shared/domain/errors`):

```ts
expect(toWorkspaceErrorResponse(new DomainError("DRAFT_TOO_LARGE", "Draft is too large.")).status).toBe(400);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/markdown-limits.test.ts tests/unit/personal-draft-limits.test.ts tests/unit/phase5-authoring-input.test.ts tests/unit/phase5-error-mapping.test.ts`

Expected: FAIL — the shared module does not exist, and the draft service still accepts 2M CJK characters.

- [ ] **Step 3: Implement the shared limit and server checks**

Create `src/lib/markdown-limits.ts`:

```ts
export const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
const encoder = new TextEncoder();

export function markdownBytes(markdown: string): number {
  return encoder.encode(markdown).byteLength;
}

export function markdownTooLarge(markdown: string): boolean {
  return markdownBytes(markdown) > MAX_MARKDOWN_BYTES;
}

export function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

In `src/server/authoring-input.ts`, import `MAX_MARKDOWN_BYTES` and `markdownBytes`, re-export the constant for existing imports, and change `readMarkdown`:

```ts
if (markdownBytes(markdown) > MAX_MARKDOWN_BYTES) invalid("Markdown is too large.");
```

In `src/modules/personal/application/personal-service.ts`, import `markdownTooLarge` and split the draft check:

```ts
const title = v.title;
const markdown = v.markdown;
if (typeof title !== "string" || title.length > 512 || typeof markdown !== "string" || !(v.baseRevisionId === null || typeof v.baseRevisionId === "string" && isUuid(v.baseRevisionId))) {
  throw new DomainError("INVALID_REQUEST", "Invalid draft.");
}
if (markdownTooLarge(markdown)) throw new DomainError("DRAFT_TOO_LARGE", "Draft is too large to save.");
payload = { title, markdown, baseRevisionId: v.baseRevisionId };
```

In `src/server/http-error-response.ts`, add `"DRAFT_TOO_LARGE"` to the 400-code list.

- [ ] **Step 4: Make the draft client terminal and recoverable**

In `src/lib/persistent-draft.ts`:

```ts
export type DraftStatus = "loading" | "saved" | "saving" | "local" | "error" | "conflict" | "too-large";
```

Add `private tooLarge = false;`. In `flush()`, before the generic throw:

```ts
const failure = await response.json().catch(() => null) as { error?: { code?: string } } | null;
if (failure?.error?.code === "DRAFT_TOO_LARGE") {
  this.tooLarge = true;
  this.onStatus("too-large");
  return;
}
```

In `change()`, clear the terminal state only when the new value fits:

```ts
if (this.tooLarge && (value === null || !markdownTooLarge(value.markdown))) this.tooLarge = false;
...
this.onStatus(this.stopped ? "conflict" : this.tooLarge ? "too-large" : kept ? "local" : "error");
if (sync && !this.tooLarge) this.schedule();
```

In `flush()`, return early when `this.tooLarge`; in `retry()`, return when `this.tooLarge`. In `clear()`, treat `this.tooLarge` like `this.stopped` so the local recovery copy can be discarded.

Create `src/components/knowledge/draft-size-hint.tsx`:

```tsx
import { MAX_MARKDOWN_BYTES, formatBytes } from "@/lib/markdown-limits";

export function DraftSizeHint({ bytes }: { bytes: number }) {
  if (bytes < MAX_MARKDOWN_BYTES * 0.8) return null;
  const tooLarge = bytes > MAX_MARKDOWN_BYTES;
  return <span className={tooLarge ? "text-kh-danger" : "text-kh-warning"}>{formatBytes(bytes)} of {formatBytes(MAX_MARKDOWN_BYTES)}{tooLarge ? " — too large to save" : ""}</span>;
}
```

In `src/components/knowledge/document-composer.tsx`, add a debounced byte count:

```ts
const [draftBytes, setDraftBytes] = useState(() => markdownBytes(initialMarkdown));
useEffect(() => {
  const timer = setTimeout(() => setDraftBytes(markdownBytes(markdown)), 300);
  return () => clearTimeout(timer);
}, [markdown]);
```

Add `"too-large": "Draft is too large to save to your account. Download or copy it before leaving."` to the status map, render `<DraftSizeHint bytes={draftBytes} />` beside it, and add a `Download draft` button when `draftStatus === "too-large" || draftBytes > MAX_MARKDOWN_BYTES` using `downloadMarkdown(title || "draft", markdown)`. Do not show the Retry button for `too-large`.

- [ ] **Step 5: Add the persistent-draft and hint tests**

In `tests/unit/persistent-draft.test.ts`:

```ts
it("stops after a too-large refusal and keeps the local copy", async () => {
  const status = vi.fn();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ value: null, version: 0 }))
    .mockResolvedValueOnce(Response.json({ error: { code: "DRAFT_TOO_LARGE", message: "Draft is too large to save." } }, { status: 400 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new PersistentDraft("/personal", "draft:doc", status);
  await client.load(); client.change(draft); await client.flush();
  expect(status).toHaveBeenLastCalledWith("too-large");
  await client.retry();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem("kh:persistent:/personal:draft:doc")).toContain("Recovery");
});

it("resumes saving after the text shrinks below the limit", async () => {
  // first PUT is too-large, then a smaller change produces a successful PUT
});
```

Create `tests/unit/draft-size-hint.test.tsx` with `renderToStaticMarkup`:

```tsx
const render = (bytes: number) => renderToStaticMarkup(<DraftSizeHint bytes={bytes} />);
expect(render(MAX_MARKDOWN_BYTES * 0.7)).not.toContain("of");
expect(render(MAX_MARKDOWN_BYTES + 1)).toContain("too large");
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/markdown-limits.test.ts tests/unit/personal-draft-limits.test.ts tests/unit/persistent-draft.test.ts tests/unit/draft-size-hint.test.tsx tests/unit/phase5-authoring-input.test.ts tests/unit/phase5-error-mapping.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/markdown-limits.ts src/server/authoring-input.ts src/server/http-error-response.ts src/modules/personal/application/personal-service.ts src/lib/persistent-draft.ts src/components/knowledge/document-composer.tsx src/components/knowledge/draft-size-hint.tsx tests/unit/markdown-limits.test.ts tests/unit/personal-draft-limits.test.ts tests/unit/persistent-draft.test.ts tests/unit/draft-size-hint.test.tsx tests/unit/phase5-authoring-input.test.ts tests/unit/phase5-error-mapping.test.ts
git commit -m "fix(personal): use one UTF-8 byte limit for drafts and publishing"
```

---

### Task 6: Return only favorites from the personal API

**Files:**
- Modify: `src/modules/personal/ports/personal-store.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/personal-items.ts`
- Modify: `src/modules/personal/application/personal-service.ts`
- Modify: `src/app/api/workspaces/[workspaceId]/personal/route.ts`
- Modify: `src/components/knowledge/use-document-shortcuts.ts`
- Test: `tests/unit/personal-favorites.test.ts`
- Test: `tests/unit/personal-items-repository.test.ts`
- Test: `tests/unit/document-shortcuts-hook.test.tsx`
- Test: `tests/unit/personal-preferences.test.ts` (fake store gains the new method)

**Interfaces:**
- Produces: `PersonalStore.listFavorites(userId, workspaceId): Promise<PersonalItem[]>`.
- Produces: `PersonalService.listFavorites(caller, workspaceId): Promise<{ key: string; sourceId: string }[]>`.
- Produces: `GET /api/workspaces/:workspaceId/personal?view=favorites` returns `{ key, sourceId }[]`; unknown views are a 400.

- [ ] **Step 1: Write the failing service and repository tests**

Create `tests/unit/personal-favorites.test.ts`:

```ts
it("reads only favorites and returns identifiers, not draft bodies", async () => {
  const store = { listFavorites: vi.fn(async () => [
    { key: "favorite:doc1", value: { favorite: true }, version: 1, updatedAt: "2026-10-24T00:00:00.000Z" },
  ]), list: vi.fn() };
  const queries = { listDocumentSummaries: vi.fn(async () => [{ documentId: "doc1", sourceId: "src1" }]) };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([{ key: "favorite:doc1", sourceId: "src1" }]);
  expect(store.list).not.toHaveBeenCalled();
  expect(queries.listDocumentSummaries).toHaveBeenCalledWith(caller, workspaceId, { includeArchived: true });
});

it("drops a favorite whose document is gone", async () => {
  // listFavorites returns favorite:missing; listDocumentSummaries returns []
});
```

Create `tests/unit/personal-items-repository.test.ts`:

```ts
it("asks the database for favorite rows only", async () => {
  const query = vi.fn(async () => []);
  const store = new MariaDbPersonalStore({ query } as never);
  await store.listFavorites("user", "workspace");
  expect(query.mock.calls[0][0]).toContain("item_key LIKE 'favorite:%'");
  expect(query.mock.calls[0][0]).not.toContain("draft:");
});
```

Update `tests/unit/personal-preferences.test.ts`’s fake store to include `listFavorites: vi.fn()`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/personal-favorites.test.ts tests/unit/personal-items-repository.test.ts tests/unit/personal-preferences.test.ts`

Expected: FAIL — `listFavorites` does not exist.

- [ ] **Step 3: Implement the port, repository, service, and route**

In `src/modules/personal/ports/personal-store.ts`:

```ts
listFavorites(userId: string, workspaceId: string): Promise<PersonalItem[]>;
```

In `src/infrastructure/database/mariadb/repositories/personal-items.ts`:

```ts
async listFavorites(userId: string, workspaceId: string) {
  const rows = await this.pool.query(
    "SELECT * FROM personal_items WHERE user_id=? AND workspace_id=? AND item_key LIKE 'favorite:%' AND payload IS NOT NULL ORDER BY updated_at DESC",
    [userId, workspaceId],
  );
  return (rows as Record<string, unknown>[]).map(item);
}
```

In `src/modules/personal/application/personal-service.ts`:

```ts
async listFavorites(caller: CallerContext, workspaceId: string) {
  await this.authorize(caller, workspaceId);
  const items = await this.store.listFavorites(caller.identity.id, workspaceId);
  const documents = new Map(
    (await this.queries.listDocumentSummaries(caller, workspaceId, { includeArchived: true }))
      .map(document => [document.documentId, document] as const),
  );
  return items.flatMap(item => {
    const document = documents.get(item.key.slice("favorite:".length));
    return document ? [{ key: item.key, sourceId: document.sourceId }] : [];
  });
}
```

In `src/app/api/workspaces/[workspaceId]/personal/route.ts` (add `import { DomainError } from "@/shared/domain/errors"`):

```ts
const view = new URL(request.url).searchParams.get("view");
if (view === "favorites") return s.personal.listFavorites(c, workspaceId);
if (view !== null) throw new DomainError("INVALID_REQUEST", "Unknown personal view.");
```

In `src/components/knowledge/use-document-shortcuts.ts`, change the request:

```ts
const response = await fetch(`/api/workspaces/${workspaceId}/personal?view=favorites`, { cache: "no-store" });
const items = await response.json() as { key: string; sourceId?: string }[];
```

Keep the existing `items.filter(i => i.key.startsWith("favorite:") && i.sourceId)` as a defensive guard; it now filters an already-small list.

- [ ] **Step 4: Update the hook test and run**

In `tests/unit/document-shortcuts-hook.test.tsx`, assert the request URL:

```ts
expect(fetch).toHaveBeenCalledWith("/api/workspaces/ws/personal?view=favorites", { cache: "no-store" });
```

Run: `npx vitest run --config vitest.config.ts tests/unit/personal-favorites.test.ts tests/unit/personal-items-repository.test.ts tests/unit/document-shortcuts-hook.test.tsx tests/unit/personal-preferences.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/personal/ports/personal-store.ts src/infrastructure/database/mariadb/repositories/personal-items.ts src/modules/personal/application/personal-service.ts 'src/app/api/workspaces/[workspaceId]/personal/route.ts' src/components/knowledge/use-document-shortcuts.ts tests/unit/personal-favorites.test.ts tests/unit/personal-items-repository.test.ts tests/unit/document-shortcuts-hook.test.tsx tests/unit/personal-preferences.test.ts
git commit -m "perf(personal): return only favorite identifiers to the shortcuts hook"
```

---

### Task 7: Share favorites requests and focus handling

**Files:**
- Modify: `src/components/knowledge/use-document-shortcuts.ts`
- Test: `tests/unit/document-shortcuts-hook.test.tsx`

**Interfaces:**
- Consumes: `useDocumentShortcuts(workspaceId)` keeps its current return shape `{ shortcuts, update, ready }`.
- Produces: module-level `loadFavoriteItems(workspaceId)` and `subscribeFavoritesFocus(workspaceId, listener)`; both are internal to the hook module.

- [ ] **Step 1: Write the failing tests**

Extend `tests/unit/document-shortcuts-hook.test.tsx` with a second `Host` and a focus test. The existing test harness already mocks `fetch`, `useWorkspaceAuthorization`, `useToast`, and `favorite-sync`; reuse it.

```tsx
it("makes one favorites request for two mounted hooks", async () => {
  await act(async () => root.render(<><Host /><Host /></>));
  expect(fetch).toHaveBeenCalledTimes(1);
  await answerFavorites([{ key: "favorite:f", sourceId: "s" }]);
  expect(stored().favorites).toEqual(["s:f"]);
});

it("makes one favorites request when the window regains focus", async () => {
  await act(async () => root.render(<><Host /><Host /></>));
  await answerFavorites([{ key: "favorite:f", sourceId: "s" }]);
  vi.mocked(fetch).mockClear();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(fetch).toHaveBeenCalledTimes(1);
  await answerFavorites([{ key: "favorite:f", sourceId: "s" }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/document-shortcuts-hook.test.tsx`

Expected: FAIL — two hook instances each fetch, and each registers its own focus listener.

- [ ] **Step 3: Implement one in-flight request and one focus subscription**

In `src/components/knowledge/use-document-shortcuts.ts`, add module-level state above the hook:

```ts
type FavoriteItem = { key: string; sourceId: string };
const favoritesInFlight = new Map<string, Promise<FavoriteItem[]>>();
const focusListeners = new Map<string, Set<() => void>>();
const focusHandlers = new Map<string, () => void>();
const lastFailureAt = new Map<string, number>();

async function loadFavoriteItems(workspaceId: string): Promise<FavoriteItem[]> {
  const existing = favoritesInFlight.get(workspaceId);
  if (existing) return existing;
  const promise = (async () => {
    await migrateLocalFavorites(workspaceId);
    await pendingFavoriteWrites(workspaceId).catch(() => {});
    const response = await fetch(`/api/workspaces/${workspaceId}/personal?view=favorites`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    return await response.json() as FavoriteItem[];
  })().finally(() => favoritesInFlight.delete(workspaceId));
  favoritesInFlight.set(workspaceId, promise);
  return promise;
}

function subscribeFavoritesFocus(workspaceId: string, listener: () => void): () => void {
  let listeners = focusListeners.get(workspaceId);
  if (!listeners) {
    listeners = new Set();
    focusListeners.set(workspaceId, listeners);
    const handler = () => { for (const notify of listeners!) notify(); };
    focusHandlers.set(workspaceId, handler);
    window.addEventListener("focus", handler);
  }
  listeners.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) {
      window.removeEventListener("focus", focusHandlers.get(workspaceId)!);
      focusHandlers.delete(workspaceId);
      focusListeners.delete(workspaceId);
    }
  };
}

function notifyFavoritesFailure(workspaceId: string, toast: ReturnType<typeof useToast>): void {
  const now = Date.now();
  if (now - (lastFailureAt.get(workspaceId) ?? 0) < 5_000) return;
  lastFailureAt.set(workspaceId, now);
  toast({ message: "Favorites could not sync. Showing this device’s saved list.", tone: "danger" });
}
```

In the hook’s effect, replace the direct `migrateLocalFavorites` / `pendingFavoriteWrites` / `fetch` block with:

```ts
const items = await loadFavoriteItems(workspaceId);
```

Replace the error toast in the catch with `notifyFavoritesFailure(workspaceId, toast)`.

Replace `window.addEventListener("focus", refresh)` with:

```ts
const unsubscribe = subscribeFavoritesFocus(workspaceId, refresh);
```

and in cleanup use `unsubscribe()` instead of `window.removeEventListener("focus", refresh)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/document-shortcuts-hook.test.tsx tests/unit/favorite-sync.test.ts tests/unit/personal-home-folder-sync.test.tsx`

Expected: PASS. The existing race tests (a document opened before the favorites response arrives) must still pass. This task shares the request and the focus listener, not one React state: each hook keeps its own state, synchronized by the existing `CHANGED` event and `localStorage` writes.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/use-document-shortcuts.ts tests/unit/document-shortcuts-hook.test.tsx
git commit -m "perf(home): share one favorites request and focus listener per workspace"
```

---

### Task 8: End-to-end draft recovery and final verification

**Files:**
- Create: `tests/e2e/draft-recovery.spec.ts`
- Verification note: `docs/superpowers/verification/2026-10-24-draft-recovery.md` (create after runs)

**Interfaces:**
- Consumes: the Home Drafts region, the recovery route from Task 4, and the restore API.

- [ ] **Step 1: Add the cross-tab recovery spec**

Create `tests/e2e/draft-recovery.spec.ts`:

```ts
import { test, expect } from "./fixtures/test";

test.skip(process.env.KM_TEAM_WORKSPACES_ENABLED !== "false", "Runs with the personal-only rollout.");

test("a draft survives archiving and can be restored from Home", { tag: "@smoke-personal" }, async ({ page }) => {
  await page.goto("/");
  const navigation = await (await page.request.get("/api/workspaces")).json();
  const workspaceId = navigation.items[0].id;
  const created = await page.request.post(`/api/workspaces/${workspaceId}/documents`, {
    data: { title: "Draft recovery", markdown: "Original body" },
  });
  expect(created.ok()).toBe(true);
  const document = await created.json();
  const href = `/w/${workspaceId}/knowledge/${document.sourceId}/${document.documentId}`;

  await page.goto(href);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.getByRole("textbox", { name: "Markdown", exact: true }).fill("Unsaved draft body");
  await expect(page.getByText("Draft saved to your account", { exact: true })).toBeVisible({ timeout: 15000 });

  const archived = await page.request.post(`/api/documents/${document.documentId}/archive`);
  expect(archived.ok()).toBe(true);

  await page.goto(`/w/${workspaceId}/home`);
  const drafts = page.getByRole("region", { name: "Drafts", exact: true });
  const row = drafts.getByRole("link").filter({ has: page.getByText("Draft recovery", { exact: true }) });
  await expect(row).toHaveAttribute("href", `/w/${workspaceId}/knowledge/drafts/${document.sourceId}/${document.documentId}`);
  await row.click();
  await expect(page.getByText("Unsaved draft body", { exact: true })).toBeVisible();
  await expect(page.getByText("The original document is archived", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Restore document", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${document.documentId}$`));
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeEditable();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue("Unsaved draft body");
});
```

- [ ] **Step 2: Run the DB-free gate**

Run: `make verify`

Expected: unit tests, typecheck, lint, and build pass. Record the exact output in the verification note.

- [ ] **Step 3: Run the DB-backed checks**

Run: `make test-e2e` (needs `make browsers` once and a working MariaDB).

Expected: the new `draft-recovery.spec.ts` passes, and existing personal-workspace/editor e2e tests still pass. If the environment cannot run Playwright, record that in the verification note rather than claiming it passed.

- [ ] **Step 4: Manual transient-error and request-count checks**

- The unit test proves the transient read is rethrown. For a browser check, inject a failure only in the document read (a temporary dev-only throw, or a database fault that leaves the workspace shell readable); confirm “This document could not be loaded” with Retry, not “Not found or no access”. A full `make db-down` may fail the workspace layout before the document boundary, so do not use that as the only check.
- With DevTools Network open, focus the window on Home and confirm one `/personal?view=favorites` request per workspace, not one per mounted component.
- Open a draft whose original document is archived; confirm the recovery page shows the draft body, the archived explanation, and Restore/Download/Copy. If the source is archived, confirm Restore is absent and the copy explains why.
- Open an oversized draft (2M CJK characters) in the editor; confirm the size hint, `too-large` status, Download action, and no retry loop.

- [ ] **Step 5: Write the verification note and commit**

Create `docs/superpowers/verification/2026-10-24-draft-recovery.md` with the commands run, pass/fail counts, and any checks not run. Then:

```bash
git add tests/e2e/draft-recovery.spec.ts docs/superpowers/verification/2026-10-24-draft-recovery.md
git commit -m "test(e2e): prove a draft survives archiving and can be restored"
```

---

## Out of Scope / Separate Plans

- **Home query batching and TTFB optimization.** The report’s follow-up is a measurement-first performance project. Record first-screen time, SQL count, and payload before changing the home read path. Do not fold it into this plan. Home still reads full draft markdown server-side to resolve titles, but it does not send that markdown to the browser; the client favorites path is fixed in Task 6.
- **`HomeUpdates` “You’re caught up” copy.** The component is absent on `main`; the finding applies to the reviewed HCM-KM branch. Revisit only if Home updates return.
- **ZIP export progress and error UI.** The direct download link remains. A separate task can replace it with `fetch` + blob + toast; do not build a background export job for a 64 MiB synchronous export.
- **Orphan drafts whose document was hard-deleted.** `personal.get`/`list` still hide them; this plan keeps that behavior and the existing `homeLists` test. A recovery/export path needs a product decision.
- **One-click “copy as new note.”** The recovery page provides read-only preview, download, and copy. A true new-document flow needs a unique draft key or immediate document creation; treat it as a follow-up, not part of the P1 fix.
- **True unread-update counts.** The current Home attention/notice model is separate; this plan only removes the misleading draft/read behavior above.

## Self-Review

- **Spec coverage:** Item 1 → Tasks 2–4; item 2 → Task 1; item 3 → Task 5; item 4 → Tasks 6–7; UX follow-ups → Out of Scope with explicit reasons.
- **Type consistency:** `DraftRecoveryModel`, `DraftRecoveryActions` props, `MAX_MARKDOWN_BYTES`, `DraftStatus`, `PersonalStore.listFavorites`, and `GET ?view=favorites` are defined once and referenced by later tasks.
- **Review Focus:** every listed condition has a named test; the manual checks cover browser-only behavior.
- **Proportion:** tasks are independently shippable; each has a failing test, implementation, passing test, and commit. No task depends on an undefined type or endpoint.
