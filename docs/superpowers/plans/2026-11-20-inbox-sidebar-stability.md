# Inbox Keeps the Workspace Sidebar Still — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening Inbox changes only the page area; the desktop sidebar keeps the reader's width, placement, and control meaning.

**Architecture:** Delete the Inbox-only `inboxCompact` state in `AppShell`; derive the sidebar from the persisted `navCollapsed` choice alone. The Inbox split already measures its own box, so no Inbox layout code changes. Re-point the E2E contracts that encoded the old forced compact behavior.

**Tech Stack:** Next.js App Router, React 19, Tailwind, Playwright E2E, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-inbox-sidebar-stability-design.md`

## Global Constraints

- Expanded desktop sidebar is `272px` (`w-[17rem]`); the rail is `48px` (`w-12`).
- Desktop means `>= 1024px`; below that every page uses the Menu drawer.
- The Inbox split threshold stays `75rem` of the Inbox's own box; do not change it.
- No new route, control, permission, dependency, API, or data.
- Preserve the pre-existing untracked files `docs/operations/vercel-deployment.md`, `docs/operations/vercel-deployment.zh-TW.md`, and `tests/unit/graph-canvas.test.tsx`.

## Review Focus

- Entering Inbox at `1440–1471px` with the sidebar expanded must leave it expanded, with no Menu drawer and the `Collapse navigation` control still present.
- Entering Inbox with the sidebar already collapsed must leave the `48px` rail in place.
- Browser Back from Inbox must not reopen or rescale the sidebar.
- At `1512px` with the sidebar expanded the Inbox split must still appear; at `1440px` with the sidebar collapsed it must also appear.
- The phone Menu drawer must be unchanged, including closing on an Inbox click and returning focus to the trigger.

## Task 1: Remove the Inbox-only sidebar reaction

**Files:**
- Modify: `src/components/shell/app-shell.tsx:32-72,74-75,104-121,260-283`
- Modify: `src/components/shell/primary-nav.tsx:12-16,49-77`
- Test: `tests/e2e/inbox-entry.spec.ts`

**Interfaces:**
- Consumes: the persisted `navCollapsed` state in `AppShell` and the existing `toggleNav`, `closeDrawerForLink`, and `drawerOpener` callbacks.
- Produces: `AppShell` no longer accepts or passes an `inboxRef`; `PrimaryNav` and `InboxHeaderLink` no longer expose a `ref` prop. No other module uses those props.

- [ ] **Step 1: Add two failing regression tests**

Append to `tests/e2e/inbox-entry.spec.ts`:

```ts
test("Inbox keeps the desktop sidebar expanded", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);

  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  const explorer = sidebar.getByRole("complementary", { name: "Knowledge explorer" });
  const inbox = sidebar.getByRole("link", { name: /^Inbox/ });
  await expect(sidebar).toHaveCSS("width", "272px");
  await expect(explorer).toBeVisible();

  await inbox.click();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
  await expect(sidebar).toHaveCSS("width", "272px");
  await expect(explorer).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Collapse navigation", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Expand navigation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toHaveCount(0);
  await expect(inbox).toHaveAttribute("aria-current", "page");
  // The expanded sidebar leaves 1168px, so Inbox is the plain list.
  await expect(page.getByText("Select a discussion", { exact: true })).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/home$`));
  await expect(sidebar).toHaveCSS("width", "272px");
  await expect(explorer).toBeVisible();
});

test("Inbox keeps the desktop sidebar collapsed", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);

  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  await sidebar.getByRole("button", { name: "Collapse navigation", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "48px");
  const inbox = sidebar.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: /^Inbox/ });

  await inbox.click();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
  await expect(sidebar).toHaveCSS("width", "48px");
  await expect(inbox).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toHaveCount(0);
  // The collapsed rail leaves 1392px, so Inbox returns to its split layout.
  await expect(page.getByText("Select a discussion", { exact: true })).toBeVisible();

  await sidebar.getByRole("button", { name: "Expand navigation", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "272px");
});
```

- [ ] **Step 2: Run the new tests and watch them fail against the current shell**

Run: `KM_E2E_PORT=3611 KM_E2E_BUILD_CACHE=true npm run test:e2e -- inbox-entry.spec.ts -g "Inbox keeps the desktop sidebar"`

Expected: FAIL on the first test at `toHaveCSS("width", "272px")` after entering Inbox (the shell forces `48px`), and on the second test because `Expand navigation` opens the Menu drawer instead of widening the rail.

- [ ] **Step 3: Remove the forced compact state in `src/components/shell/app-shell.tsx`**

Make exactly these edits:

1. Delete the `INBOX_INLINE_NAV_MIN_WIDTH` comment and constant (lines 74-75).
2. In `WorkspaceSidebarContent`, delete the `inboxRef` parameter, its `Ref<HTMLAnchorElement>` type, and the `inboxRef={inboxRef}` prop passed to `PrimaryNav`.
3. In `AppShell`, delete `isInbox`, `inboxHasSidebarRoom`, and `inboxCompact`. Replace the derivations with:
   ```ts
   const compact = navCollapsed;
   const sidebarWidth = navCollapsed ? "w-12" : "w-[17rem]";
   const usesDrawer = !desktop;
   ```
   Keep `inboxHref`; `toggleNav` still uses it.
4. Delete the `restoreInboxFocus` ref and the `desktopInboxRef` callback.
5. Render `<InboxHeaderLink workspaceId={workspaceId} unread={inboxUnread} />` without `ref`.
6. Render `<WorkspaceSidebarContent ...>` without `inboxRef`.
7. Make the desktop toggle call `toggleNav()` unconditionally, remove `aria-haspopup`, set `aria-expanded={!compact}`, and set `aria-controls={desktopNavId}`.
8. Keep the `inboxFocused` branch in `toggleNav`: collapsing with focus on the header Inbox link must still move focus to the toggle.

- [ ] **Step 4: Delete the dead ref plumbing in `src/components/shell/primary-nav.tsx`**

Remove the `ref` field from `NavItem`, the `ref` parameter from `inboxItem`, the `inboxRef` prop from `PrimaryNav`, the `ref` prop from `InboxHeaderLink`, `<Link ref={ref}>`, and the now-unused `import type { Ref } from "react"`. No caller passes them after Step 3.

- [ ] **Step 5: Update the three existing 1440px cases in `tests/e2e/inbox-entry.spec.ts`**

1. In `"the expanded sidebar puts Inbox beside collapse and gives Search a row"`, replace the resize block after the `aria-current` assertion with:
   ```ts
   await page.setViewportSize({ width: 1440, height: 900 });
   await expect(inbox).toBeFocused();
   await expect(inbox).toHaveAttribute("aria-current", "page");
   await expect(sidebar.getByRole("button", { name: "Collapse navigation", exact: true })).toBeVisible();
   await page.setViewportSize({ width: 1512, height: 900 });
   await expect(inbox).toBeFocused();
   ```
2. Replace `"entering Inbox at 1440px carries focus from the header to the rail"` with:
   ```ts
   test("entering Inbox at 1440px keeps the header link focused and the sidebar expanded", async ({ page, request }) => {
     const doc = await createReviewDocument(request);
     const owner = phase3Origin("reviewOwner");
     await page.setViewportSize({ width: 1440, height: 900 });
     await page.goto(`${owner}/w/${doc.workspaceId}/home`);

     const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
     const inbox = sidebar.getByRole("link", { name: /^Inbox/ });
     await inbox.press("Enter");
     await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
     await expect(inbox).toHaveAttribute("aria-current", "page");
     await expect(inbox).toBeFocused();
     await expect(sidebar.getByRole("button", { name: "Collapse navigation", exact: true })).toBeVisible();
     await expect(sidebar.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: /^Inbox/ })).toHaveCount(0);
   });
   ```
3. Split `"opening the Inbox from its filtered view closes Menu and returns focus"` into a desktop case and a phone case:
   ```ts
   test("opening Inbox from its filtered view keeps the desktop sidebar still", async ({ page, request }) => {
     const doc = await createReviewDocument(request);
     const inbox = `${phase3Origin("reviewOwner")}/w/${doc.workspaceId}/inbox`;
     await page.setViewportSize({ width: 1440, height: 900 });
     await page.goto(`${inbox}?kind=mention`);
     const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
     const link = sidebar.getByRole("link", { name: /^Inbox/ });
     await link.press("Enter");
     await expect(page).toHaveURL(inbox);
     await expect(link).toBeFocused();
     await expect(sidebar.getByRole("button", { name: "Collapse navigation", exact: true })).toBeVisible();
     await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toHaveCount(0);
   });

   test("opening Inbox from its filtered view closes Menu and returns focus", async ({ page, request }) => {
     const doc = await createReviewDocument(request);
     const inbox = `${phase3Origin("reviewOwner")}/w/${doc.workspaceId}/inbox`;
     await page.setViewportSize({ width: 390, height: 900 });
     await page.goto(`${inbox}?kind=mention`);
     const trigger = page.getByRole("button", { name: "Open menu", exact: true });
     await trigger.click();
     const menu = page.getByRole("dialog", { name: "Menu" });
     await menu.getByRole("link", { name: /^Inbox/ }).press("Enter");
     await expect(page).toHaveURL(inbox);
     await expect(menu).toHaveCount(0);
     await expect(trigger).toBeFocused();
   });
   ```

- [ ] **Step 6: Run the whole Inbox entry spec**

Run: `KM_E2E_PORT=3611 KM_E2E_BUILD_CACHE=true npm run test:e2e -- inbox-entry.spec.ts`

Expected: PASS, including both new regressions and the phone Menu case.

- [ ] **Step 7: Commit**

```bash
git add src/components/shell/app-shell.tsx src/components/shell/primary-nav.tsx tests/e2e/inbox-entry.spec.ts
git commit -m "Keep the workspace sidebar still when opening Inbox"
```

## Task 2: Re-point the specs that used the forced compact layout

**Files:**
- Modify: `tests/e2e/global-inbox-activity.spec.ts:29,69-96`
- Modify: `tests/e2e/retrieval-layout.spec.ts:102-127`
- Modify: `tests/e2e/user-guide-screenshots.spec.ts:173`

**Interfaces:**
- Consumes: the Task 1 shell contract (sidebar stays `272px` expanded, `48px` collapsed, no desktop Inbox drawer).
- Produces: no product interfaces; only test viewport and assertion changes.

- [ ] **Step 1: Keep the split/index flow in `global-inbox-activity.spec.ts`**

Change the viewport at line 29 from `1440` to `1512`, so the Inbox box is `1240px` and the split still appears with the sidebar expanded.

Replace the block from `// At 1440px, the menu overlays...` through the second `expect(await discussion.boundingBox()).toEqual(before);` (lines 69-96) with:

```ts
  // The desktop control collapses the rail in place: it is not a Menu, and the
  // selected discussion stays selected.
  const sidebar = page.locator('aside:has(nav[aria-label="Primary"])');
  const pane = page.locator('#kh-workspace-main');
  const discussion = pane.locator('section[aria-label="Selected discussion"]');
  await expect(sidebar).toHaveCSS("width", "272px");
  await expect(pane).toHaveCSS("width", "1240px");

  await sidebar.getByRole("button", { name: "Collapse navigation", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "48px");
  await expect(pane).toHaveCSS("width", "1464px");
  await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toHaveCount(0);
  await expect(discussion).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]item=${thread.id}(&|$)`));

  await sidebar.getByRole("button", { name: "Expand navigation", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "272px");
  await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toHaveCount(0);
  await expect(discussion).toBeVisible();
```

- [ ] **Step 2: Run the Inbox index spec**

Run: `KM_E2E_PORT=3611 KM_E2E_BUILD_CACHE=true npm run test:e2e -- global-inbox-activity.spec.ts`

Expected: PASS; the split opens at `1512px`, and collapsing the sidebar does not open a Menu or lose the selection.

- [ ] **Step 3: Use the real narrow layout in `retrieval-layout.spec.ts`**

In `"Recent menu is closed on drawer reopening and page reload"`, change the viewport from `1100` to `900`, rename `expand` to `trigger`, and initialize it as:
```ts
const trigger = page.getByRole("button", { name: "Open menu", exact: true });
```
Replace every remaining `expand` reference in that test with `trigger`. The rest of the test is unchanged.

- [ ] **Step 4: Capture the Inbox split at its real width in `user-guide-screenshots.spec.ts`**

Change `await page.setViewportSize({width:1440,height:1000});` to `{width:1512,height:1000}` so the selected discussion pane exists while the sidebar is expanded.

- [ ] **Step 5: Run the remaining affected specs**

Run: `KM_E2E_PORT=3611 KM_E2E_BUILD_CACHE=true npm run test:e2e -- retrieval-layout.spec.ts`

Expected: PASS.

Run: `KM_E2E_PORT=3611 KM_E2E_BUILD_CACHE=true npm run test:e2e -- user-guide-screenshots.spec.ts`

Expected: SKIP without `KM_GUIDE_CAPTURE`; no failure.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/global-inbox-activity.spec.ts tests/e2e/retrieval-layout.spec.ts tests/e2e/user-guide-screenshots.spec.ts
git commit -m "Update Inbox E2E contracts for a still sidebar"
```

## Task 3: Update the design record and verify the branch

**Files:**
- Modify: `docs/superpowers/specs/frontend-design-language.md:1911`
- Modify: `docs/superpowers/specs/2026-10-29-inbox-split-view-design.md:32-46`
- Modify: `docs/superpowers/specs/2026-11-20-inbox-sidebar-stability-design.md:3`
- Add: `docs/superpowers/plans/2026-11-20-inbox-sidebar-stability.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the committed design record for the behavior shipped in Tasks 1 and 2.

- [ ] **Step 1: Correct the design language**

In `frontend-design-language.md`, replace:
```
At 1024–1471px, Inbox uses this compact width and opens the full workspace sidebar in the Menu drawer so its discussion list and preview have room.
```
with:
```
Inbox never changes the sidebar's width or mode: entering it keeps the reader's expanded or collapsed choice, and the Menu is only the below-1024px layout.
```

Then, after the sentence beginning `Where its own box is at least 75rem wide`, add:
```
The 272px sidebar counts against that box, so a 1440px window shows the plain list until the reader collapses the sidebar; entering Inbox never collapses it.
```

- [ ] **Step 2: Amend the split-view spec**

In `2026-10-29-inbox-split-view-design.md`, after the Layout bullets that end with the 1440/1280 window sizes, add:

```markdown
**2026-11-20 amendment:** since #376 the workspace sidebar occupies 272px of the window, so the Inbox box at 1440px is about 73rem, not 79rem, and the plain list shows while the sidebar is expanded. Entering Inbox no longer collapses the sidebar; the split still appears whenever the box itself reaches 75rem, including after the reader collapses the sidebar.
```

- [ ] **Step 3: Mark the design approved**

Change the first line of `2026-11-20-inbox-sidebar-stability-design.md` from `Short design, awaiting approval. 2026-11-20.` to `Approved 2026-11-20. Short design.`

- [ ] **Step 4: Verify the whole branch**

Run each and confirm the stated result:

```bash
git diff --check
npm run lint
npm run typecheck
npm run test:unit -- --exclude tests/unit/graph-canvas.test.tsx
KM_E2E_PORT=3611 KM_E2E_BUILD_CACHE=true npm run test:e2e -- inbox-entry.spec.ts global-inbox-activity.spec.ts retrieval-layout.spec.ts
```

Expected: `git diff --check` prints nothing; lint and typecheck exit 0; unit tests pass with the pre-existing untracked GraphCanvas test excluded; all three E2E specs pass.

- [ ] **Step 5: Commit the design record**

```bash
git add docs/superpowers/specs/frontend-design-language.md docs/superpowers/specs/2026-10-29-inbox-split-view-design.md docs/superpowers/specs/2026-11-20-inbox-sidebar-stability-design.md docs/superpowers/plans/2026-11-20-inbox-sidebar-stability.md
git commit -m "Record the still sidebar contract for Inbox"
```

- [ ] **Step 6: Whole-branch review**

Dispatch one fresh-context reviewer over `origin/main..HEAD` with the spec and plan. Focus: the four Review Focus cases above, no dead ref plumbing, no desktop Menu on Inbox, and no Inbox layout change. Fix any Critical or Important finding, then push the branch and open a PR against `main`; do not merge without approval.
