# Editor: `@` mentions

`2026-11-17-editor-notion-gaps-design.md` deferred "@ mentions". A Notion writer
types `@` to reach a page or a date without leaving the keyboard; the rendered
editor has `[[` (pages), `/Page link`, `/Today's date` and `:` (emoji), but no
`@`. This spec adds it as a fourth launcher over things the editor can already
write. Nothing here changes what is stored: every choice writes Markdown the
editor already writes (a wikilink, or plain text), and the change is held to the
wikilink rule (CLAUDE.md, "The rendered editor must write a wikilink back as it
read it").

## Decisions

1. **Where `@` opens the list.** Typing `@` at the start of a block, after
   whitespace, after an opening bracket or quote, after an inline node (a
   wikilink) or after a Han character (where no space is written) opens the
   list, as the writer's own edit: a caret placed after an `@word` already
   written opens nothing (the same `typedAt` rule as the emoji list, which this
   shares). It never opens in a code block, in inline code or link text
   (`keepsAsText`), or after a word character: `a@b` is an address, not a
   mention. While a `[[` link is being written the `[[` list owns the line and
   `@` stands down.
2. **The query.** What follows the `@` up to the caret: up to 40 characters,
   spaces allowed after the first character (page titles have spaces), none of
   `@`, `:` or `/` (a colon is the emoji list's, a slash the `/` list's, as the
   `/` list already leaves colons to emoji). A query that begins with a space is
   prose (`email me @ 5pm`), not a mention. A query nothing answers closes the
   list, so a sentence that merely contains an `@` never holds Enter or the
   arrows.
3. **Pages.** The documents of this Workspace, from the list the `[[` list
   already fetched: `wikiLinkSuggest` now exposes its `targets` store
   (`link-targets`, one fetch a minute, shared) and `atMentionSuggest` ranks it
   with the same `rankSuggestions` (exact title, prefix, substring; newest edit
   first; titles that cannot be written as a link are not offered; the document
   being written is left out). Up to five rows. Choosing one writes the link
   through `insertWikiLink`, the function the `[[` list's pick now calls too, so
   there is one way to write a wikilink: a `wiki_link` node, saved as
   `[[Title]]`, with its edge in the link index (`replaceForDocument` runs on
   save as for any wikilink). No new API and no new query: the list is the
   Workspace's link targets, which the caller already reads for `[[`. "Create
   page" is not offered here; that is `[[`'s.
4. **Dates.** Today, Tomorrow and Yesterday, matched by prefix of their name
   (`tod`, `tom`, `yes`) or of `今天` / `明天` / `昨天`, plus a typed complete
   `YYYY-MM-DD` that is a real calendar day, offered as itself. Choosing writes
   plain text in the writer's own time zone, in the format `/Today's date`
   writes (`YYYY-MM-DD`; `date-text.ts`, which `/Today's date` now uses too).
   The date is text: not a node, not a link, nothing stored beyond the
   Markdown.
5. **Order.** With an empty query, Pages first (the five most recently edited),
   then Dates. With a query that a date's name begins (`@tod`), Dates go first,
   so Today sits above a page called "Todo list"; any other query puts Pages
   first. Each heading appears once; a group with no rows has no heading, except
   a Pages group that is loading or failed (decision 7). The first row is chosen.
6. **Keys.** ArrowUp/Down move through the rows across groups and wrap;
   Enter or Tab (without Shift) chooses; Escape closes and leaves `@query` as
   text; a click chooses (`mousedown`, so the editor keeps the caret). The keys
   go through the editor's direct `handleKeyDown`, like the `[[` and emoji lists,
   because Enter would otherwise split a block and Tab sink a list item. IME
   composition is never read as a key. One undo step per choice.
7. **Accessibility.** The popup is a `role="listbox"` named "Mentions" whose
   rows are `role="option"` inside two `role="group"`s named by their
   headings (Pages, Dates). The editor is a `combobox` while the list is open
   (`aria-expanded`, `aria-controls`, `aria-activedescendant` on the chosen
   option), and another list or the link card already owning the combobox makes
   `@` stand down, as the emoji list does. A polite live region says how many
   rows there are. While the Workspace's pages are loading, or failed to load,
   the Pages group says so in a muted line (Dates still work).
8. **Surface.** `.kh-at-menu` is the emoji list's surface (same radius, border,
   elevation, selected row, width and scroll cap) with two additions: a group
   heading in `text-caption` muted, and a row that carries a muted trailing
   value (the Source name, or the ISO date). No colour, radius or elevation
   token is added (design-language contract, amended).

## Out of scope, recorded

- **People.** Not shipped. The only endpoint that lists a Workspace's members
  is `GET /api/workspaces/:id/members` (`WorkspaceAdminService.listMembers`),
  which answers only a caller who can open the Workspace's settings
  (`readState(..., admin = true)` → `canOpenSettings`) and returns the
  membership-management view (roles, assignable roles, group mappings). An
  ordinary member of a team Workspace is refused, and My Space has one member.
  The other directories (`/api/share-recipients/candidates`,
  `/api/review-mentions/candidates`) are signed-in-only searches of every Hub
  user, which CLAUDE.md records as an accepted exposure for their own purposes
  and which are not a list of this Workspace's members; reusing them here would
  widen that exposure to every document writer. A Workspace-member directory
  readable by members is a new authorization decision and its own spec; until
  then `@` offers no people, and a person's name is typed as text.
- **A mention that notifies, is stored, or grants anything.** `@Name` as plain
  text would grant nothing either; the review-mention feature (Inbox) is
  separate and unchanged.
- **A date that stays a date.** No date node, reminder or date picker; text
  only. Relative dates beyond Today / Tomorrow / Yesterday, and partial typed
  dates, are not offered.
- **Creating a page from `@`.** `[[` offers "Create page"; `@` only links what
  exists.
- **`@` in the Markdown source view.** It is a text area; the list belongs to
  the rendered editor.

## Verification

- Unit, through the rendered editor, `tests/unit/editor-at-mentions.test.ts`:
  trigger rules (start of block, after space, not `a@b`, not in code, not after
  a caret placed on text); Pages choose writes a `wiki_link` that saves as
  `[[Title]]` and whose edge `extractDocumentLinks` reads back; Dates write
  `YYYY-MM-DD`; typed ISO date; keys (arrows wrap, Enter/Tab, Escape leaves the
  text, Shift-Tab stays the editor's); ARIA; stands down for `[[`; a read-only
  editor opens nothing; undo of a choice. `date-text` cases for the calendar
  check.
- E2E, `tests/e2e/zz-editor-at-mentions.spec.ts`: `@` in the composer, the page
  pick is saved as a link the target lists as a backlink, and a date is saved
  as text.
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
