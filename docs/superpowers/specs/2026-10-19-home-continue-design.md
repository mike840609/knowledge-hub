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
- **Changes appear only when they need you to act**: unread share comments and
  source reminders, in one attention strip. The full change feed stays on
  `/updates`; Home links to it.
- **One time-ordered "Continue" list plus "Favorites"**, no tabs.
- **The post-login landing does not change.** `/` still sends personal-only
  users to Home and everyone else to Knowledge.

Success means: a user who opens Home sees, without switching tabs, what they
were last writing, editing or reading — including edits made on another
device — and their favorites, and sees an attention strip only when something
is waiting for them.

## Layout, top to bottom

1. **PageHeader** — unchanged (title "Home", New note, actions menu).
2. **First-use guidance** — unchanged slot.
3. **Attention strip** — rendered only when it has items.
   - Unread share comments from `/api/review-notifications/unread` (existing
     `HomeDiscussions` behaviour: each row jumps to its document with
     `?thread=`). A failed fetch renders nothing and never blocks the page.
   - Source reminders from `knowledgeFreshness` (existing
     `HomeSourceAttention` behaviour and copy).
   - A "View all updates" link to `/w/:id/updates`, shown with the strip.
   - Region name: `Needs attention`.
4. **Continue** — a single list, region name `Continue`.
5. **Favorites** — region name `Favorites`.
6. A "Browse knowledge" link to `/w/:id/knowledge`.

Removed from Home: the Recent reading / Drafts tabs, the "Updates" region,
`HomeUpdates` (folder change rows) and the page's `folderUpdates.list` query.
`/updates` is untouched.

## Continue list

A pure function `continueItems()` builds the list; it does no I/O.

Inputs:

| Source | Time | Label | Cross-device |
|---|---|---|---|
| Drafts (`draft:new`, `draft:<documentId>` personal items) | draft `updatedAt` | Draft | yes |
| Documents with `ownership = HUB_MANAGED` | revision `updatedAt` | Edited | yes |
| Device-local recents (`shortcuts.recent` + `openedAt`) | `openedAt` | Opened | no |

Rules:

- `SOURCE_MANAGED` documents never produce an Edited entry: their `updatedAt`
  is written by a sync, not by the user. They appear only as Opened.
- One row per document. A draft for a document wins over its other entries
  (unsaved work matters most); otherwise the newest event decides the label
  and time. `draft:new` has no document and is always its own row.
- A document whose `status` or `sourceStatus` is `ARCHIVED` is excluded,
  whichever source named it. A recent or a draft whose document is not in the
  workspace's document list is excluded (except `draft:new`).
- Ordered newest first, at most 8 rows.
- A recent with no `openedAt` sorts after every timed entry, in recents order.

Row targets: Draft → the editor (`/knowledge/new` or `…/:documentId/edit`);
Edited and Opened → the reader. Document rows keep today's row actions and the
favourite star. Empty list: "Documents you write, edit or open will appear
here."

## Favorites

`shortcuts.favorites` mapped to the workspace's documents, active ones only, in
favourites order, using the same row as Continue (star filled; clicking it
removes the favourite). Empty: "Star a document to keep it here."

Authorization is unchanged: rows only link to documents already returned by
`listDocumentSummaries` for the caller, and opening one rechecks access.

## Out of scope

- Server-side recent reading (needs a new port, table and migration). Revisit
  if Edited plus device-local Opened proves insufficient.
- Changing the post-login landing.
- Knowledge statistics, graph summaries or a Home search box.

## Testing

- Unit: `continueItems()` — empty inputs; draft beats a newer Edited/Opened of
  the same document; newest event wins otherwise; `SOURCE_MANAGED` never
  Edited; archived document and archived source excluded; unknown document
  excluded; `draft:new` kept; cap of 8; untimed recents last.
- Unit: Home renders the attention strip only with items; Continue and
  Favorites regions and their empty copy (replaces the ordering assertion in
  `tests/unit/personal-home-folder-sync.test.tsx`).
- E2E: update `personal-profile`, `linear-remediation` and
  `folder-sync-reading-flow` to the `Continue` region; drop the `Updates`
  region assertion.
- Help copy (`user-guide-content.ts`, `user-guide-illustration.tsx`) renamed
  from "Continue reading" to "Continue", keeping the note that Opened entries
  are stored on this device.
