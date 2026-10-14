# One Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the primary rail and the Knowledge explorer with one Notion-style sidebar that holds navigation and the document tree on every workspace page, resizes by drag, collapses to nothing and peeks back from the left edge.

**Architecture:** The workspace layout reads every source's tree once (`getWorkspaceExplorerModel`) and hands it to `AppShell`. `AppShell` renders exactly one `Sidebar` — inside a `SidebarFrame` on a wide window, inside the `Drawer` on a narrow one — so tree state, persisted keys and element IDs are never duplicated. The Knowledge route layout keeps only its not-found decision.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind (replaced scales — see the design-language contract), Base UI menus, Vitest (node environment), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-notion-sidebar-design.md`

## Global Constraints

- Width: default 256px, min 220px, max 400px, keyboard step 16px; stored in `localStorage` key `kh:nav-width`.
- Collapsed state stays in `kh:nav-collapsed` (existing key; existing readers' choice must keep).
- Peek: only while collapsed and only where `(hover: hover)` matches; 8px left-edge strip; leaves ~300ms after the pointer; Esc hides at once.
- Rows stay 32px (`min-h-8`), controls 24px (`size: "sm"`). Group labels stay `text-caption font-medium text-kh-text-muted`.
- No new type, radius, shadow or duration token. Tailwind's default spellings (`text-sm`, `rounded`, `shadow-sm`, `duration-150`) compile to nothing here: use `text-body`, `text-caption`, `rounded-md`, `shadow-popover`, `duration-160`, `ease-out`.
- Colour only through `--kh-*` variables in `src/app/globals.css`.
- `--bg-explorer` (`--kh-bg-explorer`, `bg-kh-bg-explorer`) is retired.
- Keep these accessible names unchanged so existing tests and habits keep working: `Collapse navigation`, `Expand navigation`, `Knowledge explorer` (as an `<aside>`), `Document tree`, `Knowledge tree`, `Primary` (the top navigation group).
- No access rule changes: every read still goes through the caller-authorized query services.
- `npm` is shadowed by an nvm shell function in non-interactive shells; run tests through `make` targets or `npx`, and never pipe a test command (a pipe hides its exit code).
- Every commit message ends with:
  `Claude-Session: https://claude.ai/code/session_014fd1k5oJxuzWQ3nAkpZFRE`

---

## File map

| File | Responsibility |
| --- | --- |
| `src/components/shell/nav-width.ts` (new) | Width bounds, clamp, stored-value guard, keyboard step. Pure. |
| `src/components/shell/primary-nav-items.ts` (new) | Which navigation items a workspace shows, split `top`/`bottom`. Pure. |
| `src/components/shell/use-is-wide.ts` (new) | `(min-width: 1024px)` as a hook; server snapshot `true`. |
| `src/components/shell/sidebar.tsx` (new) | The sidebar's content. |
| `src/components/shell/sidebar-frame.tsx` (new) | Collapse, expand button, peek, resize handle. |
| `src/server/knowledge-read.ts` | `getWorkspaceExplorerModel`. |
| `src/app/w/[workspaceId]/layout.tsx` | Reads the explorer model, passes it to `AppShell`. |
| `src/app/w/[workspaceId]/knowledge/[sourceId]/layout.tsx` | Not-found only. |
| `src/components/shell/app-shell.tsx` | One sidebar instance; dialog hosts. |
| `src/components/shell/primary-nav.tsx` | Renders one group; no `compact`. |
| `src/components/shell/workspace-selector.tsx`, `src/components/search/search-nav-item.tsx`, `src/components/shell/user-menu.tsx` | `compact` removed. |
| `src/components/shell/navigation-context.tsx` | `mobileExplorerTarget` removed. |
| `src/components/knowledge/knowledge-layout.tsx` | Content container only. |
| `src/components/knowledge/source-sidebar.tsx` | Documents section: no own scroll/background; hover controls; `+` menus. |
| `src/components/knowledge/knowledge-tree.tsx` | Reveal scrolls the sidebar's scroll region; folder `+`. |
| `src/components/actions/action-menu.tsx` | `RowActionsTrigger` gains an `add` variant. |
| `src/components/knowledge/personal-home.tsx` | Its own `ShareLinkDialogHost` goes (the shell hosts one). |
| `src/components/shell/page-header.tsx` | `data-top-line` on its top row. |
| `src/app/globals.css`, `tailwind.config.ts`, `docs/superpowers/specs/frontend-design-language.md` | Token retirement and contract text. |
| `tests/unit/nav-width.test.ts`, `tests/unit/primary-nav-items.test.ts`, `tests/unit/workspace-explorer-model.test.ts` (new) | Unit tests. |
| `tests/e2e/zz-notion-sidebar.spec.ts` (new) | Behaviour of the new sidebar. |
| `tests/e2e/*` (existing, listed in Task 3/5) | Selector updates. |

---

### Task 1: Pure helpers — width and navigation items

**Files:**
- Create: `src/components/shell/nav-width.ts`
- Create: `src/components/shell/primary-nav-items.ts`
- Test: `tests/unit/nav-width.test.ts`
- Test: `tests/unit/primary-nav-items.test.ts`

**Interfaces:**
- Produces:
  - `NAV_WIDTH: { min: 220; max: 400; default: 256; step: 16 }`
  - `clampNavWidth(value: number): number`
  - `isNavWidth(value: unknown): value is number`
  - `nextNavWidth(current: number, key: string): number | null`
  - `type NavGroup = "top" | "bottom"`
  - `type NavItem = { name: string; href: string; Icon: LucideIcon }`
  - `primaryNavItems(workspaceId: string, access: NavAccess, group: NavGroup): NavItem[]` where `NavAccess = Pick<WorkspaceAccessView, "workspace" | "actions">`

- [ ] **Step 1: Write the failing tests**

`tests/unit/nav-width.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NAV_WIDTH, clampNavWidth, isNavWidth, nextNavWidth } from "@/components/shell/nav-width";

describe("sidebar width", () => {
  it("defaults to 256 within 220–400", () => {
    expect(NAV_WIDTH).toEqual({ min: 220, max: 400, default: 256, step: 16 });
  });

  it("clamps a dragged width to the bounds and rounds it", () => {
    expect(clampNavWidth(100)).toBe(220);
    expect(clampNavWidth(999)).toBe(400);
    expect(clampNavWidth(300.6)).toBe(301);
    expect(clampNavWidth(220)).toBe(220);
    expect(clampNavWidth(400)).toBe(400);
  });

  it("accepts only a finite stored number inside the bounds", () => {
    expect(isNavWidth(256)).toBe(true);
    expect(isNavWidth(220)).toBe(true);
    expect(isNavWidth(400)).toBe(true);
    for (const bad of [219, 401, Number.NaN, Number.POSITIVE_INFINITY, "256", null, undefined, {}]) {
      expect(isNavWidth(bad)).toBe(false);
    }
  });

  it("steps 16px with the arrow keys and stops at the bounds", () => {
    expect(nextNavWidth(256, "ArrowRight")).toBe(272);
    expect(nextNavWidth(256, "ArrowLeft")).toBe(240);
    expect(nextNavWidth(396, "ArrowRight")).toBe(400);
    expect(nextNavWidth(224, "ArrowLeft")).toBe(220);
  });

  it("ignores every other key", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "a"]) expect(nextNavWidth(256, key)).toBeNull();
  });
});
```

`tests/unit/primary-nav-items.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { primaryNavItems, type NavAccess } from "@/components/shell/primary-nav-items";

function access(type: "PERSONAL" | "TEAM", actions: Partial<Record<"canInspectSources" | "canSearch" | "canOpenSettings", boolean>>): NavAccess {
  return {
    workspace: { type },
    actions: { canInspectSources: false, canSearch: false, canOpenSettings: false, ...actions },
  } as unknown as NavAccess;
}

const names = (items: { name: string }[]) => items.map((item) => item.name);
const everything = { canInspectSources: true, canSearch: true, canOpenSettings: true };

describe("primary navigation items", () => {
  it("puts Home and Graph on top in a personal workspace", () => {
    expect(names(primaryNavItems("w1", access("PERSONAL", everything), "top"))).toEqual(["Home", "Graph"]);
  });

  it("has no Home in a team workspace", () => {
    expect(names(primaryNavItems("w1", access("TEAM", everything), "top"))).toEqual(["Graph"]);
  });

  it("never lists Knowledge: the tree is the Knowledge navigation", () => {
    for (const type of ["PERSONAL", "TEAM"] as const) {
      for (const group of ["top", "bottom"] as const) {
        expect(names(primaryNavItems("w1", access(type, everything), group))).not.toContain("Knowledge");
      }
    }
  });

  it("puts the low-frequency destinations in the bottom group, personal", () => {
    expect(names(primaryNavItems("w1", access("PERSONAL", everything), "bottom"))).toEqual(["Sources", "Shares", "Insights", "Settings"]);
  });

  it("shows only Sources and Settings at the bottom of a team workspace", () => {
    expect(names(primaryNavItems("w1", access("TEAM", everything), "bottom"))).toEqual(["Sources", "Settings"]);
  });

  it("drops Settings without canOpenSettings and Sources without canInspectSources", () => {
    expect(names(primaryNavItems("w1", access("TEAM", { canSearch: true }), "bottom"))).toEqual([]);
    expect(names(primaryNavItems("w1", access("PERSONAL", { canOpenSettings: true }), "bottom"))).toEqual(["Insights", "Settings"]);
  });

  it("drops Shares without canSearch", () => {
    expect(names(primaryNavItems("w1", access("PERSONAL", { canInspectSources: true, canOpenSettings: true }), "bottom"))).toEqual(["Sources", "Insights", "Settings"]);
  });

  it("scopes every href to the workspace", () => {
    const all = [...primaryNavItems("abc", access("PERSONAL", everything), "top"), ...primaryNavItems("abc", access("PERSONAL", everything), "bottom")];
    expect(all.map((item) => item.href)).toEqual([
      "/w/abc/home", "/w/abc/graph", "/w/abc/sources", "/w/abc/shares", "/w/abc/profile", "/w/abc/settings",
    ]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/nav-width.test.ts tests/unit/primary-nav-items.test.ts`
Expected: FAIL — cannot resolve `@/components/shell/nav-width` / `primary-nav-items`.

- [ ] **Step 3: Implement**

`src/components/shell/nav-width.ts`:

```ts
/** The sidebar's width: dragged or stepped between these bounds, kept as `kh:nav-width`. */
export const NAV_WIDTH = { min: 220, max: 400, default: 256, step: 16 } as const;

export function clampNavWidth(value: number): number {
  return Math.min(NAV_WIDTH.max, Math.max(NAV_WIDTH.min, Math.round(value)));
}

/** A stored value outside the bounds is not trusted; the reader gets the default back. */
export function isNavWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= NAV_WIDTH.min && value <= NAV_WIDTH.max;
}

export function nextNavWidth(current: number, key: string): number | null {
  if (key === "ArrowRight") return clampNavWidth(current + NAV_WIDTH.step);
  if (key === "ArrowLeft") return clampNavWidth(current - NAV_WIDTH.step);
  return null;
}
```

`src/components/shell/primary-nav-items.ts`:

```ts
import { Database, Home, Network, Settings, Share2, UserRound, type LucideIcon } from "lucide-react";
import type { WorkspaceAccessView } from "@/server/workspace-admin";

export type NavGroup = "top" | "bottom";
export type NavItem = { name: string; href: string; Icon: LucideIcon };
export type NavAccess = Pick<WorkspaceAccessView, "workspace" | "actions">;

/**
 * The sidebar's navigation. `top` sits above the tree and is always on screen; `bottom` scrolls after
 * it, because a group pinned to the bottom either floats far below a short tree or takes room from a
 * long one. There is no Knowledge item: the tree is the Knowledge navigation.
 */
export function primaryNavItems(workspaceId: string, access: NavAccess, group: NavGroup): NavItem[] {
  const base = `/w/${workspaceId}`;
  const personal = access.workspace.type === "PERSONAL";
  if (group === "top") {
    return [
      ...(personal ? [{ name: "Home", href: `${base}/home`, Icon: Home }] : []),
      { name: "Graph", href: `${base}/graph`, Icon: Network },
    ];
  }
  return [
    ...(access.actions.canInspectSources ? [{ name: "Sources", href: `${base}/sources`, Icon: Database }] : []),
    ...(personal && access.actions.canSearch ? [{ name: "Shares", href: `${base}/shares`, Icon: Share2 }] : []),
    ...(personal ? [{ name: "Insights", href: `${base}/profile`, Icon: UserRound }] : []),
    ...(access.actions.canOpenSettings ? [{ name: "Settings", href: `${base}/settings`, Icon: Settings }] : []),
  ];
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/nav-width.test.ts tests/unit/primary-nav-items.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/nav-width.ts src/components/shell/primary-nav-items.ts tests/unit/nav-width.test.ts tests/unit/primary-nav-items.test.ts
git commit -m "feat(shell): sidebar width bounds and the two navigation groups

Claude-Session: https://claude.ai/code/session_014fd1k5oJxuzWQ3nAkpZFRE"
```

---

### Task 2: Workspace explorer model

**Files:**
- Modify: `src/server/knowledge-read.ts` (add after `getKnowledgeExplorerModel`, ~line 143)
- Test: `tests/unit/workspace-explorer-model.test.ts`

**Interfaces:**
- Produces:
  - `type WorkspaceExplorerModel = { collections: { source: SourceView; tree: KnowledgeTreeItem[] }[] }`
  - `getWorkspaceExplorerModel(workspaceId: string): Promise<WorkspaceExplorerModel | null>` (wrapped in React `cache`)

- [ ] **Step 1: Write the failing test**

`tests/unit/workspace-explorer-model.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = {
  workspaces: { listWorkspaces: vi.fn() },
  queries: { listSources: vi.fn(), listTree: vi.fn() },
};
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({ ...services, establishTrustedCaller: async () => ({ caller: "caller" }) }),
}));

import { getWorkspaceExplorerModel } from "@/server/knowledge-read";

const source = (id: string, name: string) => ({ id, workspaceId: "w1", name, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0 });

beforeEach(() => {
  services.workspaces.listWorkspaces.mockReset().mockResolvedValue([{ id: "w1" }]);
  services.queries.listSources.mockReset().mockResolvedValue([source("b", "Wiki"), source("a", "Notes")]);
  services.queries.listTree.mockReset().mockImplementation(async (_caller: unknown, sourceId: string) => [{ type: "folder", id: `${sourceId}-f`, parentId: null, label: "F", position: 0, status: "ACTIVE" }]);
});

describe("getWorkspaceExplorerModel", () => {
  it("lists every source by name, each with its tree, archived included", async () => {
    const model = await getWorkspaceExplorerModel("w1");
    expect(model?.collections.map((collection) => collection.source.name)).toEqual(["Notes", "Wiki"]);
    expect(model?.collections[0].tree[0].id).toBe("a-f");
    expect(services.queries.listSources).toHaveBeenCalledWith("caller", "w1", { includeArchived: true });
    expect(services.queries.listTree).toHaveBeenCalledWith("caller", "a", { includeArchived: true });
    expect(services.queries.listTree).toHaveBeenCalledWith("caller", "b", { includeArchived: true });
  });

  it("is an empty list for a workspace with no sources", async () => {
    services.queries.listSources.mockResolvedValue([]);
    expect(await getWorkspaceExplorerModel("w1")).toEqual({ collections: [] });
    expect(services.queries.listTree).not.toHaveBeenCalled();
  });

  it("is null for a workspace the caller is not in, and reads nothing of it", async () => {
    expect(await getWorkspaceExplorerModel("other")).toBeNull();
    expect(services.queries.listSources).not.toHaveBeenCalled();
  });

  it("is null when a read is refused", async () => {
    services.queries.listTree.mockRejectedValue(new Error("denied"));
    expect(await getWorkspaceExplorerModel("w1")).toBeNull();
  });
});
```

Note: `cache` from React is a no-op outside a server request, so each call reads afresh.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/workspace-explorer-model.test.ts`
Expected: FAIL — `getWorkspaceExplorerModel` is not exported.

- [ ] **Step 3: Implement** — in `src/server/knowledge-read.ts`, after `getKnowledgeExplorerModel`:

```ts
export type WorkspaceExplorerModel = {
  collections: { source: SourceView; tree: KnowledgeTreeItem[] }[];
};

/**
 * Every source's tree, for the sidebar on every workspace page. Read by the workspace layout, which is
 * not re-fetched on navigation inside the workspace — only on entering it and on `router.refresh()`.
 * Archived nodes are included; the sidebar hides them unless `?includeArchived=true`.
 */
export const getWorkspaceExplorerModel = cache(async (workspaceId: string): Promise<WorkspaceExplorerModel | null> => {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  try {
    const workspaces = await services.workspaces.listWorkspaces(caller);
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) return null;
    const sources = sortSourcesByName(await services.queries.listSources(caller, workspaceId, { includeArchived: true }));
    const collections = await Promise.all(sources.map(async (source) => ({
      source,
      tree: await services.queries.listTree(caller, source.id, { includeArchived: true }),
    })));
    return { collections };
  } catch {
    return null;
  }
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/workspace-explorer-model.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/knowledge-read.ts tests/unit/workspace-explorer-model.test.ts
git commit -m "feat(knowledge): read every source's tree for the workspace sidebar

Claude-Session: https://claude.ai/code/session_014fd1k5oJxuzWQ3nAkpZFRE"
```

---

### Task 3: One sidebar in the shell

This is the structural move. Afterwards there is one sidebar on every workspace page, it collapses to zero width, and the explorer no longer lives in the Knowledge layout. Resize and peek come in Task 4; hover controls in Task 5.

**Files:**
- Create: `src/components/shell/use-is-wide.ts`, `src/components/shell/sidebar.tsx`, `src/components/shell/sidebar-frame.tsx`
- Modify: `src/app/w/[workspaceId]/layout.tsx`, `src/app/w/[workspaceId]/knowledge/[sourceId]/layout.tsx`
- Modify: `src/components/shell/app-shell.tsx`, `primary-nav.tsx`, `workspace-selector.tsx`, `user-menu.tsx`, `navigation-context.tsx`, `page-header.tsx`
- Modify: `src/components/search/search-nav-item.tsx`
- Modify: `src/components/knowledge/knowledge-layout.tsx`, `source-sidebar.tsx`, `knowledge-tree.tsx:266`, `personal-home.tsx:24,187`
- Modify: `src/app/globals.css` (one rule)
- Create: `tests/e2e/zz-notion-sidebar.spec.ts`
- Modify (selectors): `tests/e2e/phase2.5-routing.spec.ts`, `knowledge-browser.spec.ts`, `archived-source-active-doc.spec.ts`, `linear-remediation.spec.ts`, `account-navigation.spec.ts`, `keyboard-shortcuts.spec.ts`, `phase3-workspace-governance.spec.ts`, `tree-arrangement.spec.ts`, `zz-sidebar-comparison.spec.ts`

**Interfaces:**
- Consumes: `primaryNavItems`, `NavGroup` (Task 1); `getWorkspaceExplorerModel`, `WorkspaceExplorerModel` (Task 2).
- Produces:
  - `useIsWide(): boolean`
  - `Sidebar({ model, explorer, onCollapse? }: { model: WorkspaceShellModel; explorer: WorkspaceExplorerModel | null; onCollapse?: () => void })`
  - `SidebarFrame({ collapsed, onExpand, children }: { collapsed: boolean; onExpand: () => void; children: ReactNode })`
  - `AppShell({ model, explorer, children })`
  - `PrimaryNav({ workspaceId, group, onNavigate? })`
  - `SourceSidebar({ workspaceId, currentSourceId, collections })`
  - The sidebar's scroll region carries `data-sidebar-scroll`.

- [ ] **Step 1: Write the failing e2e spec** — `tests/e2e/zz-notion-sidebar.spec.ts`:

```ts
import { expect, test } from "./fixtures/test";
import { mySpace } from "./fixtures/organize";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const ROUND_TRIP = { timeout: 15_000 };

test.describe("one sidebar", () => {
  test("the tree is on a page that is not Knowledge, and opening a document from it keeps what was expanded", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    const tree = page.getByRole("tree", { name: "Knowledge tree" });
    await expect(tree).toBeVisible(ROUND_TRIP);
    const folder = tree.getByRole("treeitem", { name: "Runbooks", exact: true });
    // Folders may start open or closed depending on what an earlier spec left; make sure this one is open.
    if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.getByRole("button", { name: "Runbooks", exact: true }).click();
    await expect(folder).toHaveAttribute("aria-expanded", "true");
    const document = folder.getByRole("treeitem").first().getByRole("link").first();
    await document.click();
    await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+/, ROUND_TRIP);
    await expect(tree.getByRole("treeitem", { name: "Runbooks", exact: true })).toHaveAttribute("aria-expanded", "true");
  });

  test("there is no Knowledge item; low-frequency destinations follow the tree", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Knowledge", exact: true })).toHaveCount(0);
    const tree = page.getByRole("tree", { name: "Knowledge tree" });
    const settings = page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Settings", exact: true });
    await expect(settings).toBeAttached();
    const [treeBox, settingsBox] = [await tree.boundingBox(), await settings.boundingBox()];
    expect(settingsBox!.y).toBeGreaterThan(treeBox!.y);
  });

  test("a team workspace shows no Home, Shares or Insights; My Space does", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    const nav = page.getByRole("complementary", { name: "Navigation" });
    for (const name of ["Home", "Shares", "Insights"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
    const personal = await mySpace(page);
    await page.goto(`/w/${personal}/home`);
    for (const name of ["Home", "Shares", "Insights"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible(ROUND_TRIP);
  });

  test("collapsed, the sidebar takes no width, and the choice survives a reload", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const aside = page.getByRole("complementary", { name: "Navigation" });
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Expand navigation" }).click();
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(256);
  });

  test("a narrow window's menu holds the tree", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("tree", { name: "Knowledge tree" })).toBeVisible(ROUND_TRIP);
    await expect(page.getByRole("tree", { name: "Knowledge tree" })).toHaveCount(1);
  });
});
```

If `ensureWorkspace` in `scripts/db/seed.ts` creates Query Master as anything other than a TEAM workspace, swap `QUERY_MASTER_WORKSPACE` in the third test for `0199f100-0000-7000-8000-000000000002` (SWFP) after checking its type there.

- [ ] **Step 2: Run it to verify it fails**

Run: `make test-e2e` is the full run; for this spec alone, after `make db-up`:
`npx playwright test tests/e2e/zz-notion-sidebar.spec.ts`
Expected: FAIL — on `/graph` there is no `Knowledge tree`, and the `Primary` nav has a `Knowledge` link.

- [ ] **Step 3: `use-is-wide.ts`**

```ts
"use client";

import { useSyncExternalStore } from "react";

const WIDE = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the sidebar is a column (wide) or the menu drawer (narrow). The server renders the column,
 * which CSS hides below 1024px, so a narrow first paint shows nothing that then moves.
 */
export function useIsWide(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => true);
}
```

- [ ] **Step 4: Remove `compact`**

`src/components/search/search-nav-item.tsx` — replace `SearchNavItem` with:

```tsx
/** Search as the sidebar's first row: drawn like the navigation beneath it, not as a field of its own. */
export function SearchNavItem() {
  return (
    <button
      type="button"
      onClick={requestQuickSearch}
      aria-label="Quick search"
      aria-keyshortcuts="Meta+K Control+K /"
      className="kh-control kh-focus-ring flex h-8 w-full items-center gap-2 rounded-md px-2 text-body text-kh-text-muted transition hover:bg-kh-bg-hover hover:text-kh-text"
    >
      <Search size={15} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">Search</span>
      <Kbd className="shrink-0">⌘K</Kbd>
    </button>
  );
}
```

Remove the now-unused `Tooltip` import.

`src/components/shell/workspace-selector.tsx`: drop the `compact` parameter, the `WorkspaceInitial`-only `compact ? … :` branch (keep the non-compact `MenuTrigger`), and the `Tooltip` import. The signature becomes `export function WorkspaceSelector({ workspaceId }: { workspaceId: string })`. Update the comment above it to: `// It heads the sidebar (and the Menu drawer), above the navigation it scopes.`

`src/components/shell/user-menu.tsx`: drop `compact` from the props; the trigger class becomes `trigger === "preferences" ? "" : "w-full justify-start gap-2"`; the name and chevron render unconditionally for `account`; the tooltip is `side="top"`. Update the comment `The rail is 160px` to `A long name is cut off in the sidebar; the tooltip says it whole.`

- [ ] **Step 5: `PrimaryNav` renders one group** — replace `src/components/shell/primary-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspaceAuthorization } from "./use-workspace-authorization";
import { primaryNavItems, type NavGroup } from "./primary-nav-items";

export function PrimaryNav({ workspaceId, group, onNavigate }: { workspaceId: string; group: NavGroup; onNavigate?: () => void }) {
  const { access } = useWorkspaceAuthorization();
  const pathname = usePathname();
  const items = primaryNavItems(workspaceId, access, group);
  if (items.length === 0) return null;
  // The current place is a neutral step above hover, not the accent: the accent marks what is selected in the
  // content (the tree's document, a menu's row), and two accent blocks side by side competed for the eye.
  return (
    <nav aria-label={group === "top" ? "Primary" : "Workspace"} className="flex flex-col gap-0.5">
      {items.map(({ name, href, Icon }) => {
        const selected = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={name}
            href={href}
            onClick={onNavigate}
            aria-current={selected ? "page" : undefined}
            className={`kh-control flex h-8 items-center gap-2 rounded-md px-2 text-body transition kh-focus-ring ${selected ? "bg-kh-bg-hover font-medium text-kh-text hover:bg-kh-bg-hover" : "text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text"}`}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: `SourceSidebar` becomes the Documents section**

In `src/components/knowledge/source-sidebar.tsx`:

1. Props: replace `source: SourceView; … selectedDocumentId?: string; includeArchived: boolean;` with `currentSourceId?: string;` (keep `workspaceId`, `collections`). Drop `useParams` for the source; keep it for `documentId`.
2. `visibleCollections`: `tree: showArchived ? collection.tree : withoutArchivedSubtrees(collection.tree)` (the shell always loads archived nodes).
3. Every `source.id` becomes `currentSourceId`:
   - `recentKeys`: `key !== \`${currentSourceId}:${resolvedDocumentId}\``
   - the record-open effect: `const key = currentSourceId && resolvedDocumentId ? documentShortcutKey(currentSourceId, resolvedDocumentId) : null;` and its dependency list uses `currentSourceId`.
   - default expansion: `expanded[candidate.id] ?? (currentSourceId === undefined || candidate.id === currentSourceId)` — outside Knowledge every source starts open.
4. Root element: keep `<aside aria-label="Knowledge explorer" aria-busy={!sidebarReady}>` (tests and habits name it) with class `flex w-full flex-col gap-3 px-2` — no `kh-sidebar-surface`, background, border, `h-full` or `min-h-0` (the sidebar owns those).
5. The inner `<nav aria-label="Document tree">`: class `space-y-1` — no `min-h-0 flex-1 overflow-y-auto overscroll-contain`; the sidebar's scroll region scrolls it.

In `src/components/knowledge/knowledge-tree.tsx:266` the reveal looked for the explorer's own scrolling `nav`; it now scrolls the sidebar's region:

```ts
    const scroller = tree.closest<HTMLElement>("[data-sidebar-scroll]");
```

- [ ] **Step 7: `Sidebar`** — `src/components/shell/sidebar.tsx`:

```tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { PanelLeftClose } from "lucide-react";
import type { WorkspaceExplorerModel, WorkspaceShellModel } from "@/server/knowledge-read";
import { NAV_TOGGLE_SHORTCUT } from "@/components/actions/action-registry";
import { SourceSidebar } from "@/components/knowledge/source-sidebar";
import { SearchNavItem } from "@/components/search/search-nav-item";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { PrimaryNav } from "./primary-nav";
import { UserMenu } from "./user-menu";
import { WorkspaceSelector } from "./workspace-selector";

/**
 * Navigation and the document tree in one column: a fixed head (workspace, Search, Home, Graph), one
 * scroll region (Favorites, Recent, Documents, then the low-frequency destinations), and the account row.
 * Rendered once — in the wide frame or in the narrow drawer, never both.
 */
export function Sidebar({ model, explorer, onCollapse }: { model: WorkspaceShellModel; explorer: WorkspaceExplorerModel | null; onCollapse?: () => void }) {
  const params = useParams();
  const currentSourceId = typeof params?.sourceId === "string" ? params.sourceId : undefined;
  const workspaceId = model.workspace.id;
  return (
    <div className="kh-sidebar-surface group/sidebar flex h-full min-h-0 flex-col bg-kh-bg-sunken">
      <div className="flex h-12 shrink-0 items-center gap-1 px-2">
        <div className="min-w-0 flex-1"><WorkspaceSelector workspaceId={workspaceId} /></div>
        {onCollapse ? (
          <Tooltip label="Collapse navigation" shortcut={NAV_TOGGLE_SHORTCUT} side="bottom">
            <button type="button" onClick={onCollapse} aria-label="Collapse navigation" aria-keyshortcuts={NAV_TOGGLE_SHORTCUT} className={buttonClasses({ variant: "ghost", icon: true, className: "opacity-0 focus-visible:opacity-100 group-hover/sidebar:opacity-100 [@media(hover:none)]:opacity-100" })}>
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-0.5 px-2">
        <SearchNavItem />
        <PrimaryNav workspaceId={workspaceId} group="top" />
      </div>
      <div data-sidebar-scroll className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {explorer ? <SourceSidebar workspaceId={workspaceId} currentSourceId={currentSourceId} collections={explorer.collections} /> : <ExplorerUnavailable />}
        <div className="mt-4 px-2 pb-2"><PrimaryNav workspaceId={workspaceId} group="bottom" /></div>
      </div>
      <div className="shrink-0 border-t border-kh-border p-2"><UserMenu identityName={model.identityName} workspaceId={workspaceId} /></div>
    </div>
  );
}

function ExplorerUnavailable() {
  const router = useRouter();
  return (
    <p role="status" className="px-4 py-2 text-body text-kh-text-muted">
      Documents could not be loaded.{" "}
      <button type="button" onClick={() => router.refresh()} className="underline kh-focus-ring">Retry</button>
    </p>
  );
}
```

- [ ] **Step 8: `SidebarFrame` (collapse only for now)** — `src/components/shell/sidebar-frame.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { PanelLeftOpen } from "lucide-react";
import { NAV_TOGGLE_SHORTCUT } from "@/components/actions/action-registry";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { NAV_WIDTH } from "./nav-width";

/**
 * The wide window's sidebar column. Collapsed is width 0 — the content stays mounted (and `inert`) so the
 * tree keeps what was expanded and scrolled — and an expand button floats on the pages' top line.
 */
export function SidebarFrame({ collapsed, onExpand, children }: { collapsed: boolean; onExpand: () => void; children: ReactNode }) {
  const width = NAV_WIDTH.default;
  return (
    <>
      <aside
        aria-label="Navigation"
        inert={collapsed}
        style={{ width: collapsed ? 0 : width }}
        className={`relative shrink-0 overflow-hidden border-kh-border transition-[width] duration-160 ease-out ${collapsed ? "" : "border-r"}`}
      >
        <div className="h-full" style={{ width }}>{children}</div>
      </aside>
      {collapsed ? (
        <div className="fixed left-2 top-2 z-30">
          <Tooltip label="Expand navigation" shortcut={NAV_TOGGLE_SHORTCUT} side="right">
            <button type="button" onClick={onExpand} aria-label="Expand navigation" aria-keyshortcuts={NAV_TOGGLE_SHORTCUT} className={buttonClasses({ variant: "ghost", icon: true })}>
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 9: `AppShell`** — in `src/components/shell/app-shell.tsx`:

1. Props: `{ model, explorer, children }: { model: WorkspaceShellModel; explorer: WorkspaceExplorerModel | null; children: ReactNode }`.
2. Remove `mobileExplorerTarget` state, the `PrimaryNav`/`WorkspaceSelector`/`SearchNavItem`/`UserMenu`/`PanelLeft*`/`buttonClasses` imports that move into `Sidebar`/`SidebarFrame`.
3. Add `const wide = useIsWide();`.
4. Provider value: `<NavigationContext.Provider value={{ closeNavigation: () => setNavOpen(false) }}>`.
5. Replace the `<aside …>…</aside>` block and the `<Drawer>` with:

```tsx
      <div className="flex min-h-0 flex-1">
        {wide ? (
          <SidebarFrame collapsed={navCollapsed} onExpand={toggleNav}>
            <Sidebar model={model} explorer={explorer} onCollapse={toggleNav} />
          </SidebarFrame>
        ) : null}
        <main data-nav-collapsed={wide && navCollapsed ? "" : undefined} className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-kh-bg has-[[data-document-pane]]:overflow-hidden">{authorization.revoked ? <p role="status">Workspace access changed. Returning to My Space…</p> : children}</main>
      </div>
      <Drawer side="left" open={navOpen && !wide} onOpenChange={setNavOpen} title="Menu">
        <div className="h-full min-h-0" onClick={(event) => {
          if ((event.target as HTMLElement).closest("a") && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setNavOpen(false);
        }}>
          {!wide ? <Sidebar model={model} explorer={explorer} /> : null}
        </div>
      </Drawer>
      <ShareLinkDialogHost />
      <FolderNameDialogHost />
      <MoveDialogHost collections={explorer?.collections ?? []} />
```

with imports:

```tsx
import type { WorkspaceExplorerModel } from "@/server/knowledge-read";
import { Sidebar } from "./sidebar";
import { SidebarFrame } from "./sidebar-frame";
import { useIsWide } from "./use-is-wide";
import { ShareLinkDialogHost } from "@/components/knowledge/share-link-dialog";
import { FolderNameDialogHost } from "@/components/knowledge/folder-name-dialog";
import { MoveDialogHost } from "@/components/knowledge/move-dialog";
```

`src/components/shell/navigation-context.tsx`:

```tsx
"use client";
import { createContext } from "react";

/** Lets a link inside the narrow drawer close it. */
export const NavigationContext = createContext<{ closeNavigation: () => void } | null>(null);
```

Run `grep -rn "mobileExplorerTarget\|NavigationContext" src` and remove any remaining use of `mobileExplorerTarget`.

- [ ] **Step 10: Layouts**

`src/app/w/[workspaceId]/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getWorkspaceExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>;
  children: ReactNode;
}) {
  const { workspaceId } = await params;
  const [model, explorer] = await Promise.all([getWorkspaceShellModel(workspaceId), getWorkspaceExplorerModel(workspaceId)]);
  if (!model) notFound();
  return <AppShell key={workspaceId} model={model} explorer={explorer}>{children}</AppShell>;
}
```

`src/app/w/[workspaceId]/knowledge/[sourceId]/layout.tsx` — the read becomes
`const model = await getKnowledgeExplorerModel(workspaceId, sourceId, { includeArchived: true });`, the comment above it becomes `// Only decides whether this source is here to read; the sidebar's trees come from the workspace layout.`, and the return is `<KnowledgeLayout>{children}</KnowledgeLayout>`.

`src/components/knowledge/knowledge-layout.tsx` — replace with:

```tsx
"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { InspectorContext } from "./inspector-context";
import { DocumentSkeleton } from "./knowledge-skeletons";
import { useScrollRestoration } from "./use-scroll-restoration";

export function KnowledgeLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useScrollRestoration(contentRef, pathname);

  useEffect(() => {
    const close = () => setInspectorOpen(false);
    window.addEventListener("kh:open-nav", close);
    return () => window.removeEventListener("kh:open-nav", close);
  }, []);

  return (
    <InspectorContext.Provider value={{ open: inspectorOpen, setOpen: setInspectorOpen }}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div ref={contentRef} className="min-h-0 flex-1 overflow-hidden overscroll-contain [&:not(:has([data-document-pane]))]:overflow-y-auto">
          <Suspense fallback={<DocumentSkeleton />}>{children}</Suspense>
        </div>
      </div>
    </InspectorContext.Provider>
  );
}
```

`src/components/knowledge/personal-home.tsx`: delete the `ShareLinkDialogHost` import (line 24) and its element (line 187) — the shell hosts one, and two would open two dialogs per request.

If `TreeSkeleton` is now unused (`grep -rn TreeSkeleton src`), leave it: a `loading.tsx` may still render it; delete only if the grep shows no caller.

- [ ] **Step 11: Top line clears the expand button**

`src/components/shell/page-header.tsx:30` — add `data-top-line` to that row's `div`. In `src/app/globals.css`, beside `.kh-sidebar-surface`:

```css
  /* Collapsed, the sidebar's expand button floats over the pages' top line; the line gives it room. */
  [data-nav-collapsed] [data-top-line] {
    padding-inline-start: 3rem;
  }
```

Then run `make dev`, collapse the sidebar at a 1024px-wide window, and open a document: if the floating button overlaps the document's breadcrumb (`document-header.tsx:77`) or the composer's top row (`document-composer.tsx:562`), add `data-top-line` to that row too.

- [ ] **Step 12: Update existing e2e selectors**

Run `grep -rnE "\"Knowledge\"|'Knowledge'|Knowledge Hub|Expand navigation|Collapse navigation|toBeLessThan\(48\)|name: \"Primary\"" tests/e2e` and apply:

| Old expectation | New expectation |
| --- | --- |
| `getByRole("link", { name: "Knowledge" })` visible in the rail (`phase2.5-routing.spec.ts:14-15,32`, `knowledge-browser.spec.ts:36`) | `getByRole("tree", { name: "Knowledge tree" })` visible |
| `getByText("Knowledge Hub", …).filter({ visible: true })` on a wide page (`phase2.5-routing.spec.ts:30`, `knowledge-browser.spec.ts:34`, `archived-source-active-doc.spec.ts:23`, `linear-remediation.spec.ts:53,57,175`) | `getByRole("button", { name: /^Workspace: / })` — the sidebar's head is the workspace selector. Keep each alignment assertion, measured against that button. |
| `linear-remediation.spec.ts:210` (menu's `Knowledge` link background) | the same assertion on `menu.getByRole("link", { name: "Graph", exact: true })` after navigating to `/graph` |
| `account-navigation.spec.ts:21` (collapsed account width `< 48`) | collapsed, the account button is not visible: `await expect(account()).not.toBeInViewport()` |
| `keyboard-shortcuts.spec.ts:116` (`rail` from `Primary` ancestor `aside`) | `page.getByRole("complementary", { name: "Navigation" })`; a collapsed rail's width is `0`, an expanded one `256` |
| `phase3-workspace-governance.spec.ts:293` (`Sources` in `Primary`) | `getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Sources", exact: true })` |
| `zz-sidebar-comparison.spec.ts:30` (`nav[aria-label="Primary"] a[aria-current]`) | unchanged selector; regenerate its baselines with `npx playwright test tests/e2e/zz-sidebar-comparison.spec.ts --update-snapshots` and look at every new image before committing it |

`tree-arrangement.spec.ts` keeps working unchanged (its labels are kept); run it to confirm.

- [ ] **Step 13: Run everything this task touches**

Run: `make verify`
Expected: unit, typecheck, lint, build all pass.

Run: `npx playwright test tests/e2e/zz-notion-sidebar.spec.ts tests/e2e/phase2.5-routing.spec.ts tests/e2e/knowledge-browser.spec.ts tests/e2e/archived-source-active-doc.spec.ts tests/e2e/linear-remediation.spec.ts tests/e2e/account-navigation.spec.ts tests/e2e/keyboard-shortcuts.spec.ts tests/e2e/phase3-workspace-governance.spec.ts tests/e2e/tree-arrangement.spec.ts tests/e2e/zz-sidebar-comparison.spec.ts tests/e2e/zz-organize.spec.ts tests/e2e/zz-organize-move.spec.ts tests/e2e/phase2.5-knowledge-explorer.spec.ts`
Expected: PASS. If documents sit at "Loading document" with `PROBE-NEXT` console lines, move `.next/cache` aside and re-run — that is a stale build cache, not this change.

- [ ] **Step 14: Commit**

```bash
git add -A src tests/e2e
git commit -m "feat(shell): one sidebar with navigation and the document tree on every workspace page

Claude-Session: https://claude.ai/code/session_014fd1k5oJxuzWQ3nAkpZFRE"
```

---

### Task 4: Resize and peek

**Files:**
- Modify: `src/components/shell/sidebar-frame.tsx`
- Modify: `tests/e2e/zz-notion-sidebar.spec.ts`

**Interfaces:**
- Consumes: `NAV_WIDTH`, `clampNavWidth`, `isNavWidth`, `nextNavWidth` (Task 1); `usePersistedJson` (`src/components/shell/use-persisted-state.ts`).
- Produces: the same `SidebarFrame` signature; a `role="separator"` named `Resize navigation`; `data-peeking` on the aside while peeking.

- [ ] **Step 1: Add the failing e2e tests** — append inside `test.describe("one sidebar", …)`:

```ts
  test("the arrow keys resize it, a reload keeps the width, and a double-click resets it", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    const aside = page.getByRole("complementary", { name: "Navigation" });
    const handle = page.getByRole("separator", { name: "Resize navigation" });
    await expect(handle).toHaveAttribute("aria-valuenow", "256");
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "288");
    await page.reload();
    await expect(page.getByRole("separator", { name: "Resize navigation" })).toHaveAttribute("aria-valuenow", "288");
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(288);
    await page.getByRole("separator", { name: "Resize navigation" }).dblclick();
    await expect(page.getByRole("separator", { name: "Resize navigation" })).toHaveAttribute("aria-valuenow", "256");
  });

  test("dragging stays inside 220–400", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    const handle = page.getByRole("separator", { name: "Resize navigation" });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(900, box.y + 200, { steps: 5 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "400");
    const after = (await handle.boundingBox())!;
    await page.mouse.move(after.x + after.width / 2, after.y + 200);
    await page.mouse.down();
    await page.mouse.move(10, after.y + 200, { steps: 5 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "220");
  });

  test("collapsed, the left edge peeks it over the page; Esc hides it; ⌘\\ pins it", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const aside = page.getByRole("complementary", { name: "Navigation" });
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(0);
    const main = page.locator("main");
    const mainLeft = (await main.boundingBox())!.x;

    await page.mouse.move(400, 400);
    await page.mouse.move(2, 400);
    await expect(aside).toHaveAttribute("data-peeking", "");
    await expect(page.getByRole("tree", { name: "Knowledge tree" })).toBeVisible();
    expect((await main.boundingBox())!.x).toBe(mainLeft); // over the page, not pushing it

    await page.keyboard.press("Escape");
    await expect(aside).not.toHaveAttribute("data-peeking", "");

    await page.mouse.move(400, 400);
    await page.mouse.move(2, 400);
    await expect(aside).toHaveAttribute("data-peeking", "");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Backslash" : "Control+Backslash");
    await expect(page.getByRole("button", { name: "Collapse navigation" })).toBeAttached();
    await expect(aside).not.toHaveAttribute("data-peeking", "");
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(256);
  });

  test("leaving the peeked sidebar hides it after a moment", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const aside = page.getByRole("complementary", { name: "Navigation" });
    await page.mouse.move(400, 400);
    await page.mouse.move(2, 400);
    await expect(aside).toHaveAttribute("data-peeking", "");
    await page.mouse.move(100, 400);
    await page.mouse.move(800, 400);
    await expect(aside).not.toHaveAttribute("data-peeking", "", { timeout: 2_000 });
  });
```

Check `keyboard-shortcuts.spec.ts` for how it presses ⌘\ and use the same spelling if it differs.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx playwright test tests/e2e/zz-notion-sidebar.spec.ts`
Expected: the four new tests FAIL (no separator; no `data-peeking`).

- [ ] **Step 3: Implement** — replace `src/components/shell/sidebar-frame.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { PanelLeftOpen } from "lucide-react";
import { NAV_TOGGLE_SHORTCUT } from "@/components/actions/action-registry";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { NAV_WIDTH, clampNavWidth, isNavWidth, nextNavWidth } from "./nav-width";
import { usePersistedJson } from "./use-persisted-state";

const PEEK_LEAVE_MS = 300;

/**
 * The wide window's sidebar column. Collapsed is width 0 — the content stays mounted (and `inert`) so the
 * tree keeps what was expanded and scrolled — and an expand button floats on the pages' top line. While
 * collapsed, a pointer at the window's left edge peeks it over the page; the keyboard's way in is ⌘\ or
 * the button, which do everything peeking does. The right edge resizes it.
 */
export function SidebarFrame({ collapsed, onExpand, children }: { collapsed: boolean; onExpand: () => void; children: ReactNode }) {
  const [storedWidth, setStoredWidth] = usePersistedJson("kh:nav-width", NAV_WIDTH.default, isNavWidth);
  // Width while dragging lives here and is written once on release, not to storage every frame.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [peeking, setPeeking] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const leaveTimer = useRef<number | null>(null);
  const width = dragWidth ?? storedWidth;
  const hidden = collapsed && !peeking;

  useEffect(() => {
    if (!collapsed) setPeeking(false);
  }, [collapsed]);

  useEffect(() => {
    if (!peeking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setPeeking(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [peeking]);

  useEffect(() => () => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
  }, []);

  function startPeek() {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    if (collapsed && window.matchMedia("(hover: hover)").matches) setPeeking(true);
  }

  function endPeek() {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => {
      // A menu opened from the sidebar draws outside it; going to it is not leaving.
      if (asideRef.current?.querySelector("[data-popup-open]")) return;
      setPeeking(false);
    }, PEEK_LEAVE_MS);
  }

  function onHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    const move = (moved: PointerEvent) => {
      latest = clampNavWidth(startWidth + moved.clientX - startX);
      setDragWidth(latest);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setStoredWidth(latest);
      setDragWidth(null);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function onHandleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const next = nextNavWidth(width, event.key);
    if (next === null) return;
    event.preventDefault();
    setStoredWidth(next);
  }

  const position = peeking ? "fixed inset-y-0 left-0 z-40 border-r shadow-popover" : hidden ? "relative" : "relative border-r";
  return (
    <>
      <aside
        ref={asideRef}
        aria-label="Navigation"
        inert={hidden}
        data-peeking={peeking ? "" : undefined}
        onPointerEnter={startPeek}
        onPointerLeave={peeking ? endPeek : undefined}
        style={{ width: hidden ? 0 : width }}
        className={`shrink-0 overflow-hidden border-kh-border ${position} ${dragWidth === null ? "transition-[width] duration-160 ease-out" : ""}`}
      >
        <div className="h-full" style={{ width }}>{children}</div>
        {!collapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize navigation"
            aria-valuemin={NAV_WIDTH.min}
            aria-valuemax={NAV_WIDTH.max}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={onHandlePointerDown}
            onKeyDown={onHandleKeyDown}
            onDoubleClick={() => setStoredWidth(NAV_WIDTH.default)}
            className="absolute inset-y-0 right-0 w-1 cursor-col-resize touch-none hover:bg-kh-border-strong focus-visible:bg-kh-border-strong focus-visible:outline-none"
          />
        ) : null}
      </aside>
      {collapsed ? (
        <>
          <div aria-hidden="true" onPointerEnter={startPeek} className="fixed inset-y-0 left-0 z-30 w-2" />
          <div className="fixed left-2 top-2 z-30">
            <Tooltip label="Expand navigation" shortcut={NAV_TOGGLE_SHORTCUT} side="right">
              <button type="button" onClick={onExpand} onPointerEnter={startPeek} aria-label="Expand navigation" aria-keyshortcuts={NAV_TOGGLE_SHORTCUT} className={buttonClasses({ variant: "ghost", icon: true })}>
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </>
      ) : null}
    </>
  );
}
```

Pinning from a peek needs no extra code: ⌘\ and the button call `toggleNav`, `collapsed` turns false, and the effect clears `peeking`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx playwright test tests/e2e/zz-notion-sidebar.spec.ts tests/e2e/keyboard-shortcuts.spec.ts tests/e2e/tree-arrangement.spec.ts --repeat-each=3`
Expected: PASS on every repeat.

Run: `make verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebar-frame.tsx tests/e2e/zz-notion-sidebar.spec.ts
git commit -m "feat(shell): drag or step the sidebar's width, and peek it from the left edge when collapsed

Claude-Session: https://claude.ai/code/session_014fd1k5oJxuzWQ3nAkpZFRE"
```

---

### Task 5: Hover controls and `+` menus

**Files:**
- Modify: `src/components/actions/action-menu.tsx:189-214`
- Modify: `src/components/knowledge/source-sidebar.tsx`
- Modify: `src/components/knowledge/knowledge-tree.tsx` (folder row, ~line 178)
- Modify: `tests/e2e/fixtures/organize.ts:37,57`, `tests/e2e/zz-organize.spec.ts:129`, `tests/e2e/phase2.5-knowledge-explorer.spec.ts:82`
- Modify: `tests/e2e/zz-notion-sidebar.spec.ts`

**Interfaces:**
- Consumes: `RowActionsTrigger`, `actionsFor` (`src/components/actions/action-registry.ts`), `useActionRunner`.
- Produces: `RowActionsTrigger({ actions, onRun, label, variant?: "more" | "add", className? })`; the `add` trigger's accessible name is `New in ${label}`.

- [ ] **Step 1: Add the failing e2e tests** — append inside the describe:

```ts
  test("a folder's + makes a document inside it", async ({ page }) => {
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    const name = unique("Plus");
    await createFolder(page, name);
    await header(page, name).hover();
    await page.getByRole("button", { name: `New in ${name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "New document here" }).click();
    await page.waitForURL(/\/knowledge\/new\?folder=/, ROUND_TRIP);
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test("section controls are there on hover and on focus, not at rest", async ({ page }) => {
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
    const filter = explorer.getByRole("button", { name: "Filter documents and sources" });
    await page.mouse.move(900, 400);
    await expect(filter).toHaveCSS("opacity", "0");
    await explorer.getByRole("heading", { name: "Documents" }).hover();
    await expect(filter).toHaveCSS("opacity", "1");
    await page.mouse.move(900, 400);
    await filter.focus();
    await expect(filter).toHaveCSS("opacity", "1");
  });
```

and extend the import: `import { createFolder, header, mySpace, openKnowledge, unique } from "./fixtures/organize";`

- [ ] **Step 2: Run them to verify they fail**

Run: `npx playwright test tests/e2e/zz-notion-sidebar.spec.ts -g "folder's \+|section controls"`
Expected: FAIL — no `New in …` button; the filter is always opaque.

- [ ] **Step 3: `RowActionsTrigger` gains an `add` variant** — in `src/components/actions/action-menu.tsx`, replace the function (and add `Plus` to its `lucide-react` import):

```tsx
export function RowActionsTrigger({
  actions,
  onRun,
  label,
  variant = "more",
  className = "",
}: {
  actions: readonly Action[];
  onRun: (action: Action) => void;
  label: string;
  /** `add` is the row's `+`: the same menu, holding only what can be made there. */
  variant?: "more" | "add";
  className?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <MenuRoot>
      <MenuTrigger
        aria-label={variant === "add" ? `New in ${label}` : `Actions for ${label}`}
        className={buttonClasses({ variant: "ghost", icon: true, size: "sm", className })}
      >
        {variant === "add" ? <Plus size={15} aria-hidden="true" /> : <MoreHorizontal size={15} aria-hidden="true" />}
      </MenuTrigger>
      <MenuContent align="end" className="w-56">
        <ActionMenuItems actions={actions} onRun={onRun} />
      </MenuContent>
    </MenuRoot>
  );
}
```

- [ ] **Step 4: Folder rows get `+`** — in `src/components/knowledge/knowledge-tree.tsx`, the folder row's floated actions (`<div className="kh-row-action absolute right-1 …">`) become:

```tsx
        <div className="kh-row-action absolute right-1 top-1/2 flex -translate-y-1/2 items-center rounded-md bg-inherit">
          <RowActionsTrigger actions={actions.filter((action) => action.id === "folder.new-document" || action.id === "folder.new-folder")} onRun={onRunAction} label={item.label} variant="add" />
          <RowActionsTrigger actions={actions} onRun={onRunAction} label={item.label} />
        </div>
```

A source-managed or archived folder has neither action, so it gets no `+` (the trigger renders nothing for an empty list).

- [ ] **Step 5: Notes and the Documents header** — in `src/components/knowledge/source-sidebar.tsx`:

1. Replace `addNote`/`addFolder` with one list and one trigger:

```tsx
  // What can be made at the top of Notes, from the registry like everything else.
  const createActions = actionsFor("create", { workspaceId, workspaceType: access.workspace.type, can: access.actions, confirmed })
    .filter((action) => action.id === "create.document" || action.id === "create.folder");
  const addToNotes = <RowActionsTrigger actions={createActions} onRun={runAction} label="Notes" variant="add" />;
```

   Import `RowActionsTrigger` from `@/components/actions/action-menu` (beside `useActionRunner`); drop the now-unused `Plus`, `ActionIcon` and `buttonClasses` imports if nothing else uses them.
2. Wherever `{addFolder}{addNote}` appeared (the no-Notes row and the Notes collection row), render `<div className="kh-row-action flex items-center">{addToNotes}</div>`, and give each of those rows' outer `div` the class `group`.
3. The header row: give its outer `div` `group`, keep the `h2` (`Documents`, `text-caption font-medium text-kh-text-muted`), and wrap its controls in `<div className={\`flex items-center gap-0.5 ${filterOpen ? "" : "kh-row-action"}\`}>` containing the filter button, the `⋯` menu and `{canCreate ? addToNotes : null}`. (`.kh-row-action` already stays visible while a menu in it is open, on focus, and on touch.)
4. The Favorites and Recent section headers: move the chevron after the label and hide it at rest —

```tsx
          <h3><button type="button" aria-expanded={favoritesOpen} onClick={() => setFavoritesOpen((open) => !open)} className="group kh-control kh-interactive-row flex min-h-8 w-full items-center gap-2 px-2 text-left text-caption font-medium text-kh-text-muted">
            <span>Favorites</span>
            <span className="kh-row-action">{favoritesOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}</span>
          </button></h3>
```

   and the same shape for Recent.

- [ ] **Step 6: Update the fixtures and specs that pressed the old buttons**

`tests/e2e/fixtures/organize.ts`:

```ts
/** The `+` at the top of Notes, which holds Create document and Create folder. */
export const addToNotes = (page: Page) => page.getByRole("complementary", { name: "Knowledge explorer" }).getByRole("button", { name: "New in Notes", exact: true }).first();
```

- line 37 becomes `await expect(addToNotes(page)).toBeAttached(ROUND_TRIP);`
- `createFolder` line 57 becomes two lines:
  ```ts
  await addToNotes(page).click();
  await page.getByRole("menuitem", { name: "Create folder" }).click();
  ```

`tests/e2e/zz-organize.spec.ts:129`: the same two lines (import `addToNotes`).
`tests/e2e/phase2.5-knowledge-explorer.spec.ts:82`: `getByRole("link", { name: "Create document" })` becomes opening `New in Notes` and clicking `menuitem` `Create document`.

Then `grep -rn "\"Create folder\" })\.first\|link\", { name: \"Create document\"" tests/e2e` and convert any remaining sidebar use the same way (the composer's own `Create document` *button* stays as it is).

- [ ] **Step 7: Run them to verify they pass**

Run: `npx playwright test tests/e2e/zz-notion-sidebar.spec.ts tests/e2e/zz-organize.spec.ts tests/e2e/zz-organize-move.spec.ts tests/e2e/phase2.5-knowledge-explorer.spec.ts tests/e2e/tree-arrangement.spec.ts`
Expected: PASS.

Run: `make verify`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/actions/action-menu.tsx src/components/knowledge/source-sidebar.tsx src/components/knowledge/knowledge-tree.tsx tests/e2e
git commit -m "feat(sidebar): + on folders and Notes, and section controls that show on hover

Claude-Session: https://claude.ai/code/session_014fd1k5oJxuzWQ3nAkpZFRE"
```

---

### Task 6: Retire `--bg-explorer` and amend the contract

**Files:**
- Modify: `src/app/globals.css:19,73`
- Modify: `tailwind.config.ts:113`
- Modify: `docs/superpowers/specs/frontend-design-language.md` (lines ~193–237 navigation colour; ~270 top line; ~314 primary rail; ~676–683 ⌘\; ~1006–1010 rows)

- [ ] **Step 1: Prove nothing still uses it**

Run: `grep -rn "bg-explorer\|kh-bg-explorer" src tests`
Expected: only `src/app/globals.css` and `tailwind.config.ts`. If anything else appears, change it to `bg-kh-bg-sunken` first.

- [ ] **Step 2: Remove the token** — delete `--kh-bg-explorer: …;` in both the light (line 19) and dark (line 73) blocks of `globals.css`, and `"kh-bg-explorer": "var(--kh-bg-explorer)",` from `tailwind.config.ts`.

- [ ] **Step 3: Amend the contract** in `frontend-design-language.md`:

- Surface list: drop the `bg-explorer` line; `bg-sunken` reads `the sidebar — navigation and the document tree`.
- "Navigation colour scheme": replace the three-layer description (primary navigation → Knowledge explorer → reading canvas, and the `#0e0f12` explorer value) with: *One sidebar, `bg-sunken`, beside the canvas. The sidebar holds navigation and the document tree in one column (`2026-10-14-notion-sidebar-design.md`); there is no second rail and no explorer surface.* Keep the table's Primary row; delete the Knowledge explorer row.
- §8 Colour: "the primary rail's current item" → "a navigation item's current state"; "the explorer's selected document" → "the tree's selected document".
- The top-line paragraph (~270): the sidebar's head row is the workspace selector, not the wordmark.
- ⌘\ (~676): collapsing takes the sidebar to zero width; a pointer at the left edge peeks it over the page; the keyboard path is ⌘\ or the expand button.
- Add under §11 Navigation state: *The sidebar's width is the reader's (220–400px, default 256, `kh:nav-width`); so is whether it is collapsed (`kh:nav-collapsed`).*
- Rows (~1006): "a sidebar row" is unchanged at `md`; no edit beyond wording that names "the rail".

- [ ] **Step 4: Verify**

Run: `make verify`
Expected: PASS.

Run: `npx playwright test tests/e2e/zz-sidebar-comparison.spec.ts tests/e2e/linear-remediation.spec.ts`
Expected: PASS (re-take the comparison baselines if the explorer's colour change moved them, and look at each image).

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css tailwind.config.ts docs/superpowers/specs/frontend-design-language.md tests/e2e
git commit -m "docs(design): one sidebar surface; retire bg-explorer

Claude-Session: https://claude.ai/code/session_014fd1k5oJxuzWQ3nAkpZFRE"
```

---

### Task 7: Measure entering a workspace, and close out the docs

**Files:**
- Create: `docs/superpowers/verification/2026-10-14-notion-sidebar-latency.md`
- Modify: `README.md` (the "One sidebar" row's Plan column)
- Modify: `docs/superpowers/specs/2026-10-14-notion-sidebar-design.md` (Status)

- [ ] **Step 1: Read the method** in `docs/superpowers/verification/2026-09-21-navigation-latency-measurement.md` and follow it exactly.

- [ ] **Step 2: Measure before and after** — entering `/w/<My Space>/home` and `/w/<Query Master>/graph` from a cold load, on `main` (`git stash` nothing; use `git worktree add ../hcm-main main` for the baseline) and on this branch, same number of runs each.

- [ ] **Step 3: Record** in `docs/superpowers/verification/2026-10-14-notion-sidebar-latency.md`: the method used, the two tables of numbers, the difference, and one sentence on whether the spec's fallback (read each tree when its section is first expanded) is needed. If it is, stop and tell the user before building it.

- [ ] **Step 4: Close out the docs** — README's "One sidebar" row: Plan column `[Plan](docs/superpowers/plans/2026-10-14-notion-sidebar.md)`. Spec Status: `agreed with the user on 2026-10-14; built by ../plans/2026-10-14-notion-sidebar.md.` plus, in place, any section the build found different from what was drafted.

- [ ] **Step 5: Full gate**

Run: `make verify && make test-integration && make test-e2e`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add docs README.md
git commit -m "docs(sidebar): latency of entering a workspace, and the spec's status

Claude-Session: https://claude.ai/code/session_014fd1k5oJxuzWQ3nAkpZFRE"
```
