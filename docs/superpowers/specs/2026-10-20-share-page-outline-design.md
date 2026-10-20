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
- Built on the server from `shared.markdown`; no new client component, no request.

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

## 3. Not done

- **No active heading.** `useActiveHeading` listens to a scroll container; this page scrolls
  the window. The rail shows no current entry, as the composer's does not. Add when a reader
  asks for it.
- **No smooth scroll.** `findHeading` looks inside a document pane, which this page has not;
  a click falls back to the link's own `#slug` jump.

## 4. Acceptance

E2E (`zz-share-outline.spec.ts`), desktop:

- A shared document with headings shows the rail beside the article at 1440px, left of it,
  not overlapping it; clicking an entry moves the page to that heading and the address to `#slug`.
- At 1280px the rail is hidden and the disclosure lists the same entries.
- Opening Comments at 1440px hides the rail and shows the disclosure.
- A document with fewer than two headings shows neither.
