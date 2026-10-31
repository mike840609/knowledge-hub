# Shares: Linear alignment and instant tab switches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Shares page's three tabs keep one header and one tab bar, paint a tab switch immediately, stop paying an N+1 query for the unread badge, and tighten the list to the design contract's table width without changing the tab look.

**Architecture:** The route shell (`shares/layout.tsx`) owns the 56rem header and the 64rem tab bar; each tab view returns only its toolbar and list. `SharesNavigation` becomes a self-contained client component that derives the current tab from `?tab=`, marks it on click, prefetches the two sibling pages, and dims the label while a navigation is pending. The followed-discussions query is cached per request, its thread/revision/user lookups are batched, and the Discussions tab proves workspace ownership with a cheap check instead of listing share links.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind design tokens, MariaDB, Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-31-shares-linear-alignment-design.md`

## Global Constraints

- Routes stay `?tab=mine` (default), `?tab=saved`, `?tab=discussions`; an unknown value falls back to My shares and shows the validation alert. No new route segments.
- Do **not** add `loading.tsx` under `shares/`. Do not modify `src/components/ui/tab.ts` or any other tab bar: the underline look is unchanged.
- The header band is `kh-page` (56rem); the tab bar and views are `kh-page-wide` (64rem). The page keeps `export const dynamic = "force-dynamic"`.
- Rows stay 41px at desktop (20px title + 16px subtitle + 2px top and bottom); no rule may cross a title or subtitle line.
- The toolbar is one row: search `w-72` (18rem) on `sm` and up, status beside it, count `ml-auto`. The count keeps `role="status"`.
- Row copy and overflow actions stay hidden at rest (`kh-row-action`) and visible on hover/focus-within and on coarse pointers.
- No new tokens, endpoints, or dependencies. The public share page (`/s/:token`) is untouched.
- Every task ends with its own commit.

## Review Focus

- **A modified tab click** (Meta/Ctrl/Shift/Alt or a non-left button) opens a new context; it must not move the current tab. Tested in Task 4.
- **Live search and filtering** must keep the toolbar mounted and the input focused; no route-level skeleton may replace them. Tested in Task 7.
- **An unknown `tab` value** must land on My shares with the validation alert, not a 404 or a blank page. Tested in Task 4 and Task 7.
- **A non-owner or team workspace** must get the not-found page, never the Shares header or another workspace's data. Tested in Task 3 and Task 5.
- **An empty list** must show its empty state with no orphan count, and rows must keep their 41px so the subtitle is not cut by the row rule. Tested in Task 6 and Task 7.

---

### Task 1: Batched thread and current-revision lookups

**Files:**
- Modify: `src/modules/knowledge/ports/document-review-thread-repository.ts`
- Modify: `src/modules/knowledge/ports/revision-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/document-review-threads.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/revisions.ts`
- Test: `tests/integration/review-reply-follow.test.ts`

**Interfaces:**
- Consumes: the existing `DocumentReviewThreadRepository` and `RevisionRepository` ports.
- Produces:
  - `DocumentReviewThreadRepository.findByIds(ids: readonly string[]): Promise<ReviewThread[]>`
  - `RevisionRepository.findCurrentByIds(documentIds: readonly string[]): Promise<KnowledgeRevision[]>`

- [ ] **Step 1: Write the failing integration test**

Append this test to `tests/integration/review-reply-follow.test.ts` (after the fixture function, alongside the existing `describe` blocks):

```ts
describe("batched review lookups", () => {
  it("reads several threads and current revisions in one call each", async () => {
    const f = await fixture();
    const first = await f.start();
    const second = await f.start();
    const missing = randomUUID();
    const threads = await f.uow.run(r => r.reviewThreads.findByIds([first.id, second.id, missing]));
    expect(threads.map(thread => thread.id).sort()).toEqual([first.id, second.id].sort());
    const revisions = await f.uow.run(r => r.revisions.findCurrentByIds([f.documentId, missing]));
    expect(revisions.map(revision => ({ id: revision.id, documentId: revision.documentId })))
      .toEqual([{ id: f.revisionId, documentId: f.documentId }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration`

Expected: the new test fails because `findByIds` / `findCurrentByIds` are not functions (TypeScript/build may report the missing port methods first; either failure is correct).

- [ ] **Step 3: Add the port methods**

In `src/modules/knowledge/ports/document-review-thread-repository.ts`:

```ts
/** Many threads in one statement; returns only the ids that exist. */
findByIds(ids: readonly string[]): Promise<ReviewThread[]>;
```

In `src/modules/knowledge/ports/revision-repository.ts`:

```ts
/** The current revision of many documents in one statement; returns only ids that exist. */
findCurrentByIds(documentIds: readonly string[]): Promise<KnowledgeRevision[]>;
```

- [ ] **Step 4: Implement both repository methods**

In `src/infrastructure/database/mariadb/repositories/document-review-threads.ts`, next to `findById`:

```ts
async findByIds(ids: readonly string[]): Promise<ReviewThread[]> {
  if (ids.length === 0) return [];
  const rows = await this.connection.query<DbRow[]>(
    `SELECT * FROM document_review_threads WHERE id IN (${ids.map(() => "?").join(",")})`,
    [...ids],
  );
  return rows.map(map);
}
```

In `src/infrastructure/database/mariadb/repositories/revisions.ts`, next to `findCurrent`:

```ts
async findCurrentByIds(documentIds: readonly string[]): Promise<KnowledgeRevision[]> {
  if (documentIds.length === 0) return [];
  const rows = await this.connection.query<DbRow[]>(
    `SELECT r.* FROM knowledge_revisions r
     INNER JOIN knowledge_documents d ON d.current_revision_id = r.id
     WHERE d.id IN (${documentIds.map(() => "?").join(",")})`,
    [...documentIds],
  );
  return rows.map(mapRevision);
}
```

Match the file's existing imports/types (`ReviewThread`, `KnowledgeRevision`, `DbRow`, `map`, `mapRevision`). The follow list caps at 100 ids, so no extra chunking is required.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:integration`

Expected: PASS for `tests/integration/review-reply-follow.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/knowledge/ports/document-review-thread-repository.ts src/modules/knowledge/ports/revision-repository.ts src/infrastructure/database/mariadb/repositories/document-review-threads.ts src/infrastructure/database/mariadb/repositories/revisions.ts tests/integration/review-reply-follow.test.ts
git commit -m "perf(review): batch thread and current-revision lookups"
```

---

### Task 2: Use the batches in the follow service

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts`
- Test: `tests/integration/review-reply-follow.test.ts`, `tests/integration/share-comment-notify.test.ts` (existing, characterization)

**Interfaces:**
- Consumes: `findByIds`, `findCurrentByIds` from Task 1; existing `users.findByIds`.
- Produces: no signature change. `listFollowedDiscussions` and `listActivityForOwner` return the same values with a bounded number of queries.

- [ ] **Step 1: Run the existing behavior tests as the baseline**

Run: `npm run test:integration`

Expected: PASS. These tests pin the row contents and ordering that the refactor must not change.

- [ ] **Step 2: Batch the thread lookup in `followedThreads`**

Replace the per-follow `reviewThreads.findById` with one lookup keyed by id:

```ts
const follows = await r.reviewFollows.listFollowing(userId, FOLLOW_LIMIT);
const threads = new Map(
  (await r.reviewThreads.findByIds(follows.map(follow => follow.threadId)))
    .map(thread => [thread.id, thread]),
);
```

Then, in the existing loop, `const thread = threads.get(follow.threadId); if (!thread) continue;` replaces `findById`. Leave the per-document link lookup, the per-link validity cache, `summarizeFollowedThread` and the ordering untouched.

- [ ] **Step 3: Batch titles and author names in `listFollowedDiscussions`**

After `followedThreads` returns, collect the ids once and reuse them in the loop:

```ts
const followed = await this.followedThreads(r, caller.identity.id);
const documentIds = new Set<string>();
const authorIds = new Set<string>();
for (const { thread, summary } of followed) {
  if ("unavailable" in summary) continue;
  documentIds.add(thread.documentId);
  authorIds.add(summary.latest.authorUserId);
}
const revisions = new Map(
  (await r.revisions.findCurrentByIds([...documentIds]))
    .map(revision => [revision.documentId, revision]),
);
const users = new Map(
  (await r.users.findByIds([...authorIds]))
    .map(user => [user.id, user]),
);
```

Use `revisions.get(thread.documentId)` for `documentTitle` and `users.get(summary.latest.authorUserId)?.name` for `authorName` in the existing `items.push`. Do not change the `unavailable` branch.

- [ ] **Step 4: Batch the same lookups in `followViews`**

`followViews` shares `followedThreads`. Keep its loop (and the `unavailable` entries it pushes) exactly as it is, but resolve the lookups in batches first:

```ts
const followed = await this.followedThreads(r, userId);
const documentIds = new Set<string>();
const authorIds = new Set<string>();
for (const { thread, summary } of followed) {
  if ("unavailable" in summary) continue;
  documentIds.add(thread.documentId);
  if (summary.latestReply) authorIds.add(summary.latestReply.authorUserId);
}
const titles = new Map(
  (await r.revisions.findCurrentByIds([...documentIds]))
    .map(revision => [revision.documentId, revision.title]),
);
const names = new Map(
  (await r.users.findByIds([...authorIds]))
    .map(user => [user.id, user.name]),
);
```

Then iterate `followed` as today: push the `unavailable` entry and `continue`; skip when `summary.latestReply` is missing; otherwise use `titles.get(thread.documentId) ?? ""` and `names.get(summary.latestReply.authorUserId)`. Do not project `rows` directly, or the unavailable entries and their order change.

- [ ] **Step 5: Run the behavior tests**

Run: `npm run test:integration`

Expected: PASS, including `review-reply-follow.test.ts` and `share-comment-notify.test.ts`. `listActivityForOwner` ordering and paging are unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/modules/knowledge/application/document-review-service.ts
git commit -m "perf(review): stop the per-follow N+1 in followed discussions"
```

---

### Task 3: A cheap management check and cached server reads

**Files:**
- Modify: `src/modules/knowledge/application/document-share-service.ts`
- Create: `src/server/shares-read.ts`
- Test: `tests/integration/share-management.test.ts`

**Interfaces:**
- Consumes: `DocumentShareService`, `applicationServices`, `FollowedDiscussionView`.
- Produces:
  - `DocumentShareService.requireManagement(caller: CallerContext, workspaceId: string): Promise<void>`
  - `requireSharesAccess(workspaceId: string): Promise<void>` (request-cached)
  - `getFollowedDiscussions(): Promise<FollowedDiscussionView[]>` (request-cached)
  - `sharesNotFound(error: unknown): boolean`

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/share-management.test.ts`:

```ts
it("proves the personal workspace's owner without listing any links", async () => {
  const f = await fixture(), foreign = await fixture();
  await expect(f.shares.requireManagement(f.caller, f.workspace.id)).resolves.toBeUndefined();
  await expect(f.shares.requireManagement(foreign.caller, f.workspace.id)).rejects.toBeDefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration`

Expected: FAIL — `requireManagement` is not a function.

- [ ] **Step 3: Extract `requireManagement` inside one transaction**

In `src/modules/knowledge/application/document-share-service.ts`, add a private repository-level helper and make both public methods use it without nesting `unitOfWork.run`:

```ts
private async requireManagementIn(r: KnowledgeRepositories, caller: CallerContext, workspaceId: string): Promise<void> {
  await r.workspaceAccess.requireWorkspaceRead(caller, workspaceId);
  const workspace = await r.workspaces.findById(workspaceId);
  if (!workspace || workspace.workspaceType !== "PERSONAL" || workspace.personalOwnerUserId !== caller.identity.id || workspace.lifecycleState !== "ACTIVE") {
    throw new DocumentNotFoundError();
  }
}

async requireManagement(caller: CallerContext, workspaceId: string): Promise<void> {
  return this.unitOfWork.run(r => this.requireManagementIn(r, caller, workspaceId));
}
```

In `listManagement`, replace its first three statements with `await this.requireManagementIn(r, caller, workspaceId);` and keep the query/rows code unchanged.

- [ ] **Step 4: Add the cached server reads**

Create `src/server/shares-read.ts`:

```ts
import { cache } from "react";
import { applicationServices } from "./composition";
import { DomainError } from "@/modules/knowledge/domain/errors";
import type { FollowedDiscussionView } from "@/modules/knowledge/domain/review-follow";

/** The caller's personal workspace for Shares; one check per request, shared by the shell and the tab. */
export const requireSharesAccess = cache(async (workspaceId: string): Promise<void> => {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  await services.shares.requireManagement(caller, workspaceId);
});

/** Every followed discussion, once per request; the tab bar's badge and the Discussions tab share it. */
export const getFollowedDiscussions = cache(async (): Promise<FollowedDiscussionView[]> => {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  return (await services.reviews.listFollowedDiscussions(caller)).items;
});

/** The four refusals that mean this route does not exist for this caller. */
export function sharesNotFound(error: unknown): boolean {
  return error instanceof DomainError
    && ["DOCUMENT_NOT_FOUND", "WORKSPACE_NOT_FOUND", "WORKSPACE_ACCESS_DENIED", "INSUFFICIENT_WORKSPACE_CAPABILITY"].includes(error.code);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:integration`

Expected: PASS for `share-management.test.ts`; the existing `listManagement` tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/knowledge/application/document-share-service.ts src/server/shares-read.ts tests/integration/share-management.test.ts
git commit -m "perf(shares): prove workspace access without listing links"
```

---

### Task 4: A self-contained `SharesNavigation`

**Files:**
- Modify: `src/components/knowledge/shares-navigation.tsx`
- Test: `tests/unit/shares-navigation.test.tsx` (new)

**Interfaces:**
- Consumes: `useSearchParams` from `next/navigation`; `Link`, `useLinkStatus` from `next/link`; `tabClasses`, `tabListClasses` from `@/components/ui/tab`.
- Produces:
  - `type SharesTab = "mine" | "saved" | "discussions"`
  - `parseSharesTab(tab: string | null): SharesTab`
  - `<SharesNavigation workspaceId discussionsUnread? />` — no `active` prop.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/shares-navigation.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSearchParams } from "next/navigation";
import { SharesNavigation, parseSharesTab } from "@/components/knowledge/shares-navigation";

const state = vi.hoisted(() => ({ pending: false }));

vi.mock("next/navigation", () => ({ useSearchParams: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) =>
    <a href={href} {...rest}>{children}</a>,
  useLinkStatus: () => ({ pending: state.pending }),
}));

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); state.pending = false; });

async function mount(tab: string | null, unread = 0) {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(tab ? `tab=${tab}` : "") as unknown as ReturnType<typeof useSearchParams>);
  await act(async () => root.render(<SharesNavigation workspaceId="ws" discussionsUnread={unread} />));
  const link = (name: string) => [...host.querySelectorAll("a")].find(node => node.textContent?.startsWith(name))!;
  return { mine: link("My shares"), saved: link("Saved shares"), discussions: link("Discussions") };
}

it("falls back to My shares for the default and any unknown value", () => {
  expect(parseSharesTab(null)).toBe("mine");
  expect(parseSharesTab("saved")).toBe("saved");
  expect(parseSharesTab("discussions")).toBe("discussions");
  expect(parseSharesTab("something-else")).toBe("mine");
});

it("marks the tab named by the URL and shows the unread count", async () => {
  const tabs = await mount("saved", 30);
  expect(tabs.saved.getAttribute("aria-current")).toBe("page");
  expect(tabs.mine.getAttribute("aria-current")).toBeNull();
  expect(tabs.discussions.textContent).toContain("30");
  expect(tabs.discussions.querySelector('[aria-label="30 unread"]')).not.toBeNull();
});

it("moves the current tab on a plain click, and not on a modified click", async () => {
  const tabs = await mount(null);
  await act(async () => tabs.saved.click());
  expect(tabs.saved.getAttribute("aria-current")).toBe("page");
  expect(tabs.mine.getAttribute("aria-current")).toBeNull();

  await act(async () => {
    tabs.mine.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, button: 0 }));
  });
  expect(tabs.saved.getAttribute("aria-current")).toBe("page");
});

it("marks the label while a navigation is pending", async () => {
  state.pending = true;
  await mount(null);
  expect(host.querySelector(".opacity-60")).not.toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/shares-navigation.test.tsx --config vitest.config.ts`

Expected: FAIL — `parseSharesTab` is not exported and the component still requires an `active` prop.

- [ ] **Step 3: Rewrite `SharesNavigation`**

Keep the existing markup and underline classes. The component's shape:

```tsx
"use client";

import Link, { useLinkStatus } from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { tabClasses, tabListClasses } from "@/components/ui/tab";

export type SharesTab = "mine" | "saved" | "discussions";

export function parseSharesTab(tab: string | null): SharesTab {
  return tab === "saved" || tab === "discussions" ? tab : "mine";
}

export function SharesNavigation({ workspaceId, discussionsUnread = 0 }: { workspaceId: string; discussionsUnread?: number }) {
  const params = useSearchParams();
  const derived = parseSharesTab(params.get("tab"));
  const [active, setActive] = useState<SharesTab>(derived);
  useEffect(() => setActive(derived), [derived]);

  const sections = [/* mine, saved, discussions as today */];
  return (
    <nav aria-label="Shares sections" className={tabListClasses}>
      {sections.map(section => (
        <Link
          key={section.id}
          href={section.href}
          prefetch={active === section.id ? false : true}
          aria-current={active === section.id ? "page" : undefined}
          className={tabClasses(active === section.id)}
          onClick={event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            setActive(section.id);
          }}
        >
          <TabLabel>
            {section.label}
            {section.id === "discussions" && discussionsUnread > 0 && (
              <span aria-label={`${discussionsUnread} unread`} className="ml-1 tabular-nums text-caption text-kh-text-muted">{discussionsUnread}</span>
            )}
          </TabLabel>
        </Link>
      ))}
    </nav>
  );
}

function TabLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? "opacity-60" : undefined}>{children}</span>;
}
```

The `discussions` count condition and its accessible name are unchanged from today. Do not add `mt-*` here; the layout owns the spacing. Keep the accessible name `Shares sections`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/shares-navigation.test.tsx --config vitest.config.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/shares-navigation.tsx tests/unit/shares-navigation.test.tsx
git commit -m "feat(shares): derive the current tab from the URL and warm the siblings"
```

---

### Task 5: The route shell and content-only views

**Files:**
- Create: `src/app/w/[workspaceId]/shares/layout.tsx`
- Modify: `src/app/w/[workspaceId]/shares/page.tsx`
- Modify: `src/components/knowledge/share-management-view.tsx`
- Modify: `src/components/knowledge/saved-shares-view.tsx`
- Modify: `src/components/knowledge/followed-discussions-view.tsx`
- Test: `tests/unit/shares-layout.test.tsx` (new), `tests/unit/saved-shares-view.test.tsx`, `tests/unit/followed-discussions-view.test.tsx`

**Interfaces:**
- Consumes: `requireSharesAccess`, `getFollowedDiscussions`, `sharesNotFound` from Task 3; `SharesNavigation` from Task 4.
- Produces: the layout route; the views no longer accept `discussionsUnread` and no longer render `PageHeader`/`SharesNavigation`/`<main>`.

- [ ] **Step 1: Write the failing layout test**

Create `tests/unit/shares-layout.test.tsx`:

```tsx
import { expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
const access = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/server/shares-read", () => ({
  requireSharesAccess: access,
  getFollowedDiscussions: vi.fn(),
  sharesNotFound: (error: { code?: string }) => error.code === "DOCUMENT_NOT_FOUND",
}));

import SharesLayout from "@/app/w/[workspaceId]/shares/layout";

it("does not draw the Shares chrome for a workspace the caller cannot manage", async () => {
  access.mockRejectedValueOnce(Object.assign(new Error("no"), { code: "DOCUMENT_NOT_FOUND" }));
  await expect(SharesLayout({ params: Promise.resolve({ workspaceId: "ws" }), children: null })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/shares-layout.test.tsx --config vitest.config.ts`

Expected: FAIL — the layout file does not exist.

- [ ] **Step 3: Create the layout**

Create `src/app/w/[workspaceId]/shares/layout.tsx`:

```tsx
import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { SharesNavigation } from "@/components/knowledge/shares-navigation";
import { getFollowedDiscussions, requireSharesAccess, sharesNotFound } from "@/server/shares-read";

export const dynamic = "force-dynamic";

export default async function SharesLayout({ children, params }: { children: ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  try {
    await requireSharesAccess(workspaceId);
  } catch (error) {
    if (sharesNotFound(error)) notFound();
    throw error;
  }
  return (
    <div className="pb-6">
      <div className="kh-page">
        <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Shares" />
      </div>
      <div className="kh-page-wide">
        <div className="mt-4">
          <Suspense fallback={<SharesNavigation workspaceId={workspaceId} />}>
            <FollowedCountNavigation workspaceId={workspaceId} />
          </Suspense>
        </div>
        {children}
      </div>
    </div>
  );
}

async function FollowedCountNavigation({ workspaceId }: { workspaceId: string }) {
  let unread = 0;
  try {
    unread = (await getFollowedDiscussions()).filter(item => item.linkAvailable && item.unread > 0).length;
  } catch {
    // The badge is optional; a failure here must not take the page down.
  }
  return <SharesNavigation workspaceId={workspaceId} discussionsUnread={unread} />;
}
```

- [ ] **Step 4: Make the page use the cached helpers**

In `src/app/w/[workspaceId]/shares/page.tsx`:

- Remove the top-level `listFollowedDiscussions` call and the `discussionsUnread` variable.
- Import `getFollowedDiscussions`, `requireSharesAccess`, `sharesNotFound` from `@/server/shares-read`; drop the `DomainError` import.
- For `tab === "discussions"`: `await requireSharesAccess(workspaceId);` then `const followed = await getFollowedDiscussions();`; render `FollowedDiscussionsView` without `unread`.
- For `tab === "saved"`: render `SavedSharesView` without `discussionsUnread`.
- For `tab === "mine"`: render `ShareManagementView` without `discussionsUnread`.
- The invalid-tab branch: replace `await s.shares.listManagement(caller, workspaceId, {})` with `await requireSharesAccess(workspaceId);` before throwing the `ValidationError`.
- In the `catch`: replace the inline `DomainError` code check with `if (sharesNotFound(error)) notFound();`; the `ValidationError` branches return the three views without `discussionsUnread` (and the discussions branch passes `unread` no longer).
- Keep `hasDocuments`, the empty models and the `key={JSON.stringify(model.query)}` props.

- [ ] **Step 5: Make the three views content-only**

In each of the three view files:

- Remove the `PageHeader`, `SharesNavigation`, `<main className="kh-page pb-6">` wrapper and the closing `</main>`; return a fragment `<>…</>`.
- Remove the `discussionsUnread` prop and its use.
- Leave the filter form, error, governance error, empty state, list, dialogs and pagination in place; their `mt-*` spacing starts the content (Task 6 tightens the toolbar).
- In `FollowedDiscussionsView`, remove the `unread` prop (it was only for the tab badge) and keep `filter`.
- In `SavedSharesView`, remove the `unread`/`discussionsUnread` prop and keep the rest.
- Do not touch the public share page or the design-language contract.

- [ ] **Step 6: Update the view unit tests**

- `tests/unit/saved-shares-view.test.tsx`: in the first test, delete the two assertions about `a[aria-current="page"]` and `/w/reader/shares`; keep the hidden `tab=saved`, the `Next` href, and the absence of Revoke/Views/Favorite.
- `tests/unit/followed-discussions-view.test.tsx`: delete the `it("is the active Shares tab…")` case and remove the `unread` argument from `mount`.
- `tests/unit/share-management-view.test.tsx`: no header/tab assertions exist; leave it for now (Task 6 adds the count/action checks).

- [ ] **Step 7: Run the unit tests**

Run: `npm run test:unit`

Expected: PASS, including the new layout test and the updated view tests.

- [ ] **Step 8: Commit**

```bash
git add src/app/w/[workspaceId]/shares/layout.tsx src/app/w/[workspaceId]/shares/page.tsx src/components/knowledge/share-management-view.tsx src/components/knowledge/saved-shares-view.tsx src/components/knowledge/followed-discussions-view.tsx tests/unit/shares-layout.test.tsx tests/unit/saved-shares-view.test.tsx tests/unit/followed-discussions-view.test.tsx
git commit -m "refactor(shares): one header and one tab bar for the three tabs"
```

---

### Task 6: The one-row toolbar, inline count and hover-only actions

**Files:**
- Modify: `src/components/knowledge/share-management-view.tsx`
- Modify: `src/components/knowledge/saved-shares-view.tsx`
- Modify: `src/components/knowledge/followed-discussions-view.tsx`
- Test: `tests/unit/share-management-view.test.tsx`

**Interfaces:**
- Consumes: the content-only views from Task 5.
- Produces: one toolbar row per view; no separate count line; `kh-row-action` on the copy button.

- [ ] **Step 1: Write the failing unit checks**

Add to `tests/unit/share-management-view.test.tsx`:

```tsx
it("puts the count on the toolbar row and hides the copy action at rest", async () => {
  const item: ManagedShareLink = { id: "link", documentId: "doc", sourceId: "source", title: "Guide", sourceName: "Wiki", label: "For team", path: "/s/token", status: "active", createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null, totalViews: 3, lastViewedAt: null };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [item], query: { q: "", status: "all", page: 1 }, hasNext: false }} />));
    const count = host.querySelector('[role="status"]')!;
    expect(count.textContent).toBe("1 share");
    expect(count.className).toContain("ml-auto");
    const search = host.querySelector<HTMLInputElement>("#shares-query")!;
    expect(search.parentElement?.className).toContain("sm:w-72");
    expect(search.parentElement?.className).not.toContain("sm:flex-1");
    const copy = host.querySelector('button[aria-label="Copy link for Guide · For team"]')!;
    expect(copy.className).toContain("kh-row-action");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("shows no count when the list is empty", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" hasDocuments={false} model={{ items: [], query: { q: "", status: "active", page: 1 }, hasNext: false }} />));
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).toContain("No active share links.");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/share-management-view.test.tsx --config vitest.config.ts`

Expected: FAIL — the count is still on its own line, the search still uses `sm:flex-1`, and the copy button has no `kh-row-action`.

- [ ] **Step 3: Rebuild the My shares toolbar**

In `share-management-view.tsx`, wrap the form and the count in one flex row:

```tsx
<div className="mt-3 flex flex-wrap items-center gap-2">
  <form ref={filterForm} action={...} method="get" className="flex min-w-0 flex-1 flex-wrap items-center gap-2" aria-label="Filter shares">
    <div className="relative basis-full sm:w-72 sm:flex-none">…search…</div>
    <label …>Status</label>
    <SelectMenu … />
    <LiveSearch />
    {…Clear filters…}
  </form>
  {model.items.length > 0 ? (
    <p role="status" className="ml-auto text-caption text-kh-text-muted">{model.items.length} {model.items.length === 1 ? "share" : "shares"}{model.query.page > 1 || model.hasNext ? " on this page" : ""}</p>
  ) : null}
</div>
```

- Delete the old standalone count line (`<p role="status" className="mt-3 …">`).
- Keep the `filterError`, `GovernanceError`, empty state, table header (`mt-4`), list and pagination unchanged.

- [ ] **Step 4: Make the copy action hover-only**

On the row copy `Button` in `share-management-view.tsx`, add `className="kh-row-action"`. The existing overflow trigger already has it. Do not add it to the Saved/Discussions remove/unfollow buttons.

- [ ] **Step 5: Give Saved and Discussions the same one-row toolbar**

In `saved-shares-view.tsx` and `followed-discussions-view.tsx`, change the form wrapper to `mt-3 flex flex-wrap items-center gap-2` (the form itself may stay the flex row; no count is added). Do not change their filters, empty states or rows.

- [ ] **Step 6: Run the unit tests**

Run: `npx vitest run tests/unit/share-management-view.test.tsx --config vitest.config.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/knowledge/share-management-view.tsx src/components/knowledge/saved-shares-view.tsx src/components/knowledge/followed-discussions-view.tsx tests/unit/share-management-view.test.tsx
git commit -m "fix(shares): one toolbar row and hover-only row actions"
```

---

### Task 7: E2E coverage and the full gate

**Files:**
- Create: `tests/e2e/shares-tabs.spec.ts`
- Test: the new spec plus the existing shares/breadcrumb specs.

**Interfaces:**
- Consumes: everything from Tasks 1–6; `createReviewDocument` and `phase3Origin` from the e2e fixtures.
- Produces: no production code.

- [ ] **Step 1: Write the E2E spec**

Create `tests/e2e/shares-tabs.spec.ts`:

```ts
import { expect, test } from "./fixtures/test";
import { createReviewDocument } from "./fixtures/document-review";
import { phase3Origin } from "./fixtures/phase3-identities";

test("keeps one header and one tab bar across tabs and Back", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  await expect(page.getByRole("heading", { name: "Shares", exact: true })).toHaveCount(1);
  const nav = page.getByRole("navigation", { name: "Shares sections" });
  await expect(nav).toHaveCount(1);

  await nav.getByRole("link", { name: "Saved shares", exact: true }).click();
  await expect(page).toHaveURL(/tab=saved/);
  await expect(nav.getByRole("link", { name: "Saved shares", exact: true })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: /^Discussions/ }).click();
  await expect(page).toHaveURL(/tab=discussions/);
  await expect(nav.getByRole("link", { name: /^Discussions/ })).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await page.goBack();
  await expect(nav.getByRole("link", { name: "My shares", exact: true })).toHaveAttribute("aria-current", "page");
});

test("an unknown tab falls back to My shares with the validation alert", async ({ page, request }) => {
  const navigation = await (await request.get(`${phase3Origin("reviewOwner")}/api/workspaces`)).json();
  const ws = navigation.items.find((item: { type: string }) => item.type === "PERSONAL").id;
  await page.goto(`${phase3Origin("reviewOwner")}/w/${ws}/shares?tab=nope`);
  await expect(page.getByRole("alert")).toHaveText("Choose My shares, Saved shares or Discussions.");
  await expect(page.getByRole("navigation", { name: "Shares sections" }).getByRole("link", { name: "My shares", exact: true }))
    .toHaveAttribute("aria-current", "page");
});

test("live search keeps the toolbar and the input's focus", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  const input = page.getByLabel("Find shares", { exact: true });
  await input.fill("guide");
  await expect(page).toHaveURL(/q=guide/);
  await expect(input).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Shares sections" })).toHaveCount(1);
});

test("a row's rule sits below its subtitle, and its actions wait for hover", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  const row = page.getByRole("list", { name: "Share links" }).getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Copy link for/ }) }).first();
  const copy = row.getByRole("button", { name: /^Copy link for/ });
  expect(await copy.evaluate(node => getComputedStyle(node).opacity)).toBe("0");
  const sub = row.locator("p").first();
  const rowBox = (await row.boundingBox())!, subBox = (await sub.boundingBox())!;
  expect(subBox.y + subBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height - 1);
  await row.hover();
  await expect.poll(() => copy.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
});
```

The created document's title is unique per call, so the first row with a copy action is this document's; the list is not asserted by title.

- [ ] **Step 2: Run the new spec**

Run: `npm run test:e2e -- tests/e2e/shares-tabs.spec.ts`

Expected: PASS (after the suite provisions its isolated database and production build). If the `page.request` call needs the fixture's session, use the `request` fixture instead and keep the same URL; the existing fixtures already carry the phase-3 identity.

- [ ] **Step 3: Run the related existing specs**

Run:
- `npm run test:e2e -- tests/e2e/breadcrumb-alignment.spec.ts`
- `npm run test:e2e -- tests/e2e/saved-shares.spec.ts`
- `npm run test:e2e -- tests/e2e/my-shares-unread.spec.ts`

Expected: PASS. Breadcrumb alignment still holds because the header stayed in `kh-page`; Saved shares still filters and navigates; My shares still shows its document-level unread badge.

- [ ] **Step 4: Run the DB-free gate**

Run:
- `npm run test:unit`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Expected: all PASS.

- [ ] **Step 5: Run the integration gate**

Run: `npm run test:integration`

Expected: PASS, including the new batch and management tests.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/shares-tabs.spec.ts
git commit -m "test(shares): pin the route shell, live search and row density"
```

---

## Self-review notes

- **Spec coverage:** every section of the spec maps to a task — visual width/toolbar/rows (5–6), tabs unchanged and drawn once (4–5), tab performance/prefetch (4), no skeleton (7's focus test), cached/batched data (1–3), ownership check (3/5), public page untouched (no task).
- **Spec-provided decisions:** the tab look is the existing underline (`ui/tab.ts` untouched); the header stays at 56rem and the tabs/content at 64rem per the breadcrumb contract; no `loading.tsx` because it would replace the toolbar during live search.
- **Uncovered review focus:** a modified click (Task 4), live-search focus (Task 7), unknown tab (Tasks 4/7), non-owner (Tasks 3/5), empty list and row height (Tasks 6/7). The badge-failure path is a `try/catch` in the layout; it has no automated test because it is a server-only optional fetch, and the E2E suite does not stub the follow service. It is exercised manually by the layout's fallback path.
