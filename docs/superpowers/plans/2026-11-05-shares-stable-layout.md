# Shares Stable Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Shares section tabs still across the three sections, and give the workspace shell a single vertical scroll layer.

**Architecture:** Compose the header, the section tabs, and the section's description in one server component (`SharesHeader`) so the tabs sit directly under the fixed title line. Give the shell's scroll pane `position: relative` so absolutely positioned descendants stay inside it instead of growing the document.

**Tech Stack:** Next.js App Router, React server/client components, Tailwind, Playwright e2e, Vitest unit tests.

**Spec:** `docs/superpowers/specs/2026-11-05-shares-stable-layout-design.md`

**Worktree:** `/Users/chuntsai/Projects/km-wt-shares` (branch `fix/shares-tabs-stable`), from `origin/main`.

## Global Constraints

- No new dependencies, tokens, or copy changes.
- `SharesHeader` must stay server-compatible: no hooks, no `"use client"`.
- The three section descriptions stay exactly as they are today.
- Do not change `PageHeader` or any other page that uses it.
- Do not touch `/s/<token>` standalone readers; they scroll the window by design.

## Review Focus

- A long description at 320px must push content below the tabs, never move the tabs.
- A one-line description at 1440px must not introduce blank reserved space.
- The shell at 800×600 with a short list must not gain document scroll as a side effect.
- Workspace pages that own their scroll pane (`data-document-pane`, Inbox) must keep working after `main` becomes positioned.
- Clicking a tab must not move that tab out from under the pointer on any section.

---

### Task 1: Keep the section tabs still

**Files:**
- Modify: `src/components/knowledge/shares-navigation.tsx`
- Modify: `src/components/knowledge/share-management-view.tsx:100-101`
- Modify: `src/components/knowledge/saved-shares-view.tsx:37-38`
- Modify: `src/components/knowledge/followed-discussions-view.tsx:40-41`
- Test: `tests/e2e/shares-layout.spec.ts` (create)

**Interfaces:**
- Consumes: `PageHeader` from `@/components/shell/page-header`; existing `SharesNavigation`.
- Produces: `SharesHeader({ workspaceId, active, discussionsUnread?, description })`, where `active` is `"mine" | "saved" | "discussions"` and `description` is the section sentence. Later tasks do not depend on it.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/shares-layout.spec.ts`:

```ts
import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

test("the Shares sections keep their tab row at the same height", async ({ page, request }) => {
  const origin = phase3Origin("reviewOwner");
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 390, height: 844 });
  const sections = [
    { path: "", description: "Manage links to your documents and folders." },
    { path: "?tab=saved", description: "Keep articles shared with you within reach." },
    { path: "?tab=discussions", description: "Discussions you follow on shared articles." },
  ];
  const tops: number[] = [];
  for (const section of sections) {
    await page.goto(`${origin}/w/${doc.workspaceId}/shares${section.path}`);
    const nav = page.getByRole("navigation", { name: "Shares sections" });
    await expect(nav).toBeVisible();
    await expect(page.getByText(section.description, { exact: false })).toBeVisible();
    tops.push((await nav.boundingBox())!.y);
  }
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/shares-layout.spec.ts`
Expected: FAIL — `Math.max(...tops) - Math.min(...tops)` is about one line (~20px) because the Discussions description wraps to fewer lines.

- [ ] **Step 3: Add `SharesHeader` and use it in the three views**

In `src/components/knowledge/shares-navigation.tsx`, add the import and the component below `SharesNavigation`:

```tsx
import { PageHeader } from "@/components/shell/page-header";

export function SharesHeader({ workspaceId, active, discussionsUnread = 0, description }: { workspaceId: string; active: "mine" | "saved" | "discussions"; discussionsUnread?: number; description: string }) {
  return (
    <>
      <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Shares" />
      <SharesNavigation workspaceId={workspaceId} active={active} discussionsUnread={discussionsUnread} />
      <p className="mt-3 text-body-sm text-kh-text-muted">{description}</p>
    </>
  );
}
```

In each view, replace the `PageHeader` + `SharesNavigation` pair with one `SharesHeader`, keeping that view's exact description string:

- `share-management-view.tsx`: `active="mine"`, description `"Manage links to your documents and folders. An active link opens the latest saved content: for anyone holding it, or, for a link to specific people, only for them after signing in."`
- `saved-shares-view.tsx`: `active="saved"`, description `"Keep articles shared with you within reach. Saving a link does not extend its access or add it to your workspace favorites."`
- `followed-discussions-view.tsx`: `active="discussions"`, description `"Discussions you follow on shared articles. Following never extends a link's access."`

Remove the now-unused `PageHeader` import from each view and import `SharesHeader` from `./shares-navigation` instead of `SharesNavigation`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:e2e -- tests/e2e/shares-layout.spec.ts`
Expected: PASS.

Run: `npx vitest run tests/unit/share-management-view.test.tsx tests/unit/saved-shares-view.test.tsx tests/unit/followed-discussions-view.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/shares-navigation.tsx src/components/knowledge/share-management-view.tsx src/components/knowledge/saved-shares-view.tsx src/components/knowledge/followed-discussions-view.tsx tests/e2e/shares-layout.spec.ts docs/superpowers/specs/2026-11-05-shares-stable-layout-design.md
git commit -m "fix(shares): keep the section tabs still across sections"
```

### Task 2: One scroll layer in the shell

**Files:**
- Modify: `src/components/shell/app-shell.tsx:118`
- Test: `tests/e2e/shares-layout.spec.ts` (append)

**Interfaces:**
- Consumes: the `#kh-workspace-main` element rendered by `AppShell`.
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/shares-layout.spec.ts`:

```ts
test("a long Shares list scrolls the pane, not the document", async ({ page, request }) => {
  const origin = phase3Origin("reviewOwner");
  let doc;
  for (let index = 0; index < 8; index += 1) doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(`${origin}/w/${doc!.workspaceId}/shares`);
  await expect(page.getByRole("list", { name: "Share links" }).getByRole("listitem")).toHaveCount(16);

  const before = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    windowHeight: document.documentElement.clientHeight,
  }));
  expect(before.documentHeight).toBe(before.windowHeight);
  await page.evaluate(() => window.scrollTo(0, 500));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const main = page.locator("#kh-workspace-main");
  await main.evaluate((element) => { element.scrollTop = 300; });
  expect(await main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/shares-layout.spec.ts --grep "long Shares list"`
Expected: FAIL on `expect(before.documentHeight).toBe(before.windowHeight)` — about 940 vs 600.

- [ ] **Step 3: Position the shell's scroll pane**

In `src/components/shell/app-shell.tsx`, add `relative` to the existing `<main>` class list:

```tsx
<main id="kh-workspace-main" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-kh-bg outline-none has-[[data-document-pane]]:overflow-hidden">
```

Nothing else changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:e2e -- tests/e2e/shares-layout.spec.ts`
Expected: both tests PASS.

Run: `npm run test:e2e -- tests/e2e/saved-shares.spec.ts tests/e2e/my-shares-unread.spec.ts tests/e2e/document-topbar.spec.ts`
Expected: PASS (the shell's pages and a document pane still work).

Run: `npm run typecheck`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/app-shell.tsx tests/e2e/shares-layout.spec.ts
git commit -m "fix(shell): keep absolute content inside the workspace scroll pane"
```
