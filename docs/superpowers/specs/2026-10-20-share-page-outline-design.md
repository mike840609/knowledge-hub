# Shared page: "On this page" outline

Amends the share-link spec's reading page (`/s/:token`, §6.5). Desktop first. Nothing about
what a link grants changes: the outline is built from the same Markdown the page already
renders, so it shows no more than the article does.

## Why

The workspace reader has had an outline since the knowledge-graph phase; a shared page, often
the longest-lived copy of a document anyone outside the Workspace reads, has none. A long
shared spec is read by scrolling.

## 1. What is shown

- The same entries as the workspace (`extractOutline`: h1–h4, at least 2, at most 200), the
  same list (`OutlineList`), the same links (`#slug`, ids the renderer already gives headings).
- Built on the server from `shared.markdown`; no request. The one client piece is the
  wrapper that follows the reader (§3).

## 2. Placement

- **Rail**, when the window is at least `82rem` wide (the 860px column centred leaves ≥ 224px
  on its left: a `w-52` rail and a 16px edge). It hangs off the article column's left edge — a
  zero-height `sticky` box sized as the column (`kh-reading-column`), the rail `absolute right-full`
  inside it — so it moves with the column when the comments rail slides it left, and never
  needs the page's centring arithmetic copied. It sticks below the pinned Comments bar (`top-16`).
- **Disclosure** (`OutlineDisclosure`) above the Comments bar otherwise, and also while the
  comments rail is open inline — the rail's room is gone then, as the workspace already does
  (`globals.css`, `.kh-document-pane:has(… [data-review-open]) .kh-outline-rail`). It slides with
  the heading when the comments rail opens.
- Both sit outside `article[data-review-document]`, so review anchoring, which reads that
  article's text, is unaffected.

## 3. Following the reader (added 2026-10-20)

The first version left two things out; both are now done.

- **Current heading.** `useActiveHeading` takes `"window"` in place of a pane's ref: it
  listens to the window's scroll and measures heading tops from the top of the viewport,
  with the pane's rule unchanged (the last heading at or above the 96px reading line; the
  last entry at the bottom of the page). `SharedOutline` is the client wrapper that calls it
  and hands `activeSlug` to the rail or the disclosure; the page itself stays a server
  component. A workspace pane still passes its ref and behaves as before.
- **Smooth scroll.** Unscoped, `findHeading` now also looks in `.kh-share-page
  article[data-review-document]` after the document pane, so an outline click scrolls
  smoothly, opens a closed ancestor `<details>`, and replaces the address rather than adding
  a history entry, as in the workspace. A page with a document pane finds what it found
  before; the share-page selector cannot match there.
- **Clear of the pinned Comments bar.** That bar is 48px and pinned to the window's top; the
  prose's `scroll-mt-4` (16px) put a jumped-to heading under it. On this page headings take
  `scroll-margin-top: 4rem` (`globals.css`): 16px below the bar, and inside the 96px reading
  line, so the clicked entry is the highlighted one. A page loaded at `#slug` lands there too.

## 4. Acceptance

E2E (`zz-share-outline.spec.ts`), desktop:

- A shared document with headings shows the rail beside the article at 1440px, left of it,
  not overlapping it; clicking an entry moves the page to that heading and the address to `#slug`.
- The first entry is current on arrival. After a click the clicked entry is current, the
  heading is in view below the Comments bar, and no history entry was added.
- Scrolling the window makes the heading at the reading line current; at the bottom of the
  page the last entry is. The disclosure follows the same way.
- At 1280px the rail is hidden and the disclosure lists the same entries, in a box no wider
  than the text (reader-measure spec §1).
- Opening Comments at 1440px hides the rail and shows the disclosure.
- A document with fewer than two headings shows neither.

## 5. Amendment (2026-10-21): two lines per entry

An entry takes up to two lines (`line-clamp-2`), not one: Chinese headings cut to one line read
as near-identical fragments. The full heading stays its `title`. This applies to every outline
(`OutlineList`), the workspace's too. E2E: `zz-share-outline.spec.ts`, "a long heading wraps to two lines".
