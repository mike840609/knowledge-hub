# Download Markdown on shared pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Download Markdown button on every shared page that saves the document being read as the ordinary export's file (frontmatter + Markdown).

**Architecture:** `readShared` adds the current revision's `metadata` to the document view and both folder/Source document views. A client button builds the file in the browser with the existing `exportMarkdown()` and `downloadMarkdown()`. No route is added.

**Tech Stack:** Next.js 15 (App Router), React, Vitest (unit, integration on MariaDB), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-shared-download-markdown-design.md`

## Global Constraints

- No new route and no new caller-less entry; `tests/unit/share-link-single-exception.test.ts` must pass unchanged.
- File content must be byte-identical to `GET /api/documents/:id/export` for the same revision: `exportMarkdown({ title, markdown, metadata })`.
- Button label "Download" visible; accessible name "Download Markdown"; on a phone only the icon shows (`max-sm:sr-only`, as Open does).
- Design-language tokens only (`text-body`, etc.); `buttonClasses({ variant: "ghost" })` / `Button variant="ghost"`.

## Review Focus

- A title containing `/`, `:` or emoji downloads under a sanitised name, not a broken one (owned by `downloadMarkdown`; Task 2 asserts the call, not the sanitiser).
- Metadata with nested objects or arrays round-trips through YAML exactly as the ordinary export writes it (Task 3 e2e compares against the real export route).
- An empty shared folder (no document) shows no Download button (Task 3 unit test).
- The named-share Hub reader, which had no actions, shows Download but still no Save or Open (Task 3 unit test).
- Switching documents in a folder share downloads the newly selected document, not the first one (the button takes props per render; Task 3 e2e downloads after navigating to a second document).

---

### Task 1: `readShared` serves the revision's metadata

**Files:**
- Modify: `src/modules/knowledge/application/document-share-service.ts` (type `SharedDocumentView` ~line 55; the DOCUMENT view ~line 501; the folder document view ~line 666; the Source document view ~line 717)
- Test: `tests/integration/share-link-service.test.ts`, `tests/integration/folder-share-read.test.ts`, `tests/integration/source-share-read.test.ts`

**Interfaces:**
- Produces: `SharedDocumentView.metadata: Record<string, unknown>`, which `SharedFolderDocument` inherits. Set from `revision.metadata`.

- [ ] **Step 1: Write the failing tests.** In `share-link-service.test.ts`, under `describe("DocumentShareService.readShared …")`:

```ts
it("serves the current revision's metadata, for the shared download (shared download spec)", async () => {
  const { caller, documentId } = await mySpaceDocument(); // fixture writes metadata: {}
  const shares = service();
  const link = await shares.create(caller, { documentId });
  await expect(shares.readShared(tokenOf(link.path))).resolves.toMatchObject({ metadata: {} });
});
```

Then add one case with non-empty metadata, `{ tags: ["ops"], owner: "team-a" }`. Write a new revision through the same path the file's other revision-update test uses (the case that expects "Shared Runbook v2"), and assert that `metadata` equals it. In `folder-share-read.test.ts` and `source-share-read.test.ts`, extend one existing read case to assert `document.metadata` equals the fixture document's metadata.

- [ ] **Step 2: Run the tests to verify they fail.** Run `make db-up`, then `npx vitest run --config vitest.integration.config.ts tests/integration/share-link-service.test.ts tests/integration/folder-share-read.test.ts tests/integration/source-share-read.test.ts`. If the config name differs, use the command `make test-integration` runs. Expected: FAIL, because `metadata` is undefined.

- [ ] **Step 3: Implement.** Add `metadata: Record<string, unknown>` to `SharedDocumentView` and set `metadata: revision.metadata` in all three views.

- [ ] **Step 4: Run the Step 2 tests and `npx tsc --noEmit`.** Expected: PASS. Unit fixtures that build a `SharedDocumentView` literal will now fail typecheck; add `metadata: {}` to each (for example `documentView` in `tests/unit/hub-share-page.test.tsx`).

- [ ] **Step 5: Commit.** `feat(share): shared views carry the revision's metadata`

### Task 2: `SharedDownloadButton`

**Files:**
- Create: `src/components/knowledge/shared-download-button.tsx` (`"use client"`)
- Test: `tests/unit/shared-download-button.test.tsx`

**Interfaces:**
- Produces: `SharedDownloadButton({ title, markdown, metadata }: { title: string; markdown: string; metadata: Record<string, unknown> })`.
- Consumes: `downloadMarkdown` (`@/lib/download-markdown`) and `exportMarkdown` (`@/lib/markdown-export`).

- [ ] **Step 1: Write the failing test.** Mock `@/lib/download-markdown`. Render with `title: "Runbook"`, `markdown: "body"`, `metadata: { tags: ["ops"] }`. Assert that the button's accessible name is `Download Markdown`, and that clicking it calls `downloadMarkdown("Runbook", exportMarkdown({ title: "Runbook", markdown: "body", metadata: { tags: ["ops"] } }))` exactly once.

- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/shared-download-button.test.tsx`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** a ghost `Button` with lucide `Download` (`size-4`, `aria-hidden`) and the label `<span className="max-sm:sr-only">Download<span className="sr-only"> Markdown</span></span>`.

- [ ] **Step 4: Run Step 2 again.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(share): Download Markdown button for shared pages`

### Task 3: Put the button on every shared page

**Files:**
- Modify: `src/app/s/[token]/page.tsx` (the DOCUMENT `actions`), `src/app/s/[token]/shared-folder-page.tsx` (the `actions`), `src/app/w/[workspaceId]/shares/[token]/page.tsx` (the DOCUMENT `SharedReviewPanel`, which gains `actions`)
- Test: `tests/unit/hub-share-page.test.tsx`, plus a new `tests/e2e/zz-shared-download.spec.ts`

**Interfaces:**
- Consumes: `SharedDownloadButton` (Task 2) and `SharedDocumentView.metadata` (Task 1).

- [ ] **Step 1: Write the failing unit tests** in `hub-share-page.test.tsx`, using that file's element-walking helper:
  - The named DOCUMENT page renders one `SharedDownloadButton` with the props `{ title: "Named title", markdown: "Body", metadata: {} }`, and no `SaveShareButton`.
  - `SharedFolderPage` with `platformEntry={null}` and a `document` renders one `SharedDownloadButton` with that document's title, markdown and metadata, and no `SaveShareButton`.
  - `SharedFolderPage` with `document: null` renders no `SharedDownloadButton`.

- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/hub-share-page.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - On `/s/[token]` DOCUMENT, put `<SharedDownloadButton …/>` first in `actions`, before `SaveShareButton`.
  - In `SharedFolderPage`, `actions` becomes the download button (only when `document` exists), then Save, the divider and Open (only when `platformEntry !== null`). The empty-folder branch keeps Save and Open only.
  - The Hub DOCUMENT reader passes `actions={<SharedDownloadButton …/>}`.

- [ ] **Step 4: Run Step 2 again, plus** `npx vitest run --config vitest.config.ts tests/unit/share-link-single-exception.test.ts tests/unit/share-page-entry.test.tsx`. Expected: PASS.

- [ ] **Step 5: Write the e2e** `tests/e2e/zz-shared-download.spec.ts`. Copy the skip guard and the arrange helpers (`apiFolder`, `apiDocument`, share creation) from `zz-folder-share.spec.ts`. Create two documents in a folder; give the second the metadata `{ tags: ["ops"], nested: { a: 1 } }`.
  - **Document link:** in an anonymous context, open `/s/<token>`, click "Download Markdown" and await `page.waitForEvent("download")`. Assert that `suggestedFilename()` is `<title>.md` and that the file's text equals the owner's `GET /api/documents/<id>/export` body.
  - **Folder link:** open `/s/<token>?d=<second id>` and download. Assert that the file equals the second document's export. This covers switching documents.

- [ ] **Step 6: Run** `make test-e2e`. To run just this spec, pass the spec path the way the Makefile's e2e target allows. Expected: PASS.

- [ ] **Step 7: Run `make verify`.** Expected: PASS. Then commit: `feat(share): Download Markdown on shared document, folder and Source pages`.
