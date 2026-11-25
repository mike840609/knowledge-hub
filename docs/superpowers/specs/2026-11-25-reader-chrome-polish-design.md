# Reader chrome polish: tables on phones, title first, breadcrumb, Share, tree loading

A design review of the document page (a read-only synced page, and a writer's own note) found five faults.
Nothing stored changes, no token is added, and no route or service is touched.

## Decisions

1. **A table scrolls sideways, and only sideways, where its column is narrow.** The change of 2026-11-25 ("Show tables whole",
   #387) removed the scroll box and let a long word wrap anywhere. At 390px that cut `headcount_daily` in two. The
   `.kh-markdown-table` region is now a container (`container: kh-table / inline-size`) with `overflow-x: auto` and
   `overflow-y: hidden`, so it has no box that scrolls up and down and no height limit.
   - 40rem and wider: cells wrap `anywhere`, the table never overflows, and no scrollbar shows. This is #387's
     behaviour, unchanged.
   - Under 40rem: cells use `overflow-wrap: break-word`, which does not shrink a column below its longest word. A
     word is kept whole, and the table scrolls sideways when the words do not fit.
   - The breakpoint is a container query on the table's own width, not the viewport's: a wide window with the
     explorer and Details open can leave the column narrow, and a phone-width peek is narrow in a wide window.
   - The reader's region is a tab stop (`tabindex=0`, still named "Table") only while it scrolls, found with a
     `ResizeObserver` (`markdown-table.tsx`). The editor's table node is ProseMirror's DOM and adds no tab stop; the
     editor's own focus is the caret.
   - The editor's controls are unchanged. They are `position: fixed` and placed from cell rectangles, and the
     container is the table's own element, so no `contain` reaches a fixed descendant.
2. **The title comes first; the meta line is under it.** A page that opens with its own `# Title` has no header
   title, so the header's meta line ("Read only · Edit the file in your folder… · Updated just now · 3 backlinks")
   stood above it, 3 lines on a phone, and the title began at y≈250.
   - The header now holds the path and actions only. The meta line and, in a narrow window, the "On this page"
     disclosure are drawn **right after that `#` heading** (`DocumentMetaSlot`), by the reader through
     `MarkdownRenderer`'s existing `afterTitle` and by the editor through a widget decoration after its first
     heading, filled by a portal. The widget is no part of the document, so nothing is serialised.
   - A page with a title field or a heading-less body keeps the line under its header title, as before.
   - A peek draws its own header and keeps its order. When the editor is showing no article (Markdown source, a
     failed editor), the header holds the line, so it is never lost. (A recovery keeps its article on screen and
     the page's own `# Title` in it; the first draft of this decision wrongly listed it. See "Review fixes".)
3. **Read only is a compact lock badge.** The row says `Read only` with the lock, as a button. Its explanation, "Edit
   the file in your folder, then update from folder" with the link (or "Managed by its source"), is a Popover that
   opens on hover (200ms), on Enter or Space from the keyboard, and on tap, and closes on Escape. It is not a `title`.
   The updated time, word count and backlinks follow it on the same line.
4. **The breadcrumb keeps the page's name.** In a document pane under 40rem the levels between the first and the page
   fold into one `…` button ("Show N more levels of the path") that opens them as a menu of links. The first segment
   shrinks first, then the page's own name last of all. Wider, every level is shown as before.
5. **Share says its name.** From `sm` up the Share button is icon plus the word "Share", bordered as a secondary
   control; under it, the icon alone. Its accessible name stays `Share link…`, which contains the visible word.
6. **A source's tree loads as skeleton rows.** `Loading documents…` was a bare paragraph beside the one idiom the
   skeleton module records. `TreeSkeleton` draws five rows at tree height, indented as children are, with a
   screen-reader-only status `Loading documents` and `aria-busy`. The failure line and Retry are unchanged.

## Out of scope

- The shared page (`/s/:token`), which has its own byline and header; its tables take the same CSS.
- A sticky first column or a table's own horizontal scroll cue (a shadow); a scrollbar is the cue.
- The scrolled-away topbar's Share (`DocumentContextBar`), which stays icon-only: it shows only in a narrow window.
- Moving the peek pane's meta line under its title.

## Verification

- Unit: `tests/unit/document-meta.test.tsx` (badge popover opens from the keyboard and holds the link; the slot
  reads the page's context), `tests/unit/document-breadcrumb.test.tsx` (the menu holds the middle levels; the page's
  name is the current item), `tests/unit/source-sidebar-lazy.test.tsx` (skeleton and status while a tree loads).
- E2E, `tests/e2e/zz-reader-chrome-polish.spec.ts`, at 390px and 1440px: the title is above the meta line and sits
  higher than it did; Read only opens its explanation from the keyboard; no document-level horizontal scroll; the
  table keeps `headcount_daily` whole and scrolls sideways at 390px, has no scrollbar at 1440px, and has no vertical
  scroll; the breadcrumb's last segment is not truncated and the `…` menu lists the middle; Share is labelled at 1440px
  and icon-only at 390px.
- Existing: `zz-table-controls.spec.ts`, `zz-table-drag.spec.ts`, `zz-reader-chrome.spec.ts`, `zz-page-chrome.spec.ts`,
  `phase5-authoring.spec.ts`; `make verify`.

## Review fixes

A review of the branch found these; each has a test that failed before.

- **One answer to "the article draws the line".** `DocumentDetailClient` derives it once (`metaInArticle ??
  contentOwnsTitle`) and uses it for the header, the non-bare disclosure and `DocumentMetaContext`, which it now
  provides only when the article draws the line. `DocumentMetaSlot` therefore draws nothing where the header does, so
  an emptied title (`#` alone, or `# ` typed on line 1: `markdownOpensWithHeading` is false) never shows two lines.
  The editor passes `metaInArticle` false for source view and a failed editor only; **a recovery shows the article**
  (it is not hidden) and its first `# Title` carries the line, so decision 2 above no longer lists it.
  `tests/e2e/zz-meta-single.spec.ts`.
- **The disclosure is not prose.** `.kh-outline-inline nav ol|li` resets list style, padding and margins at a
  specificity that beats `MARKDOWN_PROSE`'s `[&_ol]` / `[&_li]`; the outline's links carry `data-outline-link`, which
  the editor's `.kh-editor a:not(...)` rule excludes, so they keep the rail's muted colour, weight and no underline.
- **Add icon is reachable by mouse** on a note that opens with `# Title`: `.kh-document-pane:has(h1:first-child:hover)
  [data-page-icon-add]` shows it, beside the header's own `group-hover/header`.
- A table no longer receives react-markdown's `node` (it serialised each table's hast into the RSC payload), and the
  Read only popover has an accessible name ("Read only").
