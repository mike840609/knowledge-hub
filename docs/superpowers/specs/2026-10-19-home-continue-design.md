# Personal Home returns you to your work

## Intent and agreed product direction

The personal Home (`/w/:id/home`) today splits into a tabbed "Continue reading"
column (five device-local recents, or drafts behind a second tab) and an
"Updates" column that repeats a shrunken copy of `/updates`. Favorites, which
the personal-workspace spec promised on Home and which already sync to the
account, do not appear at all. Each block shows three to five rows and none is
good at its job.

Agreed with the user on 2026-10-19:

- **Home's one job is to return you to work in progress.** Drafts, recent
  edits, recent reading and favorites are the main area.
- **Changes appear only when they need you to act**: source reminders in an
  attention strip, unread share comments in Discussions. The full change feed
  stays on `/updates`; Home links to it.
- **"Drafts" above "Recent", then "Favorites"**, no tabs. (Revised the same
  day: a first cut merged everything into one time-ordered "Continue" list.
  Seen rendered, an older draft sank below newer edits, Edited rows — nearly
  every personal note is Hub-managed — crowded out reading, and the row type
  could be told only from a label at the right edge. Grouping by the next
  action fixes all three: a draft is unfinished work to complete; an edit or
  an open is a place to pick up again.)
- **The post-login landing does not change.** `/` still sends personal-only
  users to Home and everyone else to Knowledge.

Success means: a user who opens Home sees, without switching tabs, what they
were last writing, editing or reading — including edits made on another
device — and their favorites, and sees an attention strip only when something
is waiting for them.

## Layout, top to bottom

1. **PageHeader** — title "Home" and the actions menu.
   Below it, one row (from PR #216, at the user's request): a search bar and
   "Create document" (secondary, `lg`; it read "New note" until the
   2026-11-19 creation-flow spec, decision 5). The search bar is a button named "Search
   articles and notes" that opens the same ⌘K palette as the rail
   (`requestQuickSearch`), never a second search field, so there is still one
   place to search; it shows `⌘K` from `sm` up.
2. **First-use guidance** — unchanged slot.
3. **Attention strip** — rendered only when a source needs the user.
   - Source reminders from `knowledgeFreshness` (existing
     `HomeSourceAttention` behaviour and copy).
   - A "View all updates" link to `/w/:id/updates`, shown with the strip.
   - Region name: `Needs attention`.
4. **Drafts** — region name `Drafts`, rendered only when there is a draft.
5. **Recent** — region name `Recent`.
6. **Discussions** — region name `Discussions`, always rendered, with an
   "Open Inbox" link to `/w/:id/inbox` beside its label and the unread count
   after it. Its list (`Unread discussions`, at most five) holds unread share
   comments, read on the server by the page from the same service as
   `/api/review-notifications/unread` (`listUnreadForOwner`), so it is in the
   first paint and never shifts the page; each row jumps to its document with
   `?thread=`. A failed read renders none and never blocks the page. Empty:
   "No new comments or replies."
7. **Favorites** — region name `Favorites`.

There is no "Browse knowledge" link: the rail's Knowledge item already goes
there, and a lone link under the lists repeated it.

From `xl` up, Drafts and Recent take the left two thirds and Discussions then
Favorites the right third (`grid-cols-[minmax(0,2fr)_minmax(0,1fr)]`, the grid
the old Home used), so the page fits in one screen; below `xl` they stack in
the order above.

(Revised the same day: a first cut put unread comments in the attention strip
and dropped "Open Inbox". Compared with PR #216, the user asked for both back:
Discussions is where a reply to your shared document is expected, so it keeps a
fixed place and an empty state, and Inbox needs a link from Home rather than
only from the topbar. Comments left the strip so one never shows twice.) The page stays in `kh-page`: list pages do not span the window
(design language, deferred item 5).

Removed from Home: the Recent reading / Drafts tabs, the "Updates" region,
`HomeUpdates` (folder change rows) and the page's `folderUpdates.list` query.
`/updates` is untouched.

## Drafts and Recent

A pure function `homeLists()` builds both lists; it does no I/O.

Inputs:

| Source | Time | Label | Cross-device |
|---|---|---|---|
| Drafts (`draft:new`, `draft:<documentId>` personal items) | draft `updatedAt` | (its own list) | yes |
| Documents with `ownership = HUB_MANAGED` | revision `updatedAt` | Edited | yes |
| Device-local recents (`shortcuts.recent` + `openedAt`) | `openedAt` | Opened | no |

Rules:

- `SOURCE_MANAGED` documents never produce an Edited entry: their `updatedAt`
  is written by a sync, not by the user. They appear only as Opened.
- **Drafts** lists every draft, newest first, however old. `draft:new` has no
  document and is always its own row.
- **Recent** holds one row per document; the newest event decides the label
  and time. A document with a draft appears under Drafts only, never again in
  Recent.
- A document whose `status` or `sourceStatus` is `ARCHIVED` is excluded,
  whichever source named it. A recent or a draft whose document is not in the
  workspace's document list is excluded (except `draft:new`).
- Recent is ordered newest first and keeps at most 16 rows. Home shows the
  first 8; the rest sit behind a ghost "Show N more" button (`aria-expanded`),
  which turns into "Show fewer" (taken from PR #216's comparison). A recent with no `openedAt`
  sorts after every timed entry, in recents order.

Row targets: Draft → the editor (`/knowledge/new` or `…/:documentId/edit`);
Edited and Opened → the reader. Document rows keep today's row actions and the
favourite star; Draft rows open the editor and carry neither (as the old
Drafts tab did), and the document keeps its star in Favorites. Draft rows hold
invisible copies of the star and menu buttons so their times line up with
Recent's at every control size. Recent empty: "Documents you edit or open will
appear here." Drafts has no empty state: it is not rendered. Every empty
state is one `caption` `text-muted` line: background, never mistaken for a row.

## New note key

`C` opens a new note (`/w/:id/knowledge/new`) on personal Home, and nowhere
else. The inline-editing spec removed every global letter key because a
document page is an editor that opens unfocused: a letter there is text the
reader meant to type. Home has no editor, so the key is mounted with Home
(`isNewNoteKey`, a `keydown` listener added and removed with the component)
and never reaches a document page, even after a client-side navigation.

It does not fire in a field, editor, menu or dialog, during input-method
composition, on a held key, with ⌘/Ctrl/Alt/Shift (`isSingleKeyShortcut`),
or with focus on the search bar, where a key means search. The Create document link
carries `aria-keyshortcuts="C"` and a tooltip naming the key.

WCAG 2.1.4 (character key shortcuts) asks that such a key can be turned off
or remapped, or acts only while a component has focus. This one does
neither: it is page-wide on Home and has no setting. It is accepted for now
because Home holds nothing to type into outside the fields it already
excludes; revisit if speech-input users report accidental new notes.

## Favorites

`shortcuts.favorites` mapped to the workspace's documents, active ones only, in
favourites order, using the same row as Recent (star filled; clicking it
removes the favourite). Empty: "Star a document to keep it here."

Authorization is unchanged: rows only link to documents already returned by
`listDocumentSummaries` for the caller, and opening one rechecks access.

## Visual language

Home follows `frontend-design-language.md` (the Linear-derived contract). The
user asked that any emphasis use the app's lavender accent; the contract
allows exactly one accent, `--kh-primary` / `--kh-selected-text`, so that is
the only colour Home adds to the neutral ramp.

- **No cards.** Sections are rows under a label, separated by spacing; the
  attention strip is one `rounded-md` panel with a 1px `border-kh-border`
  and no fill or shadow (§6).
- **Section labels** ("Needs attention", "Drafts", "Recent", "Discussions",
  "Favorites") use
  the rail group-label style: `caption`, medium, `text-muted` (§8). Drafts
  and Discussions show their counts beside the label. Hierarchy comes from weight and
  foreground level, not size or colour.
- **Rows** are one line from `sm` up, on the ladder's `md` rung (`min-h-8`,
  32px; "Rows sit on the ladder too"): icon, title `body` medium `text`,
  provenance `caption` `text-muted` beside the title, time at the right in
  the short form (`now`, `5m`, `23h`, `6d`, then `Oct 12`, with the year only
  when it is not this one; `formatShortTime`). The event ("Edited", "Opened")
  is in the time's tooltip and read out to screen readers; an untimed recent
  shows the event itself. On a
  phone the provenance and time drop to a second `caption` line. Fill hangs
  outside the column (§ "A row's fill hangs outside the column"); arrow-key
  navigation via `navigateListRows`.
- **Provenance** (source name, then folder path) names the source only when
  the rows on screen come from more than one source, and then only on a row
  whose source differs from the row above it in the same list: a name every
  row shares, or one printed again on the next row, tells the reader nothing. A folder path is
  always shown. Draft rows carry no provenance; their section names them.
- **Accent, and only here:**
  - the **Drafts and unread Discussions counts** in `text-kh-selected-text` —
    unfinished work and waiting replies are what Home emphasises; times stay
    `text-muted`;
  - a 6px unread dot in `bg-kh-primary` on each unread comment row;
  - a filled favourite star in `text-kh-selected-text` (unchanged);
  - focus rings (`kh-focus-ring`, unchanged);
  - navigation links ("View all updates") keep the
    existing `text-kh-link` token, unchanged from the old Home; so does
    "Open Inbox".
- **Status is not accent.** A failed import keeps the existing warning tokens
  (`kh-warning-*`); a pending or stale source stays neutral.
- No new tokens. Tailwind's default spellings (`text-sm`, `rounded`,
  `shadow-sm`) do not compile and are not used.

## Out of scope

- Server-side recent reading (needs a new port, table and migration). Revisit
  if Edited plus device-local Opened proves insufficient.
- Changing the post-login landing.
- Knowledge statistics or graph summaries. (A Home search *field* stays out:
  the search bar only opens the palette.)

## Testing

- Unit: `homeLists()` — empty inputs; every draft listed newest first however
  old; a drafted document absent from Recent; newest event wins in Recent;
  `SOURCE_MANAGED` never Edited; archived document and archived source
  excluded; unknown document excluded; `draft:new` kept; Recent cap of 16;
  untimed recents last.
- Unit: Home renders the attention strip only with source reminders;
  Discussions always, before Favorites, with "Open Inbox", its empty copy, and
  unread comments (at most five) in place of it; Drafts only with
  drafts, above Recent, with its count in the accent; Recent and Favorites
  regions and their empty copy; eight Recent rows shown with "Show N more" for
  the rest, and no button at eight or fewer.
- E2E: `personal-profile`, `linear-remediation` and `folder-sync-reading-flow`
  read the `Recent` region; `personal-workspace` finds the new-note draft in
  `Drafts`; no `Updates` region.
- Help copy (`user-guide-content.ts`, `user-guide-illustration.tsx`) names
  Drafts and Recent, keeping the note that recently opened entries are stored
  on this device.

## Amendment 2026-11-27: one row grammar (PR #393)

PR #393 first put the latest draft in a tinted card with a filled button, moved
the search bar and Create document into the PageHeader, widened the page to
`kh-page-wide`, and set section labels in `body` semibold. Reviewed against the
rendered page with the user, that read as a dashboard banner rather than the
Linear-derived contract: two filled accent buttons, three heading levels, the
breadcrumb off its shared origin, and times floating mid-row. The user approved
a mockup of the version below. Where this section and the text above disagree,
this section is current.

1. **Layout.** The page stays in `kh-page`, so the breadcrumb keeps its origin.
   The search bar and Create document keep their own row under the PageHeader,
   as in "Layout, top to bottom" item 1; Create document stays `secondary`.
   The content begins 32px below that row (`space-y-6` plus `pt-2`: the rhythm
   scale stops at 24px), more than the 24px between sections, so the row reads
   as the page's controls rather than as part of Drafts.
2. **The latest draft is the first row of Drafts**, the same row as the others,
   not a card. It alone shows a trailing hint in `text-secondary`: its action
   ("Continue editing", or "Open draft" when it opens draft recovery), the `R`
   key and an arrow. Below `sm` only the arrow shows. A draft opens the
   composer (`draft:new`), the editor (an editable document) or draft recovery
   (an archived document, an archived source, or a reader who cannot write
   there). Draft rows carry the accent on their pen icon.
3. **`R` resumes the latest draft**, on Home only, under exactly the rules of
   `C` ("New note key"): not in a field, editor, menu or dialog, not during
   composition, not held, no modifier, not on the search bar. With no draft it
   does nothing. The WCAG 2.1.4 acceptance recorded for `C` covers it too; two
   page keys on a page with nothing to type into do not change that reasoning.
   This is not the removed `R` row key: it acts on the page, not on a row.
4. **Section labels** keep the rail group-label style, and their counts are
   `text-muted` too. The accent leaves the Drafts and Discussions counts: next
   to the hint and the links it made a third and fourth accent in the first
   band of the page. Unread Discussions keep their 6px `bg-kh-primary` dot.
5. **Recent is one list, newest first, with no day groups.** Each row shows
   its event beside the short time ("Edited 5m", "Opened 2d"); the tooltip
   keeps the full date and time. Day groups (Today, Yesterday, Earlier) were
   tried and dropped: the time column already says how recent a row is, so a
   day label repeated it, and every separator split a short list into uneven
   pieces, often of one row.
6. **The right column is Needs attention, Discussions, Favorites**: what waits
   for the reader (a source to fix, a reply to answer) before the standing
   shortcuts. Discussions is still always rendered with its empty copy (the
   2026-10-19 decision stands). Needs attention loses its bordered panel and is rows under the
   label like every other group. A reminder row is its status in `text`, its
   source in `text-muted`, and its action ("Retry", "Review") trailing in
   `text-secondary`. A failed import is the warning colour in its icon only;
   every other reminder has a neutral folder-sync icon.
7. **Tasks leaves Home's lists.** "Open Tasks" moves into the Home actions
   menu, because the desktop rail does not list Tasks (it is compact-only).
   This changes the Tasks row of
   `2026-11-19-knowledge-sidebar-destinations-design.md`, which now points here.
8. **The two columns follow the page's own width**, not the window's: a
   container query on the page box (`kh-home`, from 50rem of content) replaces
   `xl:`, so collapsing the sidebar can make room for the second column.

Tests: Home's order, labels, hint and `R` key in `personal-home-folder-sync.test.tsx`;
reminder rows in `home-attention.test.tsx`.
