# Knowledge Tree Read-Only Cue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader see in the Knowledge explorer which sources (and the favorites/recents that come from them) are read-only in the Hub, before opening a document.

**Architecture:** Pure presentation in `src/components/knowledge/source-sidebar.tsx`. A `SOURCE_MANAGED` source's heading shows a muted `LockKeyhole` in the slot its chevron uses; hover or keyboard focus swaps the slot to the chevron (CSS only). Sidebar shortcut rows and the "Show all" favorites menu repeat the lock for documents of such sources. One hidden element per sidebar supplies the accessible description; accessible names are unchanged.

**Tech Stack:** Next.js 15 / React 19 client component, Tailwind 3.4 (replaced scales; see CLAUDE.md), lucide-react, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-20-knowledge-tree-read-only-cue-design.md`

## Global Constraints

- Read-only means `source.ownership === "SOURCE_MANAGED"`; never `sourceType`.
- Icon: `LockKeyhole` from `lucide-react`, `text-kh-text-muted`, `aria-hidden="true"`.
- Description text, exactly: `Synced from a folder, read-only in the Hub`.
- Accessible names of source headings, shortcut links and menu items do not change.
- Hub (`HUB_MANAGED`) sources: slot empty at rest; nothing added to their rows.
- Chevron/lock swap only where hover exists: `[@media(hover:hover)]:group-hover:`; keyboard: `group-focus-visible:`.
- Tailwind's default `text-sm`/`text-xs`/`rounded`/`shadow-sm` do not exist here; use only the project tokens already in the file.
- No API, query, schema or new dependency.
- Shell note: bare `npm` may be shadowed by an nvm shell function in non-interactive shells. Run `export PATH=$HOME/.nvm/versions/node/v24.6.0/bin:$PATH` first and use `command npm …`, and never pipe a test command without checking its own exit code.

## Spec deviation (recorded in Task 1)

The spec asks for a tooltip on the source heading. `components/ui/tooltip.tsx` reserves `Tooltip` for controls with no visible label, and says truncated text keeps the native `title`. The heading has a visible label and already sets `title={candidate.name}`. The hint therefore goes into that `title` (`"<name> · Synced from a folder, read-only in the Hub"`), and Task 1 amends the spec to say so.

---

### Task 1: Source heading shows the read-only cue in its chevron slot

**Files:**
- Modify: `src/components/knowledge/source-sidebar.tsx` (imports line 3 and 6; heading block around lines 246–259; the `<nav aria-label="Document tree">` opening around line 197)
- Modify: `docs/superpowers/specs/frontend-design-language.md` (§13 Icons, after the `<select>` paragraph, before `### Brand mark`)
- Modify: `docs/superpowers/specs/2026-10-20-knowledge-tree-read-only-cue-design.md` (the tooltip bullet in "The source heading")
- Test: `tests/e2e/phase2.5-knowledge-explorer.spec.ts`

**Interfaces:**
- Produces: `READ_ONLY_DESCRIPTION` (module constant in `source-sidebar.tsx`), `readOnlyDescriptionId` (from `useId()` inside `SourceSidebar`), and the DOM hooks `data-read-only-cue` (the lock svg) and `data-expand-cue` (the chevron svg). Task 2 reuses the constant, the id and `data-read-only-cue`.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/phase2.5-knowledge-explorer.spec.ts`. `WORKSPACE` and `SOURCE` are already defined at the top of the file. "Vendor Compliance Vault" is the seeded `SOURCE_MANAGED` source (`scripts/db/seed.ts`, `BROWSER_FIXTURES.sourceManagedSourceName`); "Obsidian Wiki" is a Hub source in the same Workspace.

```ts
test("a synced source's heading marks it read-only, and hover or focus shows its chevron", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`, { waitUntil: "networkidle" });
  const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
  const synced = explorer.getByRole("button", { name: "Vendor Compliance Vault", exact: true });
  const hub = explorer.getByRole("button", { name: "Obsidian Wiki", exact: true });

  // At rest: the synced source shows the lock, and says why; the Hub source shows neither.
  await expect(synced.locator("[data-read-only-cue]")).toBeVisible();
  await expect(synced.locator("[data-expand-cue]")).toBeHidden();
  await expect(synced).toHaveAccessibleDescription("Synced from a folder, read-only in the Hub");
  await expect(hub.locator("[data-read-only-cue]")).toHaveCount(0);
  await expect(hub.locator("[data-expand-cue]")).toBeHidden();
  await expect(hub).not.toHaveAccessibleDescription(/read-only/);

  // Keyboard focus (no pointer press yet, so focus is focus-visible) shows the chevron in place of the lock.
  await page.mouse.move(0, 0);
  await synced.focus();
  await expect(synced.locator("[data-expand-cue]")).toBeVisible();
  await expect(synced.locator("[data-read-only-cue]")).toBeHidden();
  await synced.blur();

  // Hover does the same, and changes nothing but the glyph.
  const expanded = await synced.getAttribute("aria-expanded");
  await synced.hover();
  await expect(synced.locator("[data-expand-cue]")).toBeVisible();
  await expect(synced.locator("[data-read-only-cue]")).toBeHidden();
  await expect(synced).toHaveAttribute("aria-expanded", expanded!);
  await hub.hover();
  await expect(hub.locator("[data-expand-cue]")).toBeVisible();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `command npm run test:e2e -- tests/e2e/phase2.5-knowledge-explorer.spec.ts -g "marks it read-only" --reporter=line; echo "exit=$?"`
Expected: `exit=1`, failing at the first assertion on `[data-read-only-cue]` (element not found).

- [ ] **Step 3: Implement the heading slot**

In `src/components/knowledge/source-sidebar.tsx`:

Line 3, add `useId`:
```ts
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
```

Line 6, add `LockKeyhole`:
```ts
import { ChevronDown, ChevronRight, Clock3, FileText, LockKeyhole, MoreHorizontal, Plus, ListFilter, Star } from "lucide-react";
```

Below the imports, before `export type SourceSidebarProps`:
```ts
/** Why a synced source's documents cannot be edited here; read after the name, never part of it. */
const READ_ONLY_DESCRIPTION = "Synced from a folder, read-only in the Hub";
```

Inside `SourceSidebar`, next to the other refs near the top of the function body:
```ts
const readOnlyDescriptionId = useId();
```

Directly inside `<nav aria-label="Document tree" …>`, as its first child:
```tsx
<span id={readOnlyDescriptionId} hidden>{READ_ONLY_DESCRIPTION}</span>
```

Beside the existing `const isNotes = …` in the `matches.map` callback (around line 249), add:
```ts
const readOnly = candidate.ownership === "SOURCE_MANAGED";
```

Replace the heading button (currently: `<button type="button" aria-expanded={open} … title={candidate.name} className="kh-control flex …">` with `<Icon …/>` then the name span) with:
```tsx
<button type="button" aria-expanded={open} aria-controls={`collection-${candidate.id}`} aria-describedby={readOnly ? readOnlyDescriptionId : undefined} onClick={() => setExpanded((previous) => ({ ...previous, [candidate.id]: !open }))} title={readOnly ? `${candidate.name} · ${READ_ONLY_DESCRIPTION}` : candidate.name} className="group kh-control flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-body font-medium text-kh-text hover:bg-kh-bg-hover kh-focus-ring">
  {/* One slot, Notion-style: the source's mark at rest, its chevron on hover (where hover exists) or keyboard focus. */}
  <span className="relative size-3.5 shrink-0 text-kh-text-muted" aria-hidden="true">
    {readOnly ? <LockKeyhole size={14} data-read-only-cue="" className="absolute inset-0 group-focus-visible:invisible [@media(hover:hover)]:group-hover:invisible" /> : null}
    <Icon size={14} data-expand-cue="" className="invisible absolute inset-0 group-focus-visible:visible [@media(hover:hover)]:group-hover:visible" />
  </span>
  <span className="truncate">{candidate.name}</span>
  {candidate.status === "ARCHIVED" ? <Status kind="archived" className="ml-auto text-caption font-normal text-kh-text-muted">Archived</Status> : null}
</button>
```

(`Icon` is the existing `open ? ChevronDown : ChevronRight` above the `return`.)

- [ ] **Step 4: Run the test and confirm it passes**

Run: `command npm run test:e2e -- tests/e2e/phase2.5-knowledge-explorer.spec.ts --reporter=line; echo "exit=$?"`
Expected: `exit=0`, every test in the file passing (the existing exact-name lookups of "Obsidian Wiki" and "Vendor Compliance Vault" included).

- [ ] **Step 5: Record the contract and the spec deviation**

In `docs/superpowers/specs/frontend-design-language.md`, §13 Icons, insert before `### Brand mark`:
```markdown
### A source heading's slot

A Knowledge explorer source heading has one 14px slot before its name: the
source's mark at rest, its chevron on hover (only where hover exists) or on
keyboard focus. `LockKeyhole` there means the source is `SOURCE_MANAGED`,
read-only in the Hub, the same glyph the document header uses for "Read only".
A Hub source leaves the slot empty. The reason is an accessible description,
never part of the heading's name
(`docs/superpowers/specs/2026-10-20-knowledge-tree-read-only-cue-design.md`).
```

In `docs/superpowers/specs/2026-10-20-knowledge-tree-read-only-cue-design.md`, replace the bullet that begins `- A tooltip on the heading of a` with:
```markdown
- The heading's native `title` of a `SOURCE_MANAGED` source reads
  "<name> · Synced from a folder, read-only in the Hub". (Not `Tooltip`:
  `components/ui/tooltip.tsx` keeps that for controls with no visible label,
  and the heading already uses `title` for its truncated name.)
```

- [ ] **Step 6: Typecheck and lint**

Run: `command npm run typecheck; echo "exit=$?"; command npm run lint; echo "exit=$?"`
Expected: both `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add src/components/knowledge/source-sidebar.tsx tests/e2e/phase2.5-knowledge-explorer.spec.ts docs/superpowers/specs/frontend-design-language.md docs/superpowers/specs/2026-10-20-knowledge-tree-read-only-cue-design.md
git commit -m "feat(knowledge): a synced source's heading shows it is read-only"
```

---

### Task 2: Favorites, Recent and "Show all" repeat the cue

**Files:**
- Modify: `src/components/knowledge/source-sidebar.tsx` (`documents` map around line 69; `shortcutRow` around line 122; the "Show all" `MenuItem` around line 215)
- Test: `tests/e2e/phase2.5-knowledge-explorer.spec.ts`

**Interfaces:**
- Consumes from Task 1: `READ_ONLY_DESCRIPTION`, `readOnlyDescriptionId`, `LockKeyhole` import, the `data-read-only-cue` hook.
- Produces: the `documents` map value gains `ownership: SourceView["ownership"]`.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/phase2.5-knowledge-explorer.spec.ts`. Favorites are stored on the account and the suite shares one database per shard, so the test removes what it adds.

```ts
test("a favorite from a synced source carries the read-only cue; one from a Hub source does not", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`, { waitUntil: "networkidle" });
  const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
  const vault = explorer.getByRole("button", { name: "Vendor Compliance Vault", exact: true });
  if (await vault.getAttribute("aria-expanded") === "false") await vault.click();
  await explorer.getByRole("button", { name: "Add to favorites: Compliance Policy", exact: true }).click();
  await explorer.getByRole("button", { name: "Add to favorites: Runbooks", exact: true }).click();
  try {
    const favorites = explorer.getByRole("region", { name: "Favorites" });
    const toggle = favorites.getByRole("button", { name: "Favorites" });
    if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
    const synced = favorites.getByRole("link", { name: "Compliance Policy", exact: true });
    const hub = favorites.getByRole("link", { name: "Runbooks", exact: true });
    await expect(synced.locator("[data-read-only-cue]")).toBeVisible();
    await expect(synced).toHaveAccessibleDescription("Synced from a folder, read-only in the Hub");
    await expect(hub.locator("[data-read-only-cue]")).toHaveCount(0);
    await expect(hub).not.toHaveAccessibleDescription(/read-only/);
  } finally {
    for (const title of ["Compliance Policy", "Runbooks"]) {
      const remove = explorer.getByRole("button", { name: `Remove from favorites: ${title}`, exact: true }).first();
      if (await remove.count()) await remove.click();
    }
    await expect(explorer.getByRole("button", { name: /^Remove from favorites: (Compliance Policy|Runbooks)$/ })).toHaveCount(0);
  }
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `command npm run test:e2e -- tests/e2e/phase2.5-knowledge-explorer.spec.ts -g "favorite from a synced source" --reporter=line; echo "exit=$?"`
Expected: `exit=1`, failing on the `[data-read-only-cue]` visibility assertion inside the Favorites row.

- [ ] **Step 3: Carry ownership into the documents map**

Replace the `documents` `useMemo` body:
```ts
const documents = useMemo(() => {
  const map = new Map<string, { documentId: string; sourceId: string; sourceName: string; ownership: SourceView["ownership"]; label: string }>();
  for (const collection of visibleCollections) {
    for (const item of collection.tree) {
      if (item.type === "document") map.set(`${collection.source.id}:${item.documentId}`, { documentId: item.documentId, sourceId: collection.source.id, sourceName: collection.source.name, ownership: collection.source.ownership, label: item.label });
    }
  }
  return map;
}, [visibleCollections]);
```

- [ ] **Step 4: Mark the sidebar shortcut row**

In `shortcutRow`, on the `<Link …>` add `aria-describedby={document.ownership === "SOURCE_MANAGED" ? readOnlyDescriptionId : undefined}`, and after `<span className="truncate">{document.label}</span>` add:
```tsx
{document.ownership === "SOURCE_MANAGED" ? <LockKeyhole size={14} data-read-only-cue="" className="shrink-0 text-kh-text-muted" aria-hidden="true" /> : null}
```

- [ ] **Step 5: Mark the "Show all" menu item**

In the `favoriteKeys.map` inside `MenuContent`, add `aria-describedby={document.ownership === "SOURCE_MANAGED" ? readOnlyDescriptionId : undefined}` to the `<Link …/>` passed as `render`, and after the source-name `<span …>{document.sourceName}</span>` add:
```tsx
{document.ownership === "SOURCE_MANAGED" ? <LockKeyhole size={14} data-read-only-cue="" className="shrink-0 text-kh-text-muted" aria-hidden="true" /> : null}
```

- [ ] **Step 6: Run the file and confirm it passes**

Run: `command npm run test:e2e -- tests/e2e/phase2.5-knowledge-explorer.spec.ts --reporter=line; echo "exit=$?"`
Expected: `exit=0`, all tests passing.

- [ ] **Step 7: Run the other specs that read the sidebar's favorites and recents**

Run: `command npm run test:e2e -- tests/e2e/zz-recents-favorites.spec.ts tests/e2e/zz-sidebar-comparison.spec.ts --reporter=line; echo "exit=$?"`
Expected: `exit=0`. (They locate rows by name; the name rule keeps them unchanged.)

- [ ] **Step 8: Gate and commit**

Run: `make verify; echo "exit=$?"`
Expected: `exit=0` (unit, typecheck, lint, build).

```bash
git add src/components/knowledge/source-sidebar.tsx tests/e2e/phase2.5-knowledge-explorer.spec.ts
git commit -m "feat(knowledge): favorites and recents from a synced source show it is read-only"
```
