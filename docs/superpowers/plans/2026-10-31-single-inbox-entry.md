# Single Inbox Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A personal workspace's primary rail is the only Inbox entry; the rail header's popover and the narrow topbar's popover are removed.

**Architecture:** Delete the popover surface and its two mounts, leaving `PrimaryNav`'s Inbox row and `useInboxUnread` untouched. Replace the popover E2E with a one-entry contract that exercises the expanded rail, the collapsed rail and the narrow Menu drawer.

**Tech Stack:** Next.js App Router, React, Base UI, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-single-inbox-entry-design.md`

## Global Constraints

- Inbox is a personal-workspace surface only: `workspace.type === "PERSONAL"`. Team workspaces never show the row.
- No new colors, tokens, icons or components. The rail keeps the existing `Inbox` lucide glyph on its row.
- The Inbox page, its split view, its tabs, notification APIs, mark-read and `useInboxUnread` do not change.
- `docs/superpowers/specs/frontend-design-language.md` is the living contract and is updated in the same change.
- The wordmark row still holds the wordmark and the collapse control at 176px, and only the collapse control at 48px.

## Review Focus

- **Collapsed rail:** exactly one Inbox icon with its badge; the header must not add a second one.
- **Narrow topbar:** no Inbox control, no empty slot before the document actions; the Menu drawer's row still opens `/inbox`.
- **176px header:** the wordmark and the collapse control still fit without overlap or a gap where the popover was.
- **Accessibility:** the primary rail exposes exactly one control named "Inbox" (the link), and no "Inbox" button.
- **Inbox page unchanged:** badge label, mark-read, tabs and split view still pass their existing tests after the popover is deleted.

---

### Task 1: Remove the duplicate Inbox control and pin the one-entry contract

**Files:**
- Create: `tests/e2e/inbox-entry.spec.ts`
- Delete: `tests/e2e/inbox-popover.spec.ts`
- Modify: `src/components/shell/app-shell.tsx:9,100-109`
- Modify: `src/components/shell/topbar.tsx:8,24`
- Delete: `src/components/shell/inbox-popover.tsx`
- Modify: `src/components/knowledge/knowledge-skeletons.tsx:106-108`
- Modify: `docs/superpowers/specs/frontend-design-language.md:1659`

**Interfaces:**
- Consumes: `PrimaryNav`'s Inbox link, whose accessible name is `Inbox` or `Inbox, N unread`, and `/w/:workspaceId/inbox`.
- Produces: no new exports. The rail header renders only `Knowledge Hub` (expanded) and `Collapse navigation` / `Expand navigation`.

- [ ] **Step 1: Write the failing E2E test**

```ts
// tests/e2e/inbox-entry.spec.ts
import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

test("the primary rail carries the only Inbox entry", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);

  const sidebar = page.locator("aside").first();
  const inbox = sidebar.getByRole("link", { name: /^Inbox/ });
  await expect(inbox).toHaveCount(1);
  await expect(sidebar.getByRole("button", { name: /Inbox/ })).toHaveCount(0);

  const brand = sidebar.getByText("Knowledge Hub", { exact: true });
  const collapse = sidebar.getByRole("button", { name: "Collapse navigation" });
  const [brandBox, collapseBox, sidebarBox] = await Promise.all([brand.boundingBox(), collapse.boundingBox(), sidebar.boundingBox()]);
  expect(brandBox && collapseBox && sidebarBox).toBeTruthy();
  expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(collapseBox!.x + 1);
  expect(collapseBox!.x + collapseBox!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width);

  await inbox.click();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
});

test("the collapsed rail and the narrow topbar keep one Inbox entry", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);
  await page.getByRole("button", { name: "Collapse navigation" }).click();

  const rail = page.locator("aside").first();
  await expect(rail.getByRole("link", { name: /^Inbox/ })).toHaveCount(1);
  await expect(rail.getByRole("button", { name: /Inbox/ })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);
  await expect(page.getByRole("banner").getByRole("button", { name: /Inbox/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  const row = drawer.getByRole("link", { name: /^Inbox/ });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e -- inbox-entry.spec.ts`
Expected: FAIL — the sidebar still has the popover's Inbox button, so `toHaveCount(0)` reports 1.

- [ ] **Step 3: Remove the popover from the rail header**

In `src/components/shell/app-shell.tsx`: delete the `InboxPopover` import, replace the comment at line 100 with `{/* The wordmark and the collapse control share the compact 176px header. */}`, change the expanded header to render only the wordmark span, and delete the `navCollapsed && … <InboxPopover placement="compact" … />` block. The header becomes:

```tsx
<div className={`flex h-12 shrink-0 items-center gap-1 ${navCollapsed ? "justify-center px-2" : "px-2"}`}>
  {navCollapsed ? null : <span className="min-w-0 flex-1 whitespace-nowrap text-caption font-semibold text-kh-text">Knowledge Hub</span>}
  <Tooltip label={navCollapsed ? "Expand navigation" : "Collapse navigation"} shortcut={NAV_TOGGLE_SHORTCUT} side={navCollapsed ? "right" : "bottom"}>
    <button type="button" onClick={toggleNav} aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"} aria-keyshortcuts={NAV_TOGGLE_SHORTCUT} className={buttonClasses({ variant: "ghost", icon: true, size: navCollapsed ? "md" : "sm" })}>
      {navCollapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
    </button>
  </Tooltip>
</div>
```

- [ ] **Step 4: Remove the popover from the narrow topbar**

In `src/components/shell/topbar.tsx`: delete the `InboxPopover` import and the `{model.access.workspace.type === "PERSONAL" ? <div className="shrink-0 pr-2"><InboxPopover … /></div> : null}` line. `model` stays in the signature because `QuickSearch`, `DocumentContextBar` and the Menu use it.

- [ ] **Step 5: Delete the popover and its now-unused skeleton variant**

Delete `src/components/shell/inbox-popover.tsx`. In `src/components/knowledge/knowledge-skeletons.tsx`, make `NotificationListSkeleton` take no props and render `<div className="space-y-3 py-3">`; the Inbox page calls it with no arguments.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:e2e -- inbox-entry.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Delete the old popover spec**

Delete `tests/e2e/inbox-popover.spec.ts`; its three tests exercise a surface that no longer exists, and `global-inbox-activity.spec.ts` already covers the Inbox page's notifications.

- [ ] **Step 8: Update the living contract**

In `docs/superpowers/specs/frontend-design-language.md:1659`, replace

> A personal workspace puts **Inbox** first among the navigation rows, with the unread count beside it; the header's Inbox popover stays as the quick peek, so the row is the place and the popover is the glance.

with

> A personal workspace puts **Inbox** first among the navigation rows, with the unread count beside it; it is the only Inbox control at every width — the rail's header row is the wordmark and the collapse control, and the narrow topbar has none (`2026-10-31-single-inbox-entry-design.md`).

- [ ] **Step 9: Run the neighboring checks**

Run:
```bash
npm run test:unit -- tests/unit/primary-nav-inbox.test.tsx tests/unit/inbox-split-view.test.tsx
npm run test:e2e -- inbox-entry.spec.ts global-inbox-activity.spec.ts
npm run typecheck
npm run lint
```
Expected: all pass; no reference to `inbox-popover` remains in `src/` or `tests/`.

- [ ] **Step 10: Commit**

```bash
git add src/components/shell/app-shell.tsx src/components/shell/topbar.tsx src/components/shell/inbox-popover.tsx \
  src/components/knowledge/knowledge-skeletons.tsx \
  tests/e2e/inbox-entry.spec.ts tests/e2e/inbox-popover.spec.ts \
  docs/superpowers/specs/2026-10-31-single-inbox-entry-design.md \
  docs/superpowers/specs/frontend-design-language.md \
  docs/superpowers/plans/2026-10-31-single-inbox-entry.md
git commit -m "feat(ui): make the rail's Inbox row the only Inbox entry"
```
