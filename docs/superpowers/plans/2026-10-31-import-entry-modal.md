# Import Folder Over Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the folder-import setup as a modal over the Sources list instead of replacing the list with a page, while keeping `/sources/import` as the full-page fallback and keeping the Preview a page.

**Architecture:** A Next.js intercepting route renders the existing import form in a Base UI dialog over `/sources`. The form reports its busy state so the dialog can lock dismissal during upload/finalize. The full-page route stays untouched for direct loads, Home, help, and sidebar entries.

**Tech Stack:** Next.js 15 App Router (parallel + intercepting routes), React 19, Base UI Dialog, Vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-31-import-entry-modal-design.md`

## Global Constraints

- `/w/:workspaceId/sources/import` stays a full page for direct loads and every non-Sources entry (Home, help, sidebar, bookmarks).
- The Preview at `/sources/imports/:snapshotId` stays a page; do not change upload, finalize, apply, or the 30-minute expiry.
- Reuse `FolderImportForm`; do not create a second import form.
- While `PREPARING`, `UPLOADING`, or `FINALIZING`, the dialog cannot be dismissed; only the form's **Cancel import** aborts.
- Dialog width `w-[min(40rem,92vw)]`, maximum height `85vh`, scrolling inside the popup.
- No API, database, or preview changes.

## Review Focus

- A direct `/sources/import` load must render the full page, never an empty dialog over nothing.
- Escape and browser Back must both close the dialog and return to the mounted Sources list with one history entry removed.
- The dialog must stay open while an import is running; a stray close must not abort the upload.
- Starting the sample wiki from the dialog must reach the Preview, not leave a stuck dialog.
- At 390×844 the dialog must fit and **Choose folder** must be reachable.

---

### Task 1: Report Busy State From `FolderImportForm`

**Files:**
- Modify: `src/components/imports/folder-import-form.tsx:436-507`
- Test: `tests/unit/folder-import-form.test.tsx` (inside `describe("folder import directory picker", ...)`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `FolderImportForm` accepts `onBusyChange?: (busy: boolean) => void`; it is called with `true` while `PREPARING`/`UPLOADING`/`FINALIZING` and `false` otherwise.

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe("folder import directory picker", ...)` block:

```tsx
it("reports when an import is busy so a host can lock dismissal", async () => {
  vi.mocked(isDirectoryPickerSupported).mockReturnValue(true);
  Object.defineProperty(window, "showDirectoryPicker", {
    value: vi.fn().mockResolvedValue({ name: "Notes" }),
    configurable: true,
  });
  let release!: (files: File[]) => void;
  vi.mocked(collectHandleFiles).mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const onBusyChange = vi.fn();

  act(() => {
    root.render(<FolderImportForm target={{ kind: "new", workspaceId: "w1" }} onBusyChange={onBusyChange} />);
  });
  await clickChooseFolder();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);

  await act(async () => { release([]); });
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:unit -- tests/unit/folder-import-form.test.tsx -t "reports when an import is busy"`
Expected: FAIL because `onBusyChange` is never called.

- [ ] **Step 3: Implement the callback**

Add the prop to the component signature:

```tsx
export function FolderImportForm({
  target,
  limits = DEFAULT_CLIENT_LIMITS,
  onBusyChange,
}: {
  target: FolderImportTarget;
  limits?: FolderImportClientLimits;
  /** Reports PREPARING/UPLOADING/FINALIZING so a host dialog can lock dismissal. */
  onBusyChange?: (busy: boolean) => void;
}): React.JSX.Element {
```

Add this effect after the existing `now` ticking effect (the `useEffect` that depends on `state.kind`):

```tsx
useEffect(() => {
  onBusyChange?.(busy);
}, [busy, onBusyChange]);
```

`busy` is already computed as `state.kind === "PREPARING" || state.kind === "UPLOADING" || state.kind === "FINALIZING"`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test:unit -- tests/unit/folder-import-form.test.tsx -t "reports when an import is busy"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/imports/folder-import-form.tsx tests/unit/folder-import-form.test.tsx
git commit -m "feat(import): report busy state from the folder form"
```

---

### Task 2: Add `ImportFolderDialog`

**Files:**
- Create: `src/components/imports/import-folder-dialog.tsx`
- Test: `tests/unit/import-folder-dialog.test.tsx`

**Interfaces:**
- Consumes: `FolderImportForm` and `FolderImportClientLimits` from Task 1, including `onBusyChange`.
- Produces: `ImportFolderDialog({ workspaceId, canImport, limits }: { workspaceId: string; canImport: boolean; limits: FolderImportClientLimits }): React.JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/import-folder-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: state.back }) }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, children }: { href: string; children: React.ReactNode }) =>
      createElement("a", { href }, children),
  };
});
vi.mock("@/components/imports/folder-import-form", async () => {
  const { createElement } = await import("react");
  return {
    FolderImportForm: ({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) =>
      createElement(
        "div",
        null,
        createElement("button", { type: "button", onClick: () => onBusyChange?.(true) }, "Start"),
        createElement("button", { type: "button", onClick: () => onBusyChange?.(false) }, "Finish"),
      ),
  };
});

import { ImportFolderDialog } from "@/components/imports/import-folder-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  state.back.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const limits = { maxMarkdownFileBytes: 5 * 1024 * 1024, maxAssetFileBytes: 8, maxAssetTotalBytes: 16 };

function render(canImport = true) {
  act(() => root.render(<ImportFolderDialog workspaceId="w1" canImport={canImport} limits={limits} />));
}

function button(name: string): HTMLButtonElement {
  const element = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === name);
  if (!element) throw new Error(`${name} button not mounted`);
  return element as HTMLButtonElement;
}

function closeButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]');
  if (!element) throw new Error("close button not mounted");
  return element;
}

it("goes back to the Sources history entry when closed", () => {
  render();
  act(() => closeButton().click());
  expect(state.back).toHaveBeenCalledOnce();
});

it("keeps the dialog open while the import is running", () => {
  render();
  act(() => button("Start").click());
  expect(closeButton().disabled).toBe(true);
  act(() => closeButton().click());
  expect(state.back).not.toHaveBeenCalled();

  act(() => button("Finish").click());
  expect(closeButton().disabled).toBe(false);
  act(() => closeButton().click());
  expect(state.back).toHaveBeenCalledOnce();
});

it("explains a read-only workspace instead of rendering the form", () => {
  render(false);
  expect(document.body.textContent).toContain("This workspace is read-only. Import is unavailable.");
  expect(document.body.textContent).not.toContain("Start");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:unit -- tests/unit/import-folder-dialog.test.tsx`
Expected: FAIL because `@/components/imports/import-folder-dialog` does not exist.

- [ ] **Step 3: Implement the dialog**

Create `src/components/imports/import-folder-dialog.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { DialogCloseButton } from "@/components/ui/dialog-close";
import { FolderImportForm, type FolderImportClientLimits } from "./folder-import-form";

export function ImportFolderDialog({
  workspaceId,
  canImport,
  limits,
}: {
  workspaceId: string;
  canImport: boolean;
  limits: FolderImportClientLimits;
}): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next && !busy) router.back(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdropClasses()} />
        <Dialog.Popup className={dialogPopupClasses("w-[min(40rem,92vw)] max-h-[85vh] overflow-y-auto")}>
          <Dialog.Title className="text-title font-semibold">Import folder</Dialog.Title>
          <Dialog.Description className="mt-1 text-body text-kh-text-muted">
            Your local files stay unchanged.{" "}
            <Link
              className="rounded-md text-kh-link underline-offset-4 hover:underline kh-focus-ring"
              href="/help#format-reference"
            >
              Folder format guide
            </Link>
          </Dialog.Description>
          <div className="mt-5">
            {canImport ? (
              <FolderImportForm
                target={{ kind: "new", workspaceId }}
                limits={limits}
                onBusyChange={setBusy}
              />
            ) : (
              <p role="status" className="text-body text-kh-text-muted">
                This workspace is read-only. Import is unavailable.
              </p>
            )}
          </div>
          <DialogCloseButton disabled={busy} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test:unit -- tests/unit/import-folder-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/imports/import-folder-dialog.tsx tests/unit/import-folder-dialog.test.tsx
git commit -m "feat(import): add the import folder dialog"
```

---

### Task 3: Intercept `/sources/import` Over the Sources Layout

**Files:**
- Create: `src/app/w/[workspaceId]/sources/layout.tsx`
- Create: `src/app/w/[workspaceId]/sources/@modal/default.tsx`
- Create: `src/app/w/[workspaceId]/sources/@modal/(.)import/page.tsx`
- Test: `tests/e2e/import-entry-modal.spec.ts`

**Interfaces:**
- Consumes: `ImportFolderDialog` from Task 2; `getWorkspaceShellModel` from `@/server/knowledge-read`; `importRuntimeConfig()` from `@/server/import-config`.
- Produces: client navigation from any page under `/sources` to `/sources/import` renders the dialog in the `modal` slot while the Sources page stays as `children`; direct navigation still renders `sources/import/page.tsx`.

- [ ] **Step 1: Write the failing e2e**

Create `tests/e2e/import-entry-modal.spec.ts`:

```ts
import { expect, test, type Page } from "./fixtures/test";

async function personalWorkspaceId(page: Page): Promise<string> {
  const nav = await (await page.request.get("/api/workspaces")).json();
  return nav.items.find((workspace: { type: string }) => workspace.type === "PERSONAL").id;
}

const openImport = (page: Page) =>
  page.locator("main.kh-page").getByRole("link", { name: "Import folder", exact: true }).first().click();

test("Import folder opens over Sources; Escape and Back return to the list", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/sources`);
  const surface = page.locator("main.kh-page");
  await expect(surface).toBeVisible();

  await openImport(page);
  const dialog = page.getByRole("dialog", { name: "Import folder", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources/import$`));
  await expect(surface).toBeVisible();
  await expect(dialog.getByLabel("Source name")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Choose folder", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources$`));

  await openImport(page);
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources$`));
});

test("a direct /sources/import load is still the full page", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/sources/import`);
  await expect(page.getByRole("dialog", { name: "Import folder", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Import folder", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose folder", exact: true })).toBeVisible();
});

test("the sample wiki runs inside the dialog and lands on Preview", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/sources`);
  await openImport(page);
  const dialog = page.getByRole("dialog", { name: "Import folder", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("group", { name: "Try with a sample wiki" }).getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/imports\//, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
});

test("the dialog fits a phone viewport", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/w/${ws}/sources`);
  await openImport(page);
  const dialog = page.getByRole("dialog", { name: "Import folder", exact: true });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole("button", { name: "Choose folder", exact: true })).toBeInViewport();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:e2e -- tests/e2e/import-entry-modal.spec.ts`
Expected: FAIL on the first test because clicking **Import folder** performs a full page load and no dialog appears.

- [ ] **Step 3: Add the layout and slots**

Create `src/app/w/[workspaceId]/sources/layout.tsx`:

```tsx
import type { ReactNode } from "react";

export default function SourcesLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
```

Create `src/app/w/[workspaceId]/sources/@modal/default.tsx`:

```tsx
export default function SourcesModalDefault() {
  return null;
}
```

Create `src/app/w/[workspaceId]/sources/@modal/(.)import/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ImportFolderDialog } from "@/components/imports/import-folder-dialog";
import { importRuntimeConfig } from "@/server/import-config";
import { getWorkspaceShellModel } from "@/server/knowledge-read";

export default async function InterceptedWorkspaceSourceImportPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const shell = await getWorkspaceShellModel(workspaceId);
  if (!shell) notFound();
  const limits = importRuntimeConfig().limits;
  return (
    <ImportFolderDialog
      workspaceId={workspaceId}
      canImport={shell.access.actions.canImport}
      limits={{
        maxMarkdownFileBytes: limits.maxMarkdownFileBytes,
        maxAssetFileBytes: limits.maxAssetFileBytes,
        maxAssetTotalBytes: limits.maxAssetTotalBytes,
      }}
    />
  );
}
```

Do not modify `src/app/w/[workspaceId]/sources/import/page.tsx`; it remains the full-page fallback.

- [x] **Step 4: Run the new e2e and the existing direct-load e2e**

Run: `npm run test:e2e -- tests/e2e/import-entry-modal.spec.ts tests/e2e/sample-wiki-import.spec.ts`
Expected: PASS. The existing sample-wiki tests still open `/sources/import` directly and must see the full page.

- [x] **Step 5: Run the type check**

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 6: Run the linter**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/w/[workspaceId]/sources/layout.tsx \
  "src/app/w/[workspaceId]/sources/@modal/default.tsx" \
  "src/app/w/[workspaceId]/sources/@modal/(.)import/page.tsx" \
  "src/app/w/[workspaceId]/sources/@modal/[...catchAll]/page.tsx" \
  tests/e2e/import-entry-modal.spec.ts
git commit -m "feat(import): open folder import over Sources"
```

## Implementation Notes From Review

- `@modal/[...catchAll]/page.tsx` returns `null`. `default.tsx` alone is not enough: on a soft navigation to a route the slot does not match, Next keeps the slot's active subpage, so the catch-all closes the dialog when the import lands on the Preview.
- `FolderImportForm` accepts `replaceOnComplete`; `ImportFolderDialog` passes it. A successful modal import replaces the transient `/sources/import` history entry with the Preview, so Back returns to Sources instead of reopening the form.
- `tests/unit/import-folder-dialog-busy.test.tsx` drives the real form and dialog together and proves the busy lock on the close button and Escape.
- Minor, deferred at first review: the `onBusyChange` effect ran after paint, so the close control could be enabled for roughly one frame at the PREPARING transition. `Dialog.Root` also stayed `open` because dismissal depended on `router.back()`. Both are fixed in the follow-up below.

## Follow-up verification (2026-10-31)

- The implementation commits are present through `149fe0a7`; unchecked historical steps above do not indicate verified RED runs.
- Full unit suite: 312 files, 3,568 tests passed. Typecheck and lint passed. The two planned E2E files passed all 14 tests against a fresh production build.
- Review found that the format guide could navigate away during an import. The dialog now makes the guide unavailable while busy and restores it when idle; the real-form busy test covers this.
- Follow-up `fix/import-modal-minors` closes the remaining review minors: `onBusyChange` now uses `useLayoutEffect`, `Dialog.Root` is controlled so a refused navigation still hides the dialog, and the intercepted route renders the same `StatusMessage` as the full page when access is missing.
