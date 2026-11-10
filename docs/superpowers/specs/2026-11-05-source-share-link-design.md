# Source share links: one link to a Source's live tree

Amends `2026-10-29-folder-share-link-design.md` and its named-recipient amendment.
The folder spec listed "sharing a whole Source" as a non-goal because a Source
root is not a folder node. This spec makes the Source a third share target and
keeps every grant, reading, discussion and saving rule the folder link already
has.

## Intent

A user can already share a My Space folder, or every top-level folder of a
Source one at a time. They want **one link for one Source's whole tree**: every
document and folder in that Source, at every depth, including documents that
sit at the Source root. The link stays live: a document added by a later sync
appears; an archived document disappears; nothing is snapshotted. One Source,
not the whole My Space.

The reader experience is the folder page's: a tree rail, the document being
read, comments, Save and Open in Knowledge Hub. The owner experience is the
folder dialog's: link or named audience, expiry, label, copy, revoke.

## Agreed with the user (2026-11-05)

- **One Source's whole tree.** The Source is the root; its top-level folders
  and documents are included. Sharing every Source in My Space at once is not
  this feature.
- **Every Source, whatever its ownership or type.** `HUB_MANAGED`,
  `SOURCE_MANAGED` and `FILE_UPLOAD` Sources can be shared. Sharing is a read
  grant; ownership answers who may write, not who may share. Restricting the
  action to synced folders would not prevent sharing everything (a top-level
  folder can already be shared) and would make the same tree behave differently
  by source type.
- **Live, not a snapshot.** The tree and its documents are the Source's current
  ACTIVE content. Renaming the Source keeps the link; archiving the Source
  closes it. Renaming a folder inside a synced Source archives and recreates
  that folder's node, so a folder link on it dies, but a Source link survives
  and shows the new folder.
- **Same grant shape as a folder link.** Anyone holding a LINK reads without
  signing in; a NAMED link opens only for its listed signed-in recipients or
  its owner. Expiry (1/7/30/90 days) or no expiry for NAMED, revocable, at most
  10 active links per Source. It grants no Workspace membership, search, tree
  outside the Source, history, MCP, Markdown edits or revision writes.
- **Disclosure, not a gate.** The dialog says plainly that the link covers every
  document in the Source and anything added later, and Sources/list surfaces
  mark a Source with an open link. Nothing asks for a confirmation step.
- **Every document in it behaves as a shared document does today.** Signed-in
  readers can comment, reply and follow; the owner gets link-origin comments in
  their Inbox; Save stores the Source link as one entry.

## Non-goals

- Sharing all of My Space, or several Sources, with one link.
- Sharing a Source's settings, excluded paths, sync history, health, assets or
  filesystem path. Only its documents and their titles, icons and bodies are
  readable through the link.
- Source-wide or folder-wide discussions; search inside a shared Source;
  editing through the link; per-document Save from inside a Source link.
- Shared Team Workspace Sources. Document and folder links are My Space only;
  so are these.
- Moving a document between Sources. The tree does not allow it today; if it
  ever does, a document moved out of the Source simply stops being reachable.
- A new visual language. The Source page reuses the folder page's tokens,
  layout, CSP and nonce rules.

## Anti-goals (a failure even if it works)

- **A document id in the URL is ever authorization.** `/s/:token?d=<id>` names
  which document to show; the service re-derives on every request that the
  document is ACTIVE, belongs to the link's Source, and sits under an all-ACTIVE
  node chain. An id from outside the Source, another Workspace or an archived
  document answers exactly like an id that does not exist.
- **The page discloses anything outside the Source.** No title, no existence
  signal: a wikilink whose target is outside the Source renders as the plain
  text the author wrote, with no resolved title, hover preview or "missing"
  styling.
- **A new caller-less entry.** `readShared` remains the only caller-less
  content entry and `readSharedTarget` the only narrow link judgement.
  `tests/unit/share-link-single-exception.test.ts` must keep passing unchanged.
- **Source links weaken document or folder links.** Existing rows, links,
  saved shares, follows and notifications keep working untouched; a Source link
  is additive.
- **The Source link becomes a back door to Source administration.** It reads
  documents, never the Source record's other fields.

## Bedrock facts this design rests on

Verified in the code on 2026-11-05:

- A `KnowledgeSource` is a row in `knowledge_sources` with `id`, `name`,
  `workspace_id`, `source_type`, `ownership` and `status`. It has **no root
  tree node**. Top-level folders and documents are `knowledge_tree_nodes` rows
  with `parent_id = NULL`.
- `fk_tree_parent_same_source` keeps every node's parent in the same Source, so
  a node's whole ancestor chain stays inside one Source. `uq_tree_one_document`
  gives each document exactly one tree node.
- `TreeRepository.listBySource(sourceId)` returns every node of a Source
  (folders and documents, all statuses) with `title`, `pageIcon`,
  `documentStatus` and `currentRevisionId`, in the owner's sibling order
  (`position`, then `id`).
- `document_share_links` already stores a target as `document_id XOR
  folder_node_id`, and every downstream table (threads, comments, follows,
  saved shares, views, comment events) references the link id, not the target.
  Adding a third target changes no downstream foreign key.
- `SourcePolicyPort` already exposes `findById` and `lockById`; the knowledge
  module may not import `src/modules/sources/**`, so the Source's name and
  status reach this feature through that port only.
- `assertShareLinkCreation` deliberately does not care about Source ownership;
  both `SOURCE_MANAGED` and `HUB_MANAGED` targets can be shared.
- The folder read builds its tree from `listSubtree` and re-proves the requested
  document through `listChain`; the Source read can use the same shape with
  `listBySource` and a Source-level chain check.

## Design

### 1. Data: a third target on the same link table

Extend `document_share_links`; do not add a parallel table. Downstream rows
already point at the link id, so threads, comments, follows, saved shares, view
counts and comment events need no new columns.

Migration 035 (additive, forward-only), three statements in this order:

```sql
ALTER TABLE document_share_links DROP CONSTRAINT ck_share_links_one_target;

ALTER TABLE document_share_links
  ADD COLUMN source_id UUID NULL AFTER folder_node_id,
  ADD CONSTRAINT fk_share_links_source FOREIGN KEY (source_id)
    REFERENCES knowledge_sources(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD KEY idx_share_links_source (source_id, created_at);

ALTER TABLE document_share_links
  ADD CONSTRAINT ck_share_links_one_target
  CHECK ((document_id IS NULL) + (folder_node_id IS NULL) + (source_id IS NULL) = 2);
```

Exactly one target is non-NULL. Existing rows all have `document_id` or
`folder_node_id` set and pass the new check. The target Source's type is not
stored; `source_id` points at the Source itself.

Domain: `ShareLinkTarget` gains
`{ kind: "SOURCE"; sourceId: string }`. Every exhaustive `switch` or ternary on
`target.kind` must handle it; TypeScript surfaces most of them. The audit
payload for create/revoke becomes `{ sourceId }` for a Source link; the event
types stay `DOCUMENT_SHARE_LINK_CREATED` / `_REVOKED` so existing consumers keep
working.

### 2. Validity and reachability

A Source link **opens** when all of these hold (the same rule as a folder link,
with the Source in the folder's place):

- not revoked, not expired;
- Source exists and is `ACTIVE`;
- its Workspace is `PERSONAL`, `ACTIVE`, owned by the link's creator, and the
  creator's direct role still reads.

`openShareLinkTarget` already takes a `{ sourceId, status }` target; pass the
`SourcePolicy` row. `evaluateShareLinkValidity` needs no new reason.

A **document is reachable** through an open Source link when:

- the document is `ACTIVE` and `document.sourceId === link.sourceId`;
- its tree node exists and belongs to the same Source;
- walking from that node up through `parent_id` to the root, every node
  (including the document's own node) is `ACTIVE` and in the same Source.

The pure rule belongs beside `isReachableThroughFolder` in
`document-share-link.ts`. `TreeChainNode` gains `sourceId` (and
`TreeRepository.listChain` selects it) so the rule can prove same-Source at
every step rather than trusting the FK alone:

```ts
export function isReachableThroughSource(
  chain: readonly TreeChainNode[],
  sourceId: string,
): boolean
```

`chain[0]` must be the `DOCUMENT` node; every node must be `ACTIVE`, carry
`sourceId`, and not repeat an id. **The chain must also terminate at a Source
root**: the last node's `parentId` is `null`. This is the anchor that
`isReachableThroughFolder` gets from the folder id; without it, a chain
truncated by `listChain`'s 1,000-node cap (or a data defect) would still pass.
A top-level document has a chain of one whose only node has `parentId = null`
and is reachable. `documentReachesSource(source, document, chain)` mirrors
`documentReachesFolder`; `reachableChainForSource` mirrors `reachableChain` and
returns the chain or null. Both live in `internal/folder-link-reach.ts` (the
file may be renamed to `share-link-reach.ts`; builder's call).

Any failure is `ShareLinkNotFoundError`, so no response separates "outside the
Source" from "does not exist" from "link dead".

### 3. Reading: still one caller-less content entry

`DocumentShareService.readShared` gains a third branch:

```ts
if (link.target.kind === "SOURCE") {
  return { linkId: link.id, view: await readSharedSource(repositories, link, link.target.sourceId, documentId, now, viewerId) };
}
```

`readSharedSource` mirrors `readSharedFolder`:

- load the Source through `sourcePolicy.findById`; a missing Source is
  `ShareLinkNotFoundError`;
- `requireOpenLink(repositories, link, source, now, viewerId)`;
- `sourceNodes = await tree.listBySource(source.id)`;
- build the forest with a new `sharedForest(sourceNodes)` that reuses
  `isShownInSharedTree` and depth-first sibling order. Top-level nodes keep
  `parentId: null`; an archived node and everything under it are absent;
- **cap the forest at the depth the chain can prove.** `listSubtree` already
  stops at a depth that keeps every folder node shown within `listChain`'s
  reach; `listBySource` has no such cap. Apply the same cap to the Source
  forest (counting a top-level node as depth 0), and drop anything deeper. A
  rail that shows a document the reachability check must then refuse is a bug,
  not a feature;
- `view = { kind: "SOURCE", rootName: source.name, tree, sharedByName,
  expiresAt, audience }`;
- the landing document is the first `DOCUMENT` in that depth-first forest;
  `documentId` from the URL wins when reachable, and an unreachable one is
  refused, never replaced by the landing document;
- the requested document is re-proved through `reachableChainForSource`, its
  current revision is read, and its `path` is every ancestor from the Source
  root down (the Source itself is not in `path`; the page adds its name);
- wikilink resolutions keep only targets whose document id is in the forest's
  document set.

Generalize the view type:

```ts
export type SharedTreeView = {
  kind: "FOLDER" | "SOURCE";
  rootName: string;
  tree: SharedTreeNode[];
  document: SharedFolderDocument | null;
  sharedByName: string;
  expiresAt: Date | null;
};

export type SharedView =
  (({ kind: "DOCUMENT" } & SharedDocumentView) | SharedTreeView) &
  { audience: ShareAudience; linkId?: string };
```

`SharedFolderView` may remain as an alias for `SharedTreeView` where the builder
prefers; the important part is one tree view with a root kind, not two copies.
`SharedTreeNode.parentId` means "null for a direct child of the shared root",
which is true for both a folder and a Source.

*My call from the builder check:* no paging or lazy folder expansion in this
cut, matching the folder share. The whole forest is returned on every page
load. Ceiling: if a Source reaches thousands of nodes, page the tree or load
subfolders on expand; the depth cap above only keeps the rail provable, not
cheap.

`readSharedTarget` gains the Source branch: load the Source, judge the link,
return `{ kind: "SOURCE", documentId }` for a reachable requested document,
else the landing document, else `null`. It still reads no revision, Markdown,
creator, catalog or view count.

### 4. Routes and page

- `/s/:token` — a Source link renders the same tree page as a folder link:
  pinned bar, breadcrumb beginning with the Source name, tree rail, reading
  column. `?d=<documentId>` selects a document; tree clicks are client
  navigations between these URLs.
- `/s/:token/open?d=<documentId>` — `/open` appends `?d=` for every non-document
  target (`target.kind !== "DOCUMENT"`), not only `FOLDER`.
- `/w/:workspaceId/shares/:token` — the named-share Hub reader draws the same
  page; its `shared.kind === "FOLDER"` branch becomes "not DOCUMENT".
- A Source with no documents shows "This source has no documents yet."
  A Source with only folders but no documents shows the same.
- `<title>` is the document title when one is shown, else the Source name.
  No Open Graph tags; same CSP and `frame-ancestors 'none'`.

Generalize `SharedFolderPage` (file may stay at
`src/app/s/[token]/shared-folder-page.tsx`) to take `SharedTreeView` and use
`rootName` / `kind` instead of `folderName`. `SharedFolderTree` takes
`rootName` and `rootKind`; it renders a `Database` icon and "Empty source" for a
Source, a `Folder` icon and "Empty folder" for a folder. Nothing else in the
page changes: the review panel, Save, Open, footer, phone disclosure and the
in-tree link base path are shared.

### 5. Wikilinks

Resolve the current document's links exactly as the owner's reader does, then
keep only resolutions whose target document is in the Source's live forest.
Point them at `/s/:token?d=<targetId>` (or the Hub reader's `?d=`). Every other
link renders as the plain text the author wrote: no dashed "No document titled
…", no hover preview, no other-documents count. Do not resolve against the
Source's documents alone; a link must point where it points for the owner, or
not at all. The existing folder page's `sharedFolderLinks` helper and the
`share-link-single-exception` guard need only the reachable set to change.

### 6. Discussions

The review API and `DocumentReviewService` already take an optional
`documentId` beside the token for a folder link. A Source link uses the same
contract: `documentId` is required, and the service resolves its scope as
"document reachable through this Source link" instead of `link.documentId`.

Touch points, all already folder-aware:

- `targetScope` gains a Source branch: load the Source and the named document,
  require same Source, pre-check reachability before locking, then re-check
  under the Source lock and judge the link with the Source's status.
- `linkValid` passes the document id to `targetScope` for `FOLDER` and
  `SOURCE`.
- `folderDocument` (the helper that adds `{ documentId }` for a folder link's
  followed discussion / Inbox href) becomes "non-document target".
- `discussionHrefs` passes the document id for `FOLDER` and `SOURCE`.
- `folderLinkDocuments` becomes `treeLinkDocuments`: one link judgement, then a
  batched per-document reachability check; for a Source, the batch is keyed by
  the target Source id and uses `documentReachesSource`.
- `mentionLinksForOwner` also lists `shareLinks.listBySource(document.sourceId)`,
  so an owner mentioning someone on a document can hand over the Source link.
- `named-recipients.linkOpensOnDocument` gains the Source branch.
- `internal/named-share-judgement.ts` `openNamedTarget` gains the Source
  branch: a live NAMED Source link opens `{ sourceName }`, and
  `namedShareTitle` returns that name. `SavedShareService.listNamedForRecipient`
  therefore lists it under "Shared with you" with the Source name and the Hub
  reader href (`/w/:workspaceId/shares/:token`), landing on the first document;
  the Inbox `SHARED_WITH_YOU` entry uses the same title.
- Proposal and mention typing: `targetKind` becomes
  `"DOCUMENT" | "FOLDER" | "SOURCE"`; the mention picker's label says
  "(whole source)".

Threads created through a Source link record `origin_share_link_id = <source
link>`, exactly as folder threads record the folder link. The owner's Inbox
event names the document as it does today. Rate limits and capacity counters
stay per document.

### 7. Saved shares

Saving a Source link snapshots, in one SQL statement as today, validity plus
public metadata: `saved_title` = the Source's name, `saved_shared_by_name` =
the creator's name, `saved_expires_at`. Saved-share search covers the same
fields; "currently public title" for a Source link is the Source's current name,
shown only while the link opens. The list marks Source entries with a database
icon; opening one goes to `/s/:token` (or the named reader), and a Source row's
metadata line does not repeat the title as `sourceName`.

SQL that joins `l.document_id` / `l.folder_node_id` gains the third branch:

- `repositories/document-share-links.ts` `listForWorkspace` (status, title,
  source name, kind mapping, search) and `listOpenSourceLinks`;
- `repositories/saved-shares.ts` `findSnapshotByToken` and `list`.

The shape is `LEFT JOIN knowledge_sources ts ON ts.id = l.source_id`, then
`JOIN knowledge_sources s ON s.id = COALESCE(d.source_id, f.source_id,
l.source_id)`, with `COALESCE(d.status, f.status, s.status)` for the target
status and `COALESCE(r.title, f.name, s.name)` for the title. Select
`l.source_id AS target_source_id` so the kind mapping is unambiguous.

### 8. Owner side

**Create.** `DocumentShareService.createForSource(caller, { sourceId, ... })`:

- `lockOwnedSourceScope` (Source then Workspace, same order as every write),
  which proves membership; `assertShareLinkCreation` proves the Workspace is the
  caller's own ACTIVE My Space and the Source is ACTIVE;
- target `{ kind: "SOURCE", sourceId }`;
- `countActiveBySource(sourceId, now)` enforces the 10-link cap;
- audit `DOCUMENT_SHARE_LINK_CREATED` with `{ sourceId, expiresAt, label,
  audience, recipientIds }`.

`listForSource` mirrors `listForFolder` without a folder-type check. `revoke`
and `lockOwnedLink` route a SOURCE target through `lockOwnedSourceScope`.
`listForWorkspace` already lists every link the caller created in that
Workspace; its kind mapping adds SOURCE.

**Entry points.** The dialog is the same; only the target and copy differ.

- **Sources page.** `SourceListRow`'s action menu and the `SourceDetail` header
  get "Share source" when the caller owns that My Space and the Source is
  ACTIVE. Mount `ShareLinkDialogHost` in the Sources layout (it is currently
  only in the knowledge layout and personal home) so the event has a host.
- **Knowledge sidebar.** The Source header gets a share action (a menu item or
  a Share2 icon button) under the same owner/ACTIVE condition, dispatching
  `requestShare({ sourceId, name })`.
- `ShareTarget` gains `{ sourceId: string; name?: string }`; `targetKey` and
  `linksUrl` handle it; `linksUrl` is `/api/sources/:sourceId/share-links`.
- Dialog title "Share source <name>"; LINK copy says it covers every document
  in the source, including documents added later, and nothing outside it;
  NAMED copy says only the picked people can open it after signing in. Revoke
  toast says "source".
- New route `src/app/api/sources/[sourceId]/share-links/route.ts`: POST calls
  `createForSource`, GET calls `listForSource` and returns the review
  capabilities. Same bodies and responses as the document route.

**Reminders.**

- `foldersSharingDocument` becomes `containersSharingDocument`, returning
  `{ folders, sources }`: ancestor folders with an open folder link, plus the
  document's Source if it has an open Source link. The document share-links GET
  returns `viaFolders` (unchanged) and `viaSources` (new); the dialog renders
  "Also visible through the shared source <name>" for each, retargeting to that
  Source.
- `listOpenFolderLinks` gains a sibling `listOpenSourceLinks`, or one
  `listOpenShareTargets` returns both. The workspace endpoint returns
  `{ folders, sources }`; the client hook returns both id sets. The sidebar
  marks a folder with a Share2 icon as today and marks a Source with the same
  icon beside its name; the label is "Shared". A link expiring while the tab is
  open is re-read on focus/visibility as today.
- **Sources page.** The Sources list (`SourceListRow`) and `SourceDetail` show
  the same "Shared" marker, using the same client hook (a small client marker
  component where the parent is a server component). No server read-model field
  is added: the endpoint the hook already calls is the one source of truth.

**My shares.**

- `ManagedShareLink` gains `{ kind: "SOURCE"; documentId: null;
  folderNodeId: null; sourceId }`. The base `sourceId` is already the owning
  Source, which for a Source link is also the target; the UI reads `title` and
  `sourceId` from the base.
- A Source row uses a database icon, a screen-reader "Source" prefix, and the
  Source's knowledge page (`/w/:ws/knowledge/:sourceId`) as its owner-side
  link. Revoke copy and the "restoring … may reactivate" notice say "source".
- The unread badge stays keyed by `origin_share_link_id`; nothing per-document
  is added.

### 9. Copy

- Dialog LINK: "Anyone with this link can read every document in this source,
  including any you add later. They will see every change you make from now on,
  but they cannot edit anything or see anything else in My Space."
- Dialog NAMED: "Only the people you pick can open this source, and only after
  signing in. It never expires."
- Empty page: "This source has no documents yet."
- Reminder: "Also visible through the shared source <name>."
- My shares: "Source <name>" in spoken names; "Documents opened through this
  link" tooltip for views, as folder rows already say.

## Testing

Requirement-driven; each bullet is at least one case.

- **Unit (domain):** Source-link validity matrix (each invalid reason);
  reachability — top-level document, nested document, archived document,
  archived intermediate folder, document in another Source, archived Source,
  missing node, repeated id; `isReachableThroughSource` with a chain of one.
- **Unit (existing guards):** `share-link-single-exception` still passes with
  `readShared` as the only caller-less content method and `readSharedTarget`
  still free of revisions, Markdown and users. The `/s` page still receives no
  resolutions except through the tree page helper.
- **Integration:** create/list/revoke Source links (ownership, personal only,
  10-link cap, archived Source refused, non-owned Source refused, Team
  Workspace refused); `readShared` landing order across several top-level
  nodes, empty Source, unreachable `?d=` refused, live add/archive; Source
  rename keeps the link, Source archive kills it and restore revives it;
  discussions through a Source link (create, reply, follow, mention, owner
  event); followed discussion goes dead when its document is archived and
  returns when restored; saved Source share save/list/search and metadata when
  the link dies; My shares statuses; named recipients and proposals; reminders
  (`viaSources`, source marker, no line for a document outside the Source);
  existing document and folder suites unchanged.
- **E2E:** open a Source link anonymously, navigate the tree, follow an
  in-Source wikilink, see an out-of-Source wikilink as plain text; sign in,
  comment, save; owner revokes → every URL under the token is not-available;
  phone width shows the tree behind a button; Source link opens from the
  Sources page and the sidebar.
- **Hostile:** `/s/:token?d=<id outside the Source | in another Workspace |
  archived | random UUID>` all render the same not-available page and the same
  API error; a Source token with a `threadId` from outside the Source; a
  document token with any `documentId`; a folder token with a document from
  another folder; a Source link naming a Team Workspace.

## Documentation

- Amend the share-link invariant in `CLAUDE.md`: a share link targets a
  document, a My Space folder **or a My Space Source**; a Source link grants
  read of the documents currently in it, re-derived per request, and `?d=` is
  navigation only.
- Add this spec to README's canonical documents table.
- Note in the Sources documentation that a Source can be shared as one link;
  the link does not expose source settings, history or assets.

## Approaches considered

### A. A third target on `document_share_links` (chosen)

Add `source_id`, keep one link table, and branch the reader once. Source
identity is a first-class row, so rename is stable and archiving the Source
naturally closes the link. The blast radius is enumerable: a discriminated
union that TypeScript checks, plus a handful of SQL sites that already branch
on target. No tree writes, no sync interaction, no new downstream foreign key.

Trade-off: the grant core and a few queries grow a third branch, and the
migration must replace the two-target CHECK.

### B. A hidden root folder node per Source

Create one synthetic `FOLDER` node per Source at `parent_id = NULL` and share it
as today's folder target. The share code would barely change.

Rejected. A Source's content is a forest of top-level nodes, not a folder's
children; making the synthetic node cover the Source would require reparenting
every top-level node under it, changing every tree write and the sync
reconciler. The sync executor keys `SOURCE_MANAGED` nodes by path and archives
and recreates a renamed folder, so the synthetic node needs special handling
too. Worse, the hidden node remains a legal `FOLDER` to every tree consumer
(search, graph, backlinks, agent context, tree validation), so a missed filter
leaks it silently; TypeScript would not flag any of those sites. The one-time
cost of A is smaller than the permanent tree complexity of B.

### C. A generic share scope table

A `share_scope` abstraction over folders and Sources is A with an extra layer
and a new join for every read. It buys nothing at this size; rejected.

## Builder check: calls made

A fresh builder read this design against the code and raised four questions.
All four were settled here; none needs the user.

1. **Source tree size.** No paging or lazy expansion in this cut, matching the
   folder share; the forest is returned whole. The same depth cap `listSubtree`
   uses keeps the rail to nodes the chain check can prove.
2. **Reachability anchor.** `isReachableThroughSource` requires the chain to end
   at a node with `parentId = null`, so a chain truncated by `listChain`'s cap
   cannot pass.
3. **Source marker.** The Sources list and Source detail show the "Shared"
   marker too, through the same client hook; no server read-model field.
4. **NAMED Source links.** They are titled with the Source name and open the
   Hub reader (`/w/:workspaceId/shares/:token`), landing on the first document,
   through `openNamedTarget`, `namedShareTitle` and
   `listNamedForRecipient`.

## Left to the builder

- Exact TypeScript names: `SharedTreeView` vs keeping `SharedFolderView`, and
  whether `SharedFolderPage` / `SharedFolderTree` are renamed.
- Whether `readSharedFolder` and `readSharedSource` share a helper or stay two
  functions with shared tree/reachability helpers.
- Recursive CTE vs. loading the chain in TypeScript, per SQL site.
- Whether `listOpenFolderLinks` is replaced by a combined
  `listOpenShareTargets` or kept with a sibling; the API may keep the
  `shared-folders` route and add `sources`, or gain a new route.
- Exact control for "Share source" in the sidebar (menu item vs icon button).
- Whether the Sources page mounts one dialog host in its layout or each action
  owns a dialog.
- Whether the source target's column is named `source_id` or `target_source_id`
  in the domain (the database column is `source_id`).
