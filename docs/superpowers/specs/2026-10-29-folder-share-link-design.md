# Folder share links: share a My Space folder, its subfolders and documents

## Intent

Today a share link carries exactly one document
(`2026-09-23-document-share-link-design.md`). Sharing a set of related notes
means issuing one link per document and the recipient collecting them. The
user wants to share a **folder**: one link that opens the folder's whole
subtree, with its structure, and that stays current as the owner keeps
working in it.

## Agreed with the user (2026-10-29)

- **Same audience and grant shape as a document link.** Only a My Space owner
  issues one, for a folder in their My Space. Anyone holding the link reads
  without signing in. It expires (1/7/30/90 days) and is revocable. It grants
  no Workspace membership, search, tree outside the folder, history, MCP,
  Markdown edits or revision writes.
- **Live, not a snapshot.** What the link shows is the folder's subtree *as it
  is now*: a document added later appears; a document moved out (or archived)
  disappears for the recipient on the next request.
- **Every document in it behaves as a shared document does today.** Signed-in
  readers can comment and reply, follow discussions (Inbox and Shares →
  Discussions), and the owner gets link-origin comments in their Inbox.
- **Save stores the folder, as one entry.** A saved folder share is one row in
  Saved shares; opening it opens the folder link. There is no per-document
  save from inside a folder link.
- **The page keeps the folder's structure.** A left tree with expandable and
  collapsible subfolders, in the owner's tree order; the reading pane on the
  right is today's shared-document page. On a phone the tree folds behind a
  button.
- **Landing.** Opening the link shows the first document in tree order
  (depth-first, the owner's `position` order). A folder with no documents
  shows "This folder has no documents yet."
- **Comments** shows the discussions of the document being read, nothing
  folder-wide.
- **Wikilinks inside the folder navigate.** A `[[link]]` or relative `.md`
  link whose target is a document in the shared subtree is clickable and opens
  that document within the folder link.
- **When the link dies, everything dies.** Expired, revoked, archived folder,
  lost ownership: the link and every document under it show the single
  "link not available" state, exactly as a document link does.
- **Owner side.** Share is offered from the folder's action menu in the
  My Space tree and opens the same dialog as a document (expiry, label, copy).
  Folder links are listed in Shares → My shares beside document links, marked
  by an icon, with the same revoke and view count. A document inside a shared
  folder may also have its own document links; the two are independent.
  Moving or renaming the folder keeps the link (it follows the folder's
  identity, not its path).
- **The owner is reminded, never blocked.** Because the link is live, moving a
  private document into a shared folder publishes it to the link's holders at
  once. Two quiet reminders, no confirmation step: a share marker on folders
  that have an open folder link, in the owner's tree; and, in a document's
  Share dialog, a line "Also visible through the shared folder X" for each
  ancestor folder with an open link.

## Non-goals

- **Search inside a shared folder.** Recommended against and accepted for
  this cut: it would be a new caller-less query over document bodies, needing
  its own scoping and abuse limits, while the tree covers finding by title and
  the browser's find covers the open page. If folders grow past what the tree
  serves, the next step is a client-side *title filter* over the tree the page
  already holds, which reads nothing new.
- Sharing a whole Source or a whole My Space (a Source root is not a folder
  node).
- Per-document save from a folder link; a folder-wide discussion view;
  editing through the link.
- Shared Workspace folders (document links are My Space only; so are these).

## Anti-goals (a failure even if it works)

- **A document id in the URL is ever authorization.** `/s/:token?d=<documentId>`
  names which document to show; the service re-derives, on every request, that
  the document sits under the link's folder right now. An id from outside the
  folder, from another workspace, or of an archived document answers exactly
  like an id that does not exist.
- **The page discloses anything outside the folder.** No title, no existence
  signal: a wikilink whose target lies outside the folder renders as the
  plain text the author wrote — no link, no resolved title, no "missing"
  styling that differs from a link that resolves nowhere.
- **A third caller-less entry.** The CLAUDE.md invariant names exactly two
  entries that answer without a caller (`readShared`, `queryForLink`). The
  folder tree and the folder's documents are served through those same two.
- **Folder links weaken document links.** Existing links, rows, saved shares,
  follows and notifications keep working untouched.

## Bedrock facts this design rests on

Verified in the code on 2026-10-29:

- A folder is a `knowledge_tree_nodes` row (`node_type = 'FOLDER'`); a
  document has exactly one tree node (`uq_tree_one_document`). Tree nodes
  never cross a Source (`fk_tree_parent_same_source`).
- Folder archive refuses a folder with ACTIVE children and never cascades;
  restore requires an ACTIVE parent chain
  (`internal/set-folder-lifecycle.ts`). So an ACTIVE document can sit under an
  ARCHIVED ancestor only through a defect — the membership check below still
  walks the chain and requires every node ACTIVE, as a guard, not a feature.
- For `SOURCE_MANAGED` (folder-sync) sources, folder nodes are keyed by source
  path (`source-import-plan-executor.ts`): renaming the folder on disk
  archives the node and creates a new one, so a link on it dies. This is the
  correct consequence of "the link follows the folder's identity" and is
  documented, not worked around.
- Every downstream share table references `document_share_links(id)`:
  `document_review_threads.origin_share_link_id`,
  `saved_document_shares.share_link_id`,
  `share_comment_events.origin_share_link_id`,
  `review_thread_follows.share_link_id`, `document_share_link_views`. Threads,
  comment events and follows each carry their own `document_id` (directly or
  through the thread), so they already say *which* document under a folder
  link they belong to.

## Design

### 1. Data: one link table, two kinds of target

Extend `document_share_links` instead of adding a parallel table. Because
every downstream table already points at it, threads, comments, follows,
saved shares, view counts and comment events work for folder links with no
new foreign keys. The table keeps its name (renaming would break every query
and migration reference for no behavioural gain).

New migration (next free version, additive, forward-only):

- `document_id` becomes `NULL`able.
- Add `folder_node_id UUID NULL`, FK → `knowledge_tree_nodes(id)`
  `ON DELETE RESTRICT`.
- `CHECK ((document_id IS NULL) <> (folder_node_id IS NULL))` — exactly one
  target.
- `KEY idx_share_links_folder (folder_node_id, created_at)`.

That the target node is a `FOLDER` is enforced by the application at creation
(MariaDB cannot check it across rows); existing rows all have `document_id`
set and pass the check.

Domain: `DocumentShareLink` gains a target. Builder's call how to type it; a
discriminated `target: { kind: "DOCUMENT"; documentId } | { kind: "FOLDER";
folderNodeId }` is suggested so that no code path can read `documentId` from a
folder link by accident. `MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT` (10) applies
per folder as well.

### 2. Validity

A folder link **opens** when all of these hold (same rule as a document link,
with the folder node in the document's place):

- not revoked, not expired;
- folder node exists, is a `FOLDER`, is `ACTIVE`;
- its Source is `ACTIVE`; its Workspace is `PERSONAL`, `ACTIVE`, owned by the
  link's creator, and the creator's direct role still reads
  (`evaluateShareLinkValidity`'s existing inputs).

A **document is reachable** through an open folder link when:

- the document is `ACTIVE`;
- walking from its tree node up through `parent_id` reaches the link's folder
  node, with every node on the way (including the document's own node and the
  folder) `ACTIVE`. Same Source is implied by the tree FK.

Both are evaluated per request, never cached across requests. Any failure of
either is `ShareLinkNotFoundError` — one error, so no response separates
"outside the folder" from "does not exist" from "link dead". The pure part of
this (given the loaded chain) belongs in `document-share-link.ts` beside
`evaluateShareLinkValidity`, so each rule is unit-testable on its own.

SQL that judges validity today by joining `l.document_id` must gain the
folder branch (builder to find every site; known today:
`repositories/document-share-links.ts` `listForWorkspace`,
`repositories/saved-shares.ts` snapshot and list queries). Where SQL needs
"document under folder", a recursive CTE over `knowledge_tree_nodes` from the
document's node upward is the expected form; the builder may instead load the
chain and decide in TypeScript where that is simpler.

### 3. Reading: still one caller-less content entry

`DocumentShareService.readShared(token, { documentId?, recordView? })`:

- **Document link**: unchanged; any `documentId` at all, even the link's own,
  is `ShareLinkNotFoundError`.
- **Folder link**: returns the folder view —
  `{ kind: "FOLDER", folderName, tree, document | null, sharedByName,
  expiresAt }` — where `tree` is the ACTIVE subtree (folders and documents,
  each with id, parent, name/title, page icon, position; **no Markdown**), and
  `document` is the requested `documentId` if reachable, else (when
  `documentId` is absent) the first document depth-first, else `null` (empty
  folder). A `documentId` that is not reachable is `ShareLinkNotFoundError`
  for that request, not a fallback to the first document — the page shows the
  not-available state rather than silently showing something else.

The tree is built from current revisions' titles, the same titles the owner
sees. View counting stays per link per day, and every document read counts one
view — a tree click re-renders the server page and is counted like a first
load. *My call:* telling a first load from an in-folder navigation would need
state the anonymous reader does not have; the number reads as "documents
opened through this link", which is stated in My shares' tooltip for folder
rows.

`tests/unit/share-link-single-exception.test.ts` must keep passing with
`readShared` as the only caller-less content method.

### 4. Routes and page

- `/s/:token` — document link: today's page, unchanged. Folder link: the
  folder page showing the landing document.
- `/s/:token?d=<documentId>` — folder link only; on a document link any `d`
  is not-available. Tree clicks are client navigations between these URLs.
  *My call, and why a query and not a path:* the sign-in exemption matches the
  exact path `/s/<token>` — in the repo (`src/lib/auth-paths.ts`
  `SHARED_READ`) and, by the same shape, in the company Gateway outside the
  repo. A query string leaves the path unchanged, so anonymous reading of a
  non-landing document needs no Gateway change. The two `returnTo` checks
  (`auth-paths.ts` `SHARED_RETURN`, `src/app/page.tsx`) must accept exactly
  `?d=<uuid>` on `/s/<token>` and `/s/<token>/open`, nothing else.
- `/s/:token/open?d=<documentId>` — "Open in Knowledge Hub" from a folder
  page passes the document being read; `/open` re-checks it is reachable
  through the link (else uses the landing document) and hands that document
  id to `sharePlatformDestination`, which already grants nothing and decides
  what the signed-in user may open. There is no folder page in the owner app
  to land on, and this cut adds none.

Page (see the agreed mockup in the brainstorming session): the existing
pinned bar (brand, breadcrumb of the folder path from the shared folder down,
Comments, Save, Open), a left tree rail, and the existing reading column with
title, byline (`Shared by … · Updated … · Link expires …`), outline and
article. Below the `sm` breakpoint the tree is a disclosure button in the bar.
Selected document is highlighted; the folders on its path start expanded,
others collapsed. Everything follows `frontend-design-language.md` (tokens
only; no new colours). No Open Graph tags; `<title>` is the document title
when one is shown, else the folder name. Same CSP and nonce rules as `/s/*`
today, including `frame-ancestors 'none'`.

### 5. Wikilinks on a folder page

Today a shared page is given no resolutions. On a folder page, resolve the
current document's links exactly as the owner's reader does (same Workspace,
same rules, documents as they are now — `link-resolution.ts`,
`knowledge-link-service.ts`), then **keep only resolutions whose target is
reachable through this link** (§2) and point them at
`/s/:token?d=<targetId>`. Every other link — outside the folder, or resolving
nowhere — renders identically, as the plain text the author wrote: no dashed
"No document titled …" styling or tooltip (`markdown-base.tsx`), since that
styling would tell an out-of-folder target from a missing one. On folder pages
the resolved-link extras are also off: no "N other documents share this name"
count (it counts documents outside the folder) and no hover preview (it calls
a signed-in API). Do not
resolve against the subtree alone: a link must point where it points for the
owner, or not at all. A document link's page (`/s/:token` for a document)
still gets no resolutions. This is computed inside the caller-less read, so
it introduces no new entry.

### 6. Discussions

The review API (`/api/share-review/*`) and `DocumentReviewService`'s link
methods (`queryForLink`, `createForLink`, replies, `followForLink`,
`markSeenForLink`, …) take an optional `documentId` alongside the token:
required for a folder link, refused for a document link. Each resolves its
scope as "document reachable through this link" (§2) instead of
`link.documentId`, and a `threadId` must belong to that document (today's
check, unchanged). Threads created this way record
`origin_share_link_id = <folder link>`; the owner's Inbox event records the
same, and names the document as it does today.

Places that currently find a follow's link through the thread's document
(`DocumentReviewService.followedThreads` uses
`shareLinks.listByDocument(thread.documentId)`) must instead load the link by
`follow.shareLinkId` and judge it — for a folder link, open **and** the
thread's document still reachable. The Inbox and Shares → Discussions rules
are otherwise unchanged: a dead entry names nothing, Unfollow needs no live
link.

The rate limits and capacity counters stay per document.

### 7. Saved shares

Saving a folder link snapshots, in one SQL statement as today, validity plus
public metadata: `saved_title` = the folder's name, `saved_shared_by_name` =
the creator's name, `saved_expires_at`. Saved-share search covers the same
fields; "currently public title" for a folder link is the folder's current
name, shown only while the link opens. The list marks folder entries with a
folder icon; opening one goes to `/s/:token`.

### 8. Owner side

- **Create**: the folder's entry in the My Space tree action menu
  (`action-menu.tsx`) gets *Share*, opening `share-link-dialog.tsx` in a
  folder mode. `DocumentShareService.create` (or a sibling `createForFolder`)
  locks the owned scope via the folder node (Source FOR UPDATE, same order as
  today), requires a `FOLDER`, `ACTIVE` node in an `ACTIVE` My Space Source
  owned by the caller, counts active links per folder, and audits
  `DOCUMENT_SHARE_LINK_CREATED` with `{ folderNodeId, … }` in the payload
  (event type unchanged so existing audit consumers keep working; the payload
  says which kind).
- **List/revoke**: Shares → My shares lists folder links with the folder's
  name and a folder icon; filters and paging unchanged. Revoke works the same
  way; the audit payload carries `folderNodeId`. *My calls:* the folder row's
  title opens its Source page in the owner app (no folder page exists); its
  "N new" badge counts unread comment events by `origin_share_link_id` —
  comments made through that link — since today's per-`document_id` grouping
  (`share-comment-events.ts`) has no row to put them on.
- **Reminders** (agreed, §Agreed): (a) the owner's My Space tree marks a
  folder that has at least one open folder link with a share icon (tokens
  only, with an accessible label such as "Shared"); (b) the document Share
  dialog lists the ancestor folders that have an open folder link — "Also
  visible through the shared folder *name*" — each opening that folder's
  links. Both come from one caller-scoped owner query (open folder links in
  the caller's My Space, with their folder node ids); the dialog intersects it
  with the document's ancestor chain. Nothing is blocked or confirmed: moving
  a document into a shared folder proceeds as today. Shown only to the My
  Space owner, the only person who can see that tree.
- Both `SOURCE_MANAGED` and `HUB_MANAGED` folders can be shared: sharing is a
  read grant, unrelated to who writes the content.

## Testing

Requirement-driven; each bullet is at least one case.

- **Unit (domain)**: folder-link validity matrix (each invalid reason);
  reachability — direct child, deep descendant, moved-out document, archived
  document, archived intermediate folder (guard), document in a different
  Source, the folder itself is not a document.
- **Unit (existing guards)**: `share-link-single-exception` still passes;
  `share-read-pass-through` covers the new route.
- **Integration**: create/list/revoke folder links (ownership, limit 10,
  non-folder node refused, shared Workspace refused); `readShared` landing
  order, empty folder, unreachable `documentId` refused, live add/move-out;
  discussions through a folder link (create, reply, follow, owner event);
  follow Inbox entry goes dead when its document leaves the folder and returns
  when it comes back; saved folder share save/list/search, and its metadata
  when the link dies; existing document-link suites unchanged.
- **Reminders**: the tree marks a folder with an open link and stops marking
  it once the link is revoked or expires; a document's Share dialog names its
  shared ancestor folder, names nothing for a document outside it, and moving
  the document out removes the line.
- **E2E**: open a folder link anonymously, navigate the tree, follow an
  in-folder wikilink, see an out-of-folder wikilink as plain text; sign in,
  comment, save; owner revokes → every URL under the token is not-available;
  phone width shows the tree behind a button.
- **Hostile**: `/s/:token?d=<id of a document outside the folder | in another
  workspace | archived | random UUID>` all render the same not-available page
  and the same API error; a folder token with a `threadId` from outside the
  folder; a document token with any `documentId`.

## Documentation

- Amend the share-link invariant in `CLAUDE.md`: a share link targets a
  document **or a My Space folder**; a folder link grants read of the
  documents currently under it, re-derived per request, and the URL's
  document id is navigation only.
- Add this spec to README's canonical documents table alongside the other
  share specs.

## Left to the builder

- Exact TypeScript shape of the link target and of the folder view.
- Recursive CTE vs. loading the chain in TypeScript, per call site.
- Tree rail component structure, and whether it reuses parts of the owner's
  tree component (it must not import anything that reads outside the folder).
- Whether `create` grows a target parameter or a sibling method is added.
- *Builder's call, flagged:* no cap on folder size in this cut. Ceiling: the
  whole subtree is returned on every page load; if a shared folder reaches
  thousands of nodes, page the tree or load subfolders on expand.
