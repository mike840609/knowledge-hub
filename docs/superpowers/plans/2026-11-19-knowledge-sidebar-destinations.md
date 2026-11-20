# Knowledge Sidebar Destinations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the existing Knowledge tree higher in the expanded sidebar without losing access to workspace destinations or document actions.

**Architecture:** Reuse existing destination definitions across the compact rail and a nonmodal Knowledge popover. Mount the Knowledge trigger in the persistent explorer header even when source headers fail. Replace the remaining expanded-only links with Home, Account and workspace-switcher entry points before removing them from the primary list.

**Tech Stack:** Next.js App Router, React, TypeScript, Base UI, Tailwind, Vitest, Playwright.

**Spec:** [Option A design](../specs/2026-11-19-knowledge-sidebar-destinations-design.md).

## Global Constraints

- No new dependencies, API, permissions, schema, product routes, or task queries. Keep server authorization, import rules, and ⌘K commands unchanged.
- Do not add a second rail, a tab strip, or a footer row.
- Reuse sidebar tokens, control heights, touch targets and theme/density settings. Keep Account outside the tree scroll area and keep the Knowledge heading/actions in the same row; at narrow widths the popover must fit, and its full trigger label must remain accessible.
- Preserve the one persistent explorer portal, folder state, selected document and scroll behavior when the drawer or routes change.

## Review Focus

1. Source headers fail and recover while navigating: `Knowledge / Graph` remains usable and Retry remains available (Task 1).
2. Nested Source URLs and similarly prefixed paths: a descendant is a location, not an exact page; `/sources-extra` does not match (Task 1).
3. First Escape in a 390px open drawer closes the popover only; a normal link closes the drawer, while a modified click preserves link behavior (Task 1).
4. A team viewer can open Graph but cannot see Sources, Shares or Settings; switching to a permitted team updates gated destinations without stale links (Tasks 1–2).
5. Tasks remains reachable when task search is disabled, and visiting `/tasks` does not incorrectly mark Home current (Task 2).

---

### Task 1: Move Graph, Sources and Shares as one navigation change

**Files:**
- Create: `src/components/shell/knowledge-destinations.tsx`
- Modify: `src/components/shell/primary-nav.tsx`, `src/components/shell/app-shell.tsx`, `src/components/knowledge/source-sidebar.tsx`, `src/components/knowledge/workspace-knowledge-navigation.tsx`
- Test: `tests/unit/workspace-knowledge-navigation.test.tsx`, `tests/e2e/zz-explorer-collapse.spec.ts`, `tests/e2e/workspace-graph.spec.ts`, `tests/e2e/phase2.5-routing.spec.ts`, `tests/e2e/knowledge-browser.spec.ts`, `tests/e2e/phase3-workspace-governance.spec.ts`, `tests/e2e/linear-remediation.spec.ts`, `tests/e2e/menus.spec.ts`, `tests/e2e/zz-links-and-paste.spec.ts`

**Interfaces:**
- `knowledgeDestinations(workspaceId: string, access: WorkspaceAccessView): readonly { name: "Graph" | "Sources" | "Shares"; href: string; Icon: LucideIcon }[]` is shared by the trigger and compact `PrimaryNav`.
- `KnowledgeDestinations({ workspaceId }: { workspaceId: string })` renders the existing heading as a button plus the popover. Read `access` and `pathname` from existing hooks.
- Add `onRetrySources?: () => void` to `SourceSidebarProps`: when supplied, render the header and source-header error instead of the tree and tree-dependent controls. Omit it during normal operation.

- [ ] **Add failing cases.** Extend the existing unit render fixture to take `WorkspaceAccessView["actions"]` overrides. Add “keeps the Knowledge heading while source headers fail and recover”: render `sources=null` on `/w/w/graph`, assert a button named `Knowledge / Graph`, the existing status text, and Retry calling `refresh`; rerender with `sources=[]` and assert the header remains the same node and the error is gone. Add “uses the current workspace capabilities”: a team without `canInspectSources` has Graph but no Sources/Shares; a new workspace ID with the capability exposes Sources at the new team's URL. Add “does not match a similarly prefixed route” for `/w/w/sources-extra`.
- [ ] **Add the two browser cases** to `zz-explorer-collapse.spec.ts`: “Knowledge destinations preserve location and do not add a row” and “Knowledge destinations work in the touch drawer.” Test keyboard, link semantics, location, and compact focus on desktop; on a 390 × 844 touch-capable context assert Escape closes the popover first, ordinary activation navigates and closes the drawer, and modified activation keeps the drawer open. Core desktop assertions:

  ```ts
  await expect(primary.getByRole("link", { name: /^(Graph|Sources|Shares)$/ })).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(graphLink).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  // Open the popover on /graph?orphans=1 and an actual Sources detail route, respectively.
  await expect(graphLink).toHaveAttribute("aria-current", "page");
  await expect(sourcesLink).toHaveAttribute("aria-current", "location");
  ```

  In the 48px rail, assert all three links are present for a permitted personal workspace. Focus one and use the existing sidebar keyboard shortcut to expand; assert focus moves to the desktop collapse control instead of disappearing.
- [ ] **Confirm red.** Run `npm run test:unit -- tests/unit/workspace-knowledge-navigation.test.tsx` and `npm run test:e2e -- zz-explorer-collapse.spec.ts -g 'Knowledge destinations'`; expect failures at the new trigger/relocated links, not fixture setup.
- [ ] **Implement the destinations.** Use `Popover.Root`, `Popover.Trigger`, `Popover.Portal`, `Popover.Positioner` and `Popover.Popup` from the installed Base UI package (same pattern as the page icon picker). Use ordinary Next `Link`s, not `MenuItem`; preserve Tab order and an accessible name on the nonmodal popup. Use `initialFocus={false}` so Tab enters from the trigger. Anchor the list below the heading, constrain it to available height/width, and dismiss on route activation, outside click or Escape. Retain modified-click semantics and AppShell's existing drawer link handoff. For route matching use `pathname === href || pathname.startsWith(href + "/")`; set current only on the corresponding visible link and include a noncolor cue.
- [ ] **Wire the healthy and failed explorer states.** Always render `SourceSidebar` under the existing `WorkspaceKnowledgeNavigation` portal; pass `onRetrySources={() => router.refresh()}` only for `sources === null`. Use the existing heading layout and swap only its label control; keep `Document options` unchanged when healthy. On header failure, suppress empty-state UI and metadata/tree requests for unavailable headers; leave the trigger available.
- [ ] **Move the three links out of expanded Primary.** Render the shared links only for `compact`, preserving their order and gates. Mark compact-only links with `data-compact-destination` and include a focused element with this marker in `AppShell.toggleNav`'s existing focus handoff when expanding.
- [ ] **Update existing assertions.** Redirect old expanded Graph/Sources link locators in the listed e2e files to the nonmodal popover, opening it before the assertion or action. Keep viewer absence assertions against an open popover (not a closed overlay), and preserve the test that proves current/selected state and document-tree identity. Scope the existing drawer relocation unit assertion to `nav[aria-label="Document tree"]`.
- [ ] **Confirm green.** Run `npm run test:unit -- tests/unit/workspace-knowledge-navigation.test.tsx tests/unit/source-sidebar-lazy.test.tsx tests/unit/source-sidebar-recent-menu.test.tsx tests/unit/read-failure-boundaries.test.ts` and `npm run test:e2e -- zz-explorer-collapse.spec.ts workspace-graph.spec.ts phase2.5-routing.spec.ts knowledge-browser.spec.ts phase3-workspace-governance.spec.ts linear-remediation.spec.ts menus.spec.ts zz-links-and-paste.spec.ts`. Run the team-dependent cases with `KM_E2E_SUITE=full` if not included by the default suite. Expect the listed cases to pass; do not count a skipped team case as verified.
- [ ] **Commit the scoped change:** stage only Task 1 files, then `git commit -m "Move Knowledge destinations into the sidebar heading"`.

### Task 2: Finish the two-row sidebar without stranding account and team tools

**Files:**
- Modify: `src/components/shell/primary-nav.tsx`, `src/components/shell/app-shell.tsx`, `src/components/shell/user-menu.tsx`, `src/components/shell/workspace-selector.tsx`, `src/components/knowledge/personal-home.tsx`, `src/components/help/user-guide-content.ts`
- Test: `tests/unit/primary-nav-inbox.test.tsx`, `tests/unit/primary-nav-tasks.test.tsx`, `tests/e2e/task-export-my-space.spec.ts`, `tests/e2e/personal-profile.spec.ts`, `tests/e2e/phase3-workspace-governance.spec.ts`, `tests/e2e/user-guide.spec.ts`, `tests/e2e/zz-explorer-collapse.spec.ts`

**Interfaces:**
- `PrimaryNav` keeps its props; expanded personal gets Home plus Inbox when `inboxUnread` is supplied, expanded team returns `null` when no items exist; compact retains previous destinations.
- `UserMenu` accepts optional `insightsHref?: string`; `WorkspaceSidebarContent` passes the workspace profile URL in personal expanded mode only, using `model.workspace.type`. The separate `trigger="preferences"` call does not get the entry.
- `WorkspaceSelector` keeps its signature and uses current `access.actions.canOpenSettings`; `PersonalHome` keeps its signature and uses `workspaceId` to construct `Open Tasks`.

- [ ] **Add failing cases.** In `primary-nav-tasks.test.tsx` assert collapsed Tasks/Insights continue to point at `/w/w/tasks` and `/w/w/profile` (use the fixture's actual workspace ID); expanded mode has neither, shows Home on personal, and does not render empty Primary on team. In `task-export-my-space.spec.ts` follow Home → `Open Tasks`, assert the same Tasks route and setup flow with task search disabled and Home not current. In `personal-profile.spec.ts` reach Insights through the Account menu. In the governance spec assert the current team switcher offers `Settings` for a permitted admin, targets that team, and excludes it for an unauthorized member; verify the compact rail still supports Settings. Retain the single Inbox tests for wide, narrow, and drawer.
- [ ] **Confirm red.** Run `npm run test:unit -- tests/unit/primary-nav-tasks.test.tsx tests/unit/primary-nav-inbox.test.tsx` and `npm run test:e2e -- task-export-my-space.spec.ts personal-profile.spec.ts phase3-workspace-governance.spec.ts`; expect failures for the new destinations, not loss of fixture data.
- [ ] **Add the replacement entries.** Place a visible `Open Tasks` link in Home's main section without a query or a search-feature gate. Add `Insights` as a link in the sidebar Account menu and cap its popup height to the available viewport. Add `Settings` as a `MenuItem` rendering a `Link` to the current workspace, only for `canOpenSettings`, in the existing workspace switcher.
- [ ] **Finish consolidation.** Only once replacements exist, restrict Tasks, Insights and Settings rows to `compact`, give them the same `data-compact-destination` focus handoff, and skip an empty Primary landmark. Keep Search, Inbox, widths, and breakpoints unchanged.
- [ ] **Update EN/ZH help and its assertions.** Say `Home → Open Tasks`, `Account → Insights` and `Knowledge → Sources` where the guide describes the moved entry; do not rename guide chapters or alter their direct links.
- [ ] **Confirm green.** Run the Task 2 commands plus `npm run test:e2e -- user-guide.spec.ts zz-explorer-collapse.spec.ts` (verify team in the full suite), `npm run typecheck` and `npm run lint`. Expect zero failures. Run the scoped Impeccable detector on changed TSX when the UI is complete. Compare the same document and tree at 1440 × 900 and in a 390px drawer; visually inspect comfortable and compact density, light and dark, and confirm the label and document controls fit without an added row.
- [ ] **Commit the scoped change:** stage only Task 2 files, then `git commit -m "Compact expanded sidebar and preserve secondary access"`.
