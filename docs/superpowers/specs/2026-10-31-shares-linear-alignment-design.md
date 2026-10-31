# Shares: Linear alignment and instant tab switches

Status: agreed with the user on 2026-10-31. Approach B: visual tightening, a
persistent route shell, and a cheaper data path. Amended after the builder
check: no route-level skeleton (it would replace the toolbar on every live
search keystroke); the sibling tabs are prefetched and the current tab moves on click
instead.

## Intent

The Shares page (`/w/:workspaceId/shares`, three tabs) reads as a document page
with a table in it, not as the workbench the rest of the product is:

- the content is `kh-page` (56rem), so at 1440px the 848px table leaves most of
  the content pane empty, though the design contract reserves `wide` (64rem)
  for a page whose content is a table;
- four bands stack before the first row — title + explanatory paragraph, tab
  bar, filter row, and a separate "N shares" line;
- every tab renders its own copy of the page header and tab bar, so switching
  rebuilds the whole top of the page;
- the search field stretches to ~720px, every row shows a copy button at rest,
  and the status glyph reads like an info icon.

Switching tabs also stalls. It is a full server round trip, the destination is
never warmed, and every tab first runs the followed-discussions query (up to 100
follows, each thread/revision/user looked up on its own) just to render the
Discussions badge. The Discussions tab additionally runs a full share-link page
query only to prove workspace ownership.

This document makes the page compact and quiet in the Linear sense, and makes a
tab switch show the new tab and new content without a dead wait.

## What does not change

- **URLs and history.** Tabs remain `?tab=mine` (default), `?tab=saved`,
  `?tab=discussions`. Filters, live search, pagination and `router.refresh()`
  keep working. No new route segments.
- **What each tab is.** My shares lists the caller's share links; Saved shares
  lists the caller's saved shares; Discussions lists the discussions the caller
  follows. Access rules, page sizes, sort orders and empty-state copy do not
  change.
- **What a tab grants.** No access path is added or relaxed. The Shares route
  still requires the caller to own this personal workspace; it proves it with a
  cheaper query (and one cached check in the shell).
- **The tab look.** The underline tabs stay as they are (`ui/tab.ts`
  untouched); only where they are rendered moves.
- **The public share page (`/s/:token`).** Untouched.
- **The My shares unread badge per document** (`/api/review-notifications/share-counts`).
  It stays a client fetch as today.

## Approaches considered

**A. Visual tightening only.** `kh-page-wide`, remove the descriptions, keep
the underline tabs but draw them once, one toolbar row, hover-only row actions.
Low risk, but the tab stall is unchanged, so it does not meet the request.

**B. Visual tightening + a persistent route shell + a cheaper, warmed data path
(chosen).** The page header and tab bar move into `shares/layout.tsx`; the two
sibling tabs are prefetched with their page data; the current tab is marked on
click; the
followed-discussions query is deduplicated per request and batched; the
ownership proof on the Discussions tab stops fetching share links.

**C. One client page, tabs switched without navigation.** Fastest possible
switch, but it abandons URL-driven sibling tabs, duplicates the server's loading
rules in the client, and contradicts the design contract's two-kinds-of-tabs
rule. Not worth it once B makes the switch paint immediately.

**A route-level `loading.tsx`** was in the first draft and is rejected. The
boundary covers every navigation under `/shares`, not just tab changes, so a
live-search debounce, a status filter, "Clear filters" or pagination would swap
the whole page — toolbar and input included — for a skeleton, losing focus
mid-typing. A skeleton scoped to the list would require splitting every tab
view into a server data child and a client toolbar; prefetching buys the same
perceived speed with none of that.

**A dedicated count-only query for the badge** was also considered and rejected.
"Unread" depends on link validity (expiry, revocation, creator role, document
and source status), so a SQL count would be a second implementation of
`evaluateShareLinkValidity` and would drift. B batches the existing judgement
instead of restating it.

## Design

### 1. The route shell

New `src/app/w/[workspaceId]/shares/layout.tsx` owns everything that does not
change between tabs. It follows the Settings layout's two-column-origin rule
(design language §7): the breadcrumb keeps the 56rem origin every page shares,
while the tabs and content use the 64rem table container.

```
<main className="pb-6">
  <div className="kh-page"><PageHeader location="My Space" … title="Shares" /></div>
  <div className="kh-page-wide">
    <div className="mt-4"><SharesNavigation … /></div>
    {children}
  </div>
</main>
```

`PageHeader` has **no description**. Each tab view returns only its toolbar and
list; it no longer renders `<main>`, `PageHeader`, `SharesNavigation`, or a
container. The error branches in `page.tsx` return the same content-only shape,
so a validation message appears under the shared header and tabs.

The three per-tab descriptions are removed. What they said is either already in
the tab's empty state or belongs to the user guide. No info popover or tooltip
replaces them; that would be a new band for text nobody reads twice.

The layout proves workspace access before drawing the shared chrome:
`requireSharesAccess(workspaceId)` (below) throws `DocumentNotFoundError` for a
team workspace or a non-owner, and the layout maps it to `notFound()`. That
keeps a 404 from ever appearing inside a "Shares" header. The page keeps its own
checks; the cached helper makes the shell's check free after the first call.

The page keeps `export const dynamic = "force-dynamic"`.

### 2. The tab bar

`SharesNavigation` stops taking `active` and `discussionsUnread` from each view.
It becomes the one client component in the layout and:

- derives the current tab from `useSearchParams()` — `saved`, `discussions`,
  anything else (including `mine` and an unknown value) is `mine`;
- marks it with `aria-current="page"` as today;
- moves the highlight optimistically on a plain click (Meta/Ctrl/Shift/Alt and
  non-left clicks are left to the browser), then reconciles from
  `useSearchParams` (so Back/Forward and a failed navigation end correct);
- dims the clicked label while the link reports pending (`useLinkStatus`), so a
  first, not-yet-prefetched click still answers;
- renders the Discussions count when it has one.

The count is streamed, not awaited by the shell:

```
<Suspense fallback={<SharesNavigation workspaceId={workspaceId} />}>
  <FollowedCountNavigation workspaceId={workspaceId} />
</Suspense>
```

`FollowedCountNavigation` is an async server component that reads the same
cached followed-discussions list the Discussions tab reads (below) and passes
`items.filter(item => item.linkAvailable && item.unread > 0).length`. A failure
there is caught and the plain nav is rendered: a missing badge must not take
the page down, as the existing client-side count fetch already behaves. The tab
bar paints without it and the number arrives when it is ready. Switching tabs
never re-runs it; `router.refresh()` after follow/unfollow does.

#### The tab look

The underline tabs stay exactly as they are: `components/ui/tab.ts` is not
touched, the current tab keeps its 2px accent rule and accent text, and the bar
keeps its one rule underneath. Only where the bar is rendered changes: it moves
from each tab view into the layout, so the underline is drawn once and survives
a tab switch. On the wide container it is 976px wide at 1440 rather than 848.

This means the Settings, Insights, Graph, Inspector and Inbox tab bars are
unchanged as well; there is no design-language amendment for tabs.

### 3. Toolbar and rows

- The filter row is the first thing under the tab bar (`mt-3`), one flex row.
- Search: full width on a phone; on `sm` and up `w-72` (18rem) and no longer
  `flex-1`. The status select stays beside it at the default 32px height.
- The result count moves out of its own line into the right end of this row
  (`ml-auto`, `role="status"`), keeping today's wording ("3 shares", "N on this
  page"). Saved and Discussions do not gain a count they did not have.
- "Clear filters" stays in the row.
- Rows keep their current grid and density: 41px at desktop (20px title +
  16px subtitle + 2px top and bottom), so the row rule sits below the subtitle
  rather than through it. The row-level copy button takes the existing
  `kh-row-action` class, so it appears on row hover/focus-within like the
  overflow trigger (and stays visible on coarse pointers).
- The table uses the extra width the wide container gives it; no column token
  changes. The status glyph, pagination, details panel and empty-state
  illustrations are unchanged.

### 4. Instant tab switches

The tab links are warmed with the page's data, not just its shell:

- each non-current tab link is `prefetch={true}` (the current one is
  `prefetch={false}`), so the two sibling pages are requested when the tab bar
  enters the viewport. Next does not prefetch a dynamic route by default, so
  this is what turns the first click after arrival into a content swap;
  prefetching is a production behavior, so local dev still waits;
- the current tab is marked on click (optimistic), and the label dims while the
  navigation is pending, so even an unprefetched click is acknowledged before
  the data arrives;
- no `loading.tsx` is added; the old list stays until the new one is ready, and
  live search/filter/pagination keep their current in-place behavior and focus.

Prefetching two sibling pages costs their list queries once per Shares visit.
Both run against the batched queries below, and the shared layout (header, tabs,
badge) is not re-fetched for them. If that cost ever matters, the fallback is
`router.prefetch(href, { kind: "full" })` on hover; it is not needed now.

### 5. The data path

**One followed list per request.** New `src/server/shares-read.ts`:

```
export const getFollowedDiscussions = cache(async () => {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  return (await services.reviews.listFollowedDiscussions(caller)).items;
});
```

The layout's badge and the Discussions tab both call it; React's `cache` makes
them share one query in the same request. This follows the existing
`share-read.ts` / `knowledge-read.ts` pattern.

**A cached access proof.** `src/server/shares-read.ts` also exports
`requireSharesAccess(workspaceId)`, cached, which calls the new
`DocumentShareService.requireManagement(caller, workspaceId)`. That method is
extracted from `listManagement`: `requireWorkspaceRead`, then the same PERSONAL
+ owner + ACTIVE check, throwing the same `DocumentNotFoundError`.
`listManagement` calls it and then lists links. The layout calls the cached
server helper once; the Discussions branch calls it instead of
`listManagement({})`.

**Batch the follow lookups.** `DocumentReviewService.followedThreads` currently
calls `reviewThreads.findById` once per follow, and
`listFollowedDiscussions` calls `revisions.findCurrent` and `users.findById`
once per item. Two port methods are added:

- `DocumentReviewThreadRepository.findByIds(ids)` — one `IN` query (chunked
  like `users.findByIds`);
- `RevisionRepository.findCurrentByIds(documentIds)` — one join against
  `knowledge_documents.current_revision_id`.

`followedThreads` maps follows through `findByIds`; `listFollowedDiscussions`
resolves titles and author names with `findCurrentByIds` / `findByIds` and
builds maps. `followViews` (the Inbox activity projection, which shares this
helper) does the same for its titles and author names. Link validity stays per
unique link, as it is today: the number of documents/links is small, and reusing
`evaluateShareLinkValidity` is the point.

Expected effect: the badge and the Discussions tab go from O(follows) queries
(thread, revision and author each) to a small constant set, before the links.
No semantics change; `summarizeFollowedThread` remains the single decision
about unread and availability, and the Inbox's ordering and paging are not
touched.

## Files

- `src/app/w/[workspaceId]/shares/layout.tsx` (new)
- `src/app/w/[workspaceId]/shares/page.tsx`
- `src/components/knowledge/shares-navigation.tsx`
- `src/components/knowledge/share-management-view.tsx`
- `src/components/knowledge/saved-shares-view.tsx`
- `src/components/knowledge/followed-discussions-view.tsx`
- `src/server/shares-read.ts` (new)
- `src/modules/knowledge/application/document-share-service.ts`
- `src/modules/knowledge/application/document-review-service.ts`
- `src/modules/knowledge/ports/document-review-thread-repository.ts`
- `src/modules/knowledge/ports/revision-repository.ts`
- `src/infrastructure/database/mariadb/repositories/document-review-threads.ts`
- `src/infrastructure/database/mariadb/repositories/revisions.ts`
- tests below

## Acceptance

**Behaviour**

- `/shares` shows one header, one tab bar, then the filter row and list; the
  tab bar and header do not remount when switching tabs.
- Each tab has its own URL as today; Back returns to the previous tab with the
  right tab current; an unknown `tab` value falls back to My shares and shows
  the validation message under the shared chrome.
- A click moves the current tab at once; in a production build the sibling
  tab's content arrives from its prefetch, with no blank page or skeleton. A
  slow or unprefetched navigation dims the label until the content swaps.
- Live search, the status filter, "Clear filters" and pagination keep the
  toolbar and the input's focus; no navigation swaps the page for a skeleton.
- The Discussions count still appears on its tab and is still the number of
  followed discussions with unread replies whose link is available. A failed
  count leaves the tab bar and page usable.
- A team workspace or a non-owner gets the not-found page, never the Shares
  header.
- The My shares count sits at the right of the filter row and is still a live
  status; the copy action appears on hover/focus (and is visible on touch).
- No description paragraph on any of the three tabs.

**Visual**

- At 1440px the breadcrumb keeps the shared page origin (56rem) and the tabs +
  table use `kh-page-wide` (64rem); the table is no longer 848px in a 1264px
  pane.
- The tabs keep today's underline: the 2px accent rule and accent text on the
  current tab, one rule under the bar. The bar is now 976px wide at 1440 and is
  drawn once instead of once per view.
- Rows stay 41px; no row rule crosses a title or subtitle line.
- Light and dark both read correctly; 390px has no horizontal scroll and the
  tab row plus toolbar wrap without overflow.

**Tests**

- `tests/unit/shares-navigation.test.tsx` (new): default/`saved`/`discussions`/
  unknown → current tab; unread count; optimistic click moves the current tab
  and the pending label is marked.
- `tests/unit/saved-shares-view.test.tsx` and
  `tests/unit/followed-discussions-view.test.tsx`: drop the tab-bar assertions
  (they belong to the nav test) and keep the list/filter assertions.
- `tests/unit/share-management-view.test.tsx`: unchanged except any markup the
  copy-button class change touches.
- Integration: `tests/integration/review-reply-follow.test.ts` (follow list and
  unread semantics, plus the activity feed after batching),
  `tests/integration/share-comment-notify.test.ts` (Inbox activity ordering and
  paging), and `tests/integration/share-management.test.ts`
  (`requireManagement` still refuses a team workspace and a non-owner).
- E2E: `tests/e2e/breadcrumb-alignment.spec.ts` (the header keeps the 56rem
  origin), `tests/e2e/saved-shares.spec.ts` (tab links and filters still work),
  `tests/e2e/my-shares-unread.spec.ts`, plus a new
  `tests/e2e/shares-tabs.spec.ts`: one header and one tab bar; click Saved,
  Discussions, Back; URL, current tab and list each time; the copy button is
  present but hidden at rest (opacity) and appears on hover.
- Gates: `npm run test:unit`, `npm run typecheck`, `npm run lint`,
  `npm run build`; with the database, `npm run test:integration` and the two
  shares E2E specs.

## Out of scope

- Replacing `listDocumentSummaries` (read only when My shares is empty) with an
  existence query.
- Path-based tab URLs (`/shares/saved`).
- A route-level or list-level skeleton.
- Reworking the status glyph, pagination, row density or empty-state art.
- The document-level unread-count endpoint used by My shares.
- Any change to the public share page.

## Risks and mitigations

- **Prefetch cost.** Two sibling page renders per Shares visit. The batched
  queries keep each small, and the shared layout is not re-fetched. If it shows
  in server load, prefetch on hover instead (one change in the nav).
- **A layout access check is not the only check.** The page and the services
  still enforce ownership; the helper is cached, so the extra check is paid
  once per request, and it keeps a 404 out of the Shares chrome.
- **Layout caching hides a stale badge.** Switching tabs does not refresh the
  count; `router.refresh()` after follow/unfollow does, and a new page entry
  does. That matches what the badge means (unread discussions, not tab state).
- **A client hook in a layout.** `useSearchParams()` must stay inside the
  layout's Suspense boundary so the route can still be built; the fallback nav
  is that boundary's fallback and uses the same component.
- **Hover-only copy.** It stays keyboard-reachable through the row's
  `focus-within`, and the coarse-pointer rule keeps it visible.
